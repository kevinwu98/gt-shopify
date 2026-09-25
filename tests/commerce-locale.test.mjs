import assert from 'node:assert/strict';
import {test} from 'node:test';
import {initializeGT} from 'gt-react';
import {
  getCatalogDelivery,
  getCommerceLocale,
} from '../app/lib/commerceLocale.ts';

initializeGT({defaultLocale: 'en', locales: ['fr', 'ja']});

test('native catalog uses the same GT cookie and language fallback as the UI', () => {
  const request = new Request('https://example.com', {
    headers: {cookie: 'generaltranslation.locale=ja', 'accept-language': 'fr'},
  });
  assert.deepEqual(getCommerceLocale(request, 'shopify'), {
    locale: 'ja',
    i18n: {language: 'JA', country: 'US'},
  });
  assert.deepEqual(
    getCommerceLocale(new Request('https://example.com', {
      headers: {'accept-language': 'fr-FR,fr;q=0.9'},
    }), 'shopify'),
    {locale: 'fr', i18n: {language: 'FR', country: 'US'}},
  );
});

test('unsupported locales fall back; language selection never changes the market', () => {
  assert.deepEqual(
    getCommerceLocale(new Request('https://example.com', {
      headers: {cookie: 'generaltranslation.locale=xx', 'accept-language': 'de'},
    }), 'shopify'),
    {locale: 'en', i18n: {language: 'EN', country: 'US'}},
  );
});

test('existing dictionary mode continues to fetch English source content', () => {
  const request = new Request('https://example.com', {
    headers: {cookie: 'generaltranslation.locale=fr'},
  });
  assert.deepEqual(getCommerceLocale(request, getCatalogDelivery()), {
    locale: 'fr', i18n: {language: 'EN', country: 'US'},
  });
  assert.equal(getCatalogDelivery('shopify'), 'shopify');
  assert.throws(() => getCatalogDelivery('native'), /GT_CATALOG_DELIVERY/);
});
