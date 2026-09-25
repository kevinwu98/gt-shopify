import type {CountryCode} from '@shopify/hydrogen/storefront-api-types';
import gtConfig from '../../gt.config.json';

export const GT_LOCALE_COOKIE_NAME = 'generaltranslation.locale';

// This demo deliberately pairs each language with one shopping destination.
// Shopify remains responsible for each destination's currency and prices.
const localeCountries: Record<string, CountryCode> = {
  en: 'US',
  fr: 'FR',
  id: 'ID',
  ja: 'JP',
  ko: 'KR',
};

export function getLocaleCountry(locale: string): CountryCode | undefined {
  const configuredLocales = [gtConfig.defaultLocale, ...gtConfig.locales];
  return configuredLocales.includes(locale) ? localeCountries[locale] : undefined;
}
