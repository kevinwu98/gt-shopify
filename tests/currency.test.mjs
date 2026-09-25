import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
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
const componentModuleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`;
const {LocalizedMoney} = await import(componentModuleUrl);

const gtConfig = JSON.parse(
  await readFile(new URL('../gt.config.json', import.meta.url), 'utf8'),
);
initializeGT({
  defaultLocale: gtConfig.defaultLocale,
  locales: gtConfig.locales,
});

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

for (const {locale, currencyCode, expected} of [
  {locale: 'fr', currencyCode: 'EUR', expected: '<span>1\u202f234,56\u00a0€</span>'},
  {locale: 'ja', currencyCode: 'JPY', expected: '<span>￥1,235</span>'},
  {locale: 'ko', currencyCode: 'KRW', expected: '<span>₩1,235</span>'},
  {locale: 'id', currencyCode: 'IDR', expected: '<span>Rp\u00a01.235</span>'},
]) {
  test(`GT renders Shopify ${currencyCode} in ${locale} with the correct currency digits`, () => {
    const price = Object.freeze({amount: '1234.56', currencyCode});

    assert.equal(renderPrice(locale, price), expected);
    assert.deepEqual(price, {amount: '1234.56', currencyCode});
  });
}

test('an incomplete optimistic cart cost stays empty instead of becoming NaN or USD', () => {
  assert.equal(renderPrice('fr', {}), '');
  assert.equal(renderPrice('fr', {amount: '10.00'}), '');
  assert.equal(renderPrice('fr', {currencyCode: 'EUR'}), '');
});

test('IDR stays at whole rupiah when the runtime defaults to two fraction digits', () => {
  // GT caches Intl constructors at import time, so emulate the older runtime
  // in an isolated process before loading GT and the actual component.
  const script = `
    import assert from 'node:assert/strict';
    import {createElement} from ${JSON.stringify(import.meta.resolve('react'))};
    import {renderToStaticMarkup} from ${JSON.stringify(import.meta.resolve('react-dom/server'))};
    const NativeNumberFormat = Intl.NumberFormat;
    Intl.NumberFormat = class extends NativeNumberFormat {
      constructor(locales, options) {
        super(locales, options?.currency === 'IDR'
          ? {minimumFractionDigits: 2, maximumFractionDigits: 2, ...options}
          : options);
      }
    };
    assert.equal(
      new Intl.NumberFormat('id', {style: 'currency', currency: 'IDR'}).format(12718000),
      'Rp\\u00a012.718.000,00',
    );
    const {GTProvider, initializeGT} = await import(${JSON.stringify(import.meta.resolve('gt-react'))});
    const {LocalizedMoney} = await import(${JSON.stringify(componentModuleUrl)});
    initializeGT({defaultLocale: 'en', locales: ['id']});
    const price = Object.freeze({amount: '12718000.00', currencyCode: 'IDR'});
    assert.equal(
      renderToStaticMarkup(createElement(GTProvider, {locale: 'id', translations: {}},
        createElement(LocalizedMoney, {data: price}))),
      '<span>Rp\\u00a012.718.000</span>',
    );
    assert.deepEqual(price, {amount: '12718000.00', currencyCode: 'IDR'});
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
