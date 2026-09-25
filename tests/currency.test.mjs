import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {GTProvider, initializeGT} from 'gt-react';
import ts from 'typescript';

// Node strips TypeScript but not JSX. Compile the actual component in memory,
// resolving its imports to the same installed GT/React modules as this test.
const source = await readFile(
  new URL('../app/components/LocalizedMoney.tsx', import.meta.url),
  'utf8',
);
let compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
for (const specifier of ['react/jsx-runtime', 'gt-react']) {
  compiled = compiled
    .replaceAll(JSON.stringify(specifier), JSON.stringify(import.meta.resolve(specifier)))
    .replaceAll(`'${specifier}'`, JSON.stringify(import.meta.resolve(specifier)));
}
const {LocalizedMoney} = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

initializeGT({defaultLocale: 'en', locales: ['fr', 'ja']});

function renderPrice(locale, data) {
  return renderToStaticMarkup(
    createElement(
      GTProvider,
      {locale, translations: {}},
      createElement(LocalizedMoney, {data}),
    ),
  );
}

test('GT formats Shopify USD prices in the active locale during SSR, outside T', () => {
  const price = Object.freeze({amount: '1234.56', currencyCode: 'USD'});

  assert.equal(renderPrice('en', price), '<span>$1,234.56</span>');
  assert.equal(renderPrice('fr', price), '<span>1\u202f234,56\u00a0$US</span>');
  assert.equal(renderPrice('ja', price), '<span>$1,234.56</span>');
  assert.deepEqual(price, {amount: '1234.56', currencyCode: 'USD'});
});

test('the Shopify currency code controls currency digits, not the selected language', () => {
  assert.equal(
    renderPrice('ja', {amount: '1234', currencyCode: 'JPY'}),
    '<span>￥1,234</span>',
  );
  assert.equal(
    renderPrice('fr', {amount: '1234.56', currencyCode: 'CAD'}),
    '<span>1\u202f234,56\u00a0$CA</span>',
  );
  assert.equal(
    renderPrice('ja', {amount: '0.00', currencyCode: 'USD'}),
    '<span>$0.00</span>',
  );
});

test('an incomplete optimistic cart cost stays empty instead of becoming NaN or USD', () => {
  assert.equal(renderPrice('fr', {}), '');
  assert.equal(renderPrice('fr', {amount: '10.00'}), '');
  assert.equal(renderPrice('fr', {currencyCode: 'EUR'}), '');
});
