import assert from 'node:assert/strict';
import {test} from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {GTProvider, initializeGT, useTranslations} from 'gt-react';
import {resolveCatalogText} from '../app/lib/catalogText.ts';

initializeGT({defaultLocale: 'en', locales: ['fr', 'ja']});

test('catalog display uses translated text when the Shopify source matches', () => {
  assert.equal(
    resolveCatalogText('Snowboard', 'Snowboard', () => 'スノーボード'),
    'スノーボード',
  );
});

test('new or edited Shopify text falls back without looking up a missing or stale entry', () => {
  const lookup = () =>
    assert.fail('Stale and missing entries must not be rendered');
  assert.equal(resolveCatalogText('New board', undefined, lookup), 'New board');
  assert.equal(
    resolveCatalogText('New board', 'Old board', lookup),
    'New board',
  );
  assert.equal(resolveCatalogText('', '', lookup), '');
});

test('empty or malformed dictionary entries cannot hide a product name or break a page', () => {
  assert.equal(
    resolveCatalogText('Board', 'Board', () => ''),
    'Board',
  );
  assert.equal(
    resolveCatalogText('Board {L}', 'Board {L}', () => {
      throw new Error('Dictionary entry unavailable or invalid');
    }),
    'Board {L}',
  );
});

test('GT dictionary server rendering preserves literal catalog punctuation and escapes HTML', () => {
  const dictionaries = {
    en: {product: ["Rider's {L} board", {$format: 'STRING'}]},
    fr: {product: ["Planche {L} de l'équipe <édition>", {$format: 'STRING'}]},
  };
  function ProductTitle() {
    const translate = useTranslations();
    return React.createElement('h1', null, translate('product'));
  }
  const html = renderToStaticMarkup(
    React.createElement(
      GTProvider,
      {locale: 'fr', translations: {}, dictionaries},
      React.createElement(ProductTitle),
    ),
  );
  assert.equal(html, '<h1>Planche {L} de l&#x27;équipe &lt;édition&gt;</h1>');
});
