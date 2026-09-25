import {cartSetIdDefault, type HydrogenCart, type HydrogenSession, type Storefront} from '@shopify/hydrogen';
import type {Country, CountryCode} from '@shopify/hydrogen/storefront-api-types';
import {redirectDocument} from 'react-router';
import {getLocaleCountry, GT_LOCALE_COOKIE_NAME} from './locale-market';

export type MarketCountry = Pick<Country, 'isoCode' | 'name'> & {
  currency: Pick<Country['currency'], 'isoCode' | 'symbol'>;
};

export type Markets = {
  country: MarketCountry;
  availableCountries: MarketCountry[];
};

export const MARKET_QUERY = `#graphql
  query Markets($country: CountryCode) @inContext(country: $country) {
    localization {
      country {
        isoCode
        name
        currency { isoCode symbol }
      }
      availableCountries {
        isoCode
        name
        currency { isoCode symbol }
      }
    }
  }
` as const;

export const CART_MARKET_AVAILABILITY_QUERY = `#graphql
  query CartMarketAvailability($country: CountryCode!, $ids: [ID!]!)
  @inContext(country: $country, language: EN) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        availableForSale
      }
    }
  }
` as const;

/** The signed session is written only after Shopify accepts a market change. */
export function getMarketCountry(session: Pick<HydrogenSession, 'get'>): CountryCode {
  const country = session.get('country');
  return typeof country === 'string' && /^[A-Z]{2}$/.test(country)
    ? country as CountryCode
    : 'US';
}

export async function getMarkets(storefront: Storefront): Promise<Markets> {
  const result = await storefront.query<{localization: Markets}>(MARKET_QUERY, {
    variables: {country: storefront.i18n.country},
    cache: storefront.CacheShort(),
  });
  if (result.errors?.length || !result.localization?.country ||
      !Array.isArray(result.localization.availableCountries)) {
    throw new Error('Available markets could not be loaded.');
  }
  return result.localization;
}

function safeReturnTo(value: FormDataEntryValue | null, requestUrl: URL) {
  if (value === null || value === '') return '/';
  if (typeof value !== 'string' || !value.startsWith('/') ||
      value.startsWith('//') || value.includes('\\') ||
      [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return null;
  try {
    const url = new URL(value, requestUrl);
    return url.origin === requestUrl.origin ? url.pathname + url.search + url.hash : null;
  } catch {
    return null;
  }
}

type MarketContext = {
  storefront: Storefront;
  session: Pick<HydrogenSession, 'set'>;
  cart: Pick<HydrogenCart, 'get' | 'getCartId' | 'updateBuyerIdentity' | 'setCartId'>;
};

function failure(error: string, status: number, code?: string) {
  return Response.json({error, ...(code && {code})}, {status});
}

export async function changeMarket(request: Request, context: MarketContext) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', {status: 405, headers: {Allow: 'POST'}});
  }
  const requestUrl = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin !== null && origin !== requestUrl.origin) return failure('Invalid request origin.', 403);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return failure('Invalid market selection.', 400);
  }
  const locale = form.get('locale');
  const submittedCountry = form.get('country');
  const localeCountry = typeof locale === 'string' ? getLocaleCountry(locale) : undefined;
  if (locale !== null && (!localeCountry ||
      (submittedCountry !== null && submittedCountry !== localeCountry))) {
    return failure('Select an available language and region.', 400);
  }
  const country = localeCountry ?? submittedCountry;
  const returnTo = safeReturnTo(form.get('returnTo'), requestUrl);
  if (!returnTo) return failure('Invalid return destination.', 400);
  if (typeof country !== 'string' || !/^[A-Z]{2}$/.test(country)) {
    return failure('Select an available country or region.', 400);
  }

  let markets: Markets;
  try {
    markets = await getMarkets(context.storefront);
  } catch {
    return failure('Countries and regions are temporarily unavailable. Please try again.', 502);
  }
  const selected = markets.availableCountries.find(({isoCode}) => isoCode === country);
  if (!selected) return failure('Select an available country or region.', 400);

  let headers = new Headers();
  // updateBuyerIdentity creates a cart when no ID exists, so skip it for visitors
  // without a cart. Their first cart inherits buyerIdentity from the context.
  if (context.cart.getCartId()) {
    try {
      const existing = await context.cart.get({numCartLines: 250});
      if (existing === null) {
        // Expired carts (including cookies from another linked store) have no
        // cart to update. Clear that ID so the next add creates a usable cart.
        headers = cartSetIdDefault({maxage: 0})('');
      } else if (!existing?.id || existing.errors?.length) {
        return failure('Your cart could not be updated for this country or region. Please try again.', 502);
      } else {
        // Shopify can remove unavailable lines when the buyer country changes.
        // Check the target market before mutating the shopper's existing cart.
        const lines = existing.lines?.nodes;
        if (!lines || lines.reduce((quantity, line) => quantity + line.quantity, 0) !== existing.totalQuantity) {
          return failure('Your cart could not be checked for this region. Please try again.', 502);
        }
        const ids = [...new Set(lines.map((line) => line.merchandise?.id))];
        if (ids.some((id) => !id)) {
          return failure('Your cart could not be checked for this region. Please try again.', 502);
        }
        if (ids.length) {
          const availability = await context.storefront.query<{
            nodes: Array<{id: string; availableForSale: boolean} | null>;
          }>(CART_MARKET_AVAILABILITY_QUERY, {
            variables: {country: selected.isoCode, ids},
            cache: context.storefront.CacheNone(),
          });
          if (availability.errors?.length || !Array.isArray(availability.nodes)) {
            return failure('Your cart could not be checked for this region. Please try again.', 502);
          }
          if (ids.some((id) => !availability.nodes.some((variant) => variant?.id === id && variant.availableForSale))) {
            return failure('Some items in your cart are not available in this region.', 409, 'CART_MARKET_UNAVAILABLE');
          }
        }
        const result = await context.cart.updateBuyerIdentity({countryCode: selected.isoCode});
        if (result.errors?.length || result.userErrors?.length || !result.cart?.id) {
          return failure('Your cart could not be updated for this country or region. Please try again.', 502);
        }
        headers = context.cart.setCartId(result.cart.id);
      }
    } catch {
      return failure('Your cart could not be updated for this country or region. Please try again.', 502);
    }
  }
  context.session.set('country', selected.isoCode);
  if (typeof locale === 'string') {
    // GT reads a plain locale cookie (not React Router's JSON-encoded cookies).
    // Commit it only after the market and existing cart were accepted together.
    headers.append('Set-Cookie',
      `${GT_LOCALE_COOKIE_NAME}=${encodeURIComponent(locale)}; Path=/; SameSite=Lax${requestUrl.protocol === 'https:' ? '; Secure' : ''}`,
    );
  }
  return redirectDocument(returnTo, {status: 303, headers});
}
