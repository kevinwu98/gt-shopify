import {cartSetIdDefault, type HydrogenCart, type HydrogenSession, type Storefront} from '@shopify/hydrogen';
import type {Country, CountryCode} from '@shopify/hydrogen/storefront-api-types';
import {msg} from 'gt-react';

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

function failure(error: string, status: number) {
  return Response.json({error}, {status});
}

export async function changeMarket(request: Request, context: MarketContext) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', {status: 405, headers: {Allow: 'POST'}});
  }
  const requestUrl = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin !== null && origin !== requestUrl.origin) return failure(msg('Invalid request origin.'), 403);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return failure(msg('Invalid market selection.'), 400);
  }
  const country = form.get('country');
  const returnTo = safeReturnTo(form.get('returnTo'), requestUrl);
  if (!returnTo) return failure(msg('Invalid return destination.'), 400);
  if (typeof country !== 'string' || !/^[A-Z]{2}$/.test(country)) {
    return failure(msg('Select an available country or region.'), 400);
  }

  let markets: Markets;
  try {
    markets = await getMarkets(context.storefront);
  } catch {
    return failure(msg('Countries and regions are temporarily unavailable. Please try again.'), 502);
  }
  const selected = markets.availableCountries.find(({isoCode}) => isoCode === country);
  if (!selected) return failure(msg('Select an available country or region.'), 400);

  let headers = new Headers();
  // updateBuyerIdentity creates a cart when no ID exists, so skip it for visitors
  // without a cart. Their first cart inherits buyerIdentity from the context.
  if (context.cart.getCartId()) {
    try {
      const existing = await context.cart.get();
      if (existing === null) {
        // Expired carts (including cookies from another linked store) have no
        // cart to update. Clear that ID so the next add creates a usable cart.
        headers = cartSetIdDefault({maxage: 0})('');
      } else if (!existing?.id || existing.errors?.length) {
        return failure(msg('Your cart could not be updated for this country or region. Please try again.'), 502);
      } else {
        const result = await context.cart.updateBuyerIdentity({countryCode: selected.isoCode});
        if (result.errors?.length || result.userErrors?.length || !result.cart?.id) {
          return failure(msg('Your cart could not be updated for this country or region. Please try again.'), 502);
        }
        headers = context.cart.setCartId(result.cart.id);
      }
    } catch {
      return failure(msg('Your cart could not be updated for this country or region. Please try again.'), 502);
    }
  }
  context.session.set('country', selected.isoCode);
  headers.set('Location', returnTo);
  return new Response(null, {status: 303, headers});
}
