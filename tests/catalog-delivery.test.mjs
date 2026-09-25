import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {
  createStaticHandler,
  createStaticRouter,
  StaticRouterProvider,
} from 'react-router';
import {GTProvider, initializeGT} from 'gt-react';
import ts from 'typescript';

function moduleUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

// Exercise the actual hook and server helper while keeping the test independent
// of Vite, Shopify credentials, and network access.
async function importTypeScript(path, imports) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  let compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  for (const [specifier, url] of Object.entries(imports)) {
    compiled = compiled
      .replaceAll(JSON.stringify(specifier), JSON.stringify(url))
      .replaceAll(`'${specifier}'`, JSON.stringify(url));
  }
  return import(moduleUrl(compiled));
}

const {useCatalog} = await importTypeScript('../app/lib/useCatalog.ts', {
  'gt-react': import.meta.resolve('gt-react'),
  'react-router': import.meta.resolve('react-router'),
  './catalogKeys': new URL('../app/lib/catalogKeys.ts', import.meta.url).href,
  './catalogText': new URL('../app/lib/catalogText.ts', import.meta.url).href,
});

const catalogImports = {};
for (const locale of ['en', 'fr', 'ja']) {
  const json = await readFile(
    new URL(`../catalog/${locale}.json`, import.meta.url),
    'utf8',
  );
  catalogImports[`../../catalog/${locale}.json`] = moduleUrl(
    `export default ${JSON.stringify(JSON.parse(json))};`,
  );
}
const {getCatalogDictionaries} = await importTypeScript(
  '../app/lib/catalog.server.ts',
  catalogImports,
);

initializeGT({defaultLocale: 'en', locales: ['fr', 'ja']});

async function renderCatalogTitle({source, delivery, dictionaries}) {
  function ProductTitle() {
    const catalog = useCatalog();
    return createElement(
      'h1',
      null,
      catalog('gid://shopify/Product/123', 'title', source),
    );
  }

  const handler = createStaticHandler([
    {
      id: 'root',
      path: '/',
      loader: () => ({catalogDelivery: delivery, dictionaries}),
      element: createElement(ProductTitle),
    },
  ]);
  const context = await handler.query(new Request('https://example.com/'));
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToStaticMarkup(
    createElement(
      GTProvider,
      {locale: 'fr', translations: {}, dictionaries},
      createElement(StaticRouterProvider, {router, context, hydrate: false}),
    ),
  );
}

test('Shopify delivery omits catalog dictionaries in every supported language', () => {
  for (const locale of ['en', 'fr', 'ja']) {
    assert.deepEqual(getCatalogDictionaries(locale, 'shopify'), {});
  }
});

test('native catalog text renders without dictionaries and preserves literal punctuation', async () => {
  assert.equal(
    await renderCatalogTitle({
      source: "Planche {L} de l'équipe <édition>",
      delivery: 'shopify',
      dictionaries: {},
    }),
    '<h1>Planche {L} de l&#x27;équipe &lt;édition&gt;</h1>',
  );
});

const dictionaries = {
  en: {product_123_title: ['Snowboard', {$format: 'STRING'}]},
  fr: {product_123_title: ['Planche à neige', {$format: 'STRING'}]},
};

test('dictionary delivery still translates a product whose English source matches', async () => {
  assert.equal(
    await renderCatalogTitle({
      source: 'Snowboard',
      delivery: 'dictionary',
      dictionaries,
    }),
    '<h1>Planche à neige</h1>',
  );
});

test('dictionary delivery falls back to edited live English instead of a stale translation', async () => {
  assert.equal(
    await renderCatalogTitle({
      source: "Rider's new {L} board",
      delivery: 'dictionary',
      dictionaries,
    }),
    '<h1>Rider&#x27;s new {L} board</h1>',
  );
});
