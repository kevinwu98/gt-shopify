import {parseLocale} from 'gt-react';

export type CatalogDelivery = 'dictionary' | 'shopify';

export function getCatalogDelivery(value?: string): CatalogDelivery {
  if (!value || value === 'dictionary') return 'dictionary';
  if (value === 'shopify') return value;
  throw new Error('GT_CATALOG_DELIVERY must be dictionary or shopify');
}

const shopifyLanguages = {en: 'EN', fr: 'FR', ja: 'JA'} as const;

/** Language selection never changes the buyer's country or converts prices. */
export function getCommerceLocale(request: Request, delivery: CatalogDelivery) {
  const locale = parseLocale(request);
  const language = shopifyLanguages[locale as keyof typeof shopifyLanguages];
  if (!language) {
    throw new Error('Add the configured GT locale to the Shopify language mapping');
  }
  return {
    locale,
    i18n: {language: delivery === 'shopify' ? language : 'EN', country: 'US'},
  } as const;
}
