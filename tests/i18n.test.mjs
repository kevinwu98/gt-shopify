import test from 'node:test';
import assert from 'node:assert/strict';
import {getStoreLocale, localePath} from '../app/lib/i18n.ts';

test('HTML and React Router data URLs resolve the same request locale', () => {
  for (const locale of ['fr', 'ja']) {
    for (const path of [`/${locale}`, `/${locale}/`, `/${locale}.data`, `/${locale}/products/board.data`]) {
      assert.equal(getStoreLocale(path).locale, locale, path);
      assert.equal(getStoreLocale(path).country, 'US');
    }
  }
  assert.equal(getStoreLocale('/products/board').locale, 'en');
});

test('locale links retain product choices, search text, and fragments', () => {
  assert.equal(localePath('/fr/products/board?Size=158cm&Color=Blue#details', 'ja'), '/ja/products/board?Size=158cm&Color=Blue#details');
  assert.equal(localePath('/ja/search?q=snowboard', 'en'), '/search?q=snowboard');
  assert.equal(localePath('/fr', 'en'), '/');
  assert.equal(localePath('/fr/', 'fr'), '/fr/');
  assert.equal(localePath('https://shopify.com', 'ja'), 'https://shopify.com');
  assert.equal(localePath('//shopify.com', 'ja'), '//shopify.com');
});
