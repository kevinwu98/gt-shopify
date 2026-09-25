import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {catalogKey} from '../app/lib/catalogKeys.ts';
import {
  buildSource,
  catalogStatus,
  fetchCatalog,
  normalizeStoreDomain,
  readCatalog,
  syncCatalog,
  translateCatalog,
} from '../scripts/catalog.mjs';

const storeDomain = 'catalog-test.myshopify.com';
const product = (id = '1', title = 'Board') => ({
  id: `gid://shopify/Product/${id}`,
  title,
  description: 'A mountain snowboard.',
  options: [{name: 'Color', optionValues: [{name: 'Blue'}, {name: 'Red'}]}],
});
const page = (nodes, hasNextPage = false, endCursor = null) => ({
  ok: true,
  status: 200,
  json: async () => ({data: {products: {nodes, pageInfo: {hasNextPage, endCursor}}}}),
});
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'gt-catalog-test-'));
  t.after(() => rm(path, {recursive: true, force: true}));
  return path;
}
const syncOptions = {storeDomain, publicToken: 'test-token'};
async function seed(t, products = [product()]) {
  const path = await directory(t);
  await syncCatalog({...syncOptions, directory: path, fetchImpl: async () => page(products)});
  return path;
}
async function files(path) {
  return Object.fromEntries(await Promise.all((await readdir(path)).map(async (file) =>
    [file, await readFile(join(path, file), 'utf8')])));
}

test('catalog keys distinguish products and punctuation/non-Latin option values without dictionary path separators', () => {
  const id = 'gid://shopify/Product/123';
  const values = ['Blue.Red', 'Blue_Red', 'Blue/Red', 'Blue%2FRed', '青', 'é', 'e\u0301'];
  const keys = values.map((value) => catalogKey(id, 'optionValue', 'Color.Name', value));
  assert.equal(new Set(keys).size, values.length);
  assert.ok(keys.every((key) => !key.includes('.') && /^[a-z\d_]+$/.test(key)));
  assert.equal(catalogKey(id, 'title'), 'product_123_title');
  assert.notEqual(catalogKey(id, 'optionValue', 'A', 'BC'), catalogKey(id, 'optionValue', 'AB', 'C'));
  assert.throws(() => catalogKey('gid://shopify/ProductVariant/123', 'title'), /Product GID/);
  assert.throws(() => catalogKey(id, 'optionValue', 'Color'), /option value/);
});

test('export follows pagination, requests English, and never exports prices or purchasing data', async () => {
  const calls = [];
  const products = await fetchCatalog({...syncOptions, fetchImpl: async (url, options) => {
    calls.push({url, options, body: JSON.parse(options.body)});
    return calls.length === 1 ? page([product()], true, 'next') : page([product('2')]);
  }});
  assert.equal(products.length, 2);
  assert.equal(calls[0].body.variables.after, null);
  assert.equal(calls[1].body.variables.after, 'next');
  assert.match(calls[0].body.query, /@inContext\(language: EN\)/);
  assert.match(calls[0].url, /\/api\/2026-04\/graphql.json$/);
  assert.equal(calls[0].options.headers['X-Shopify-Storefront-Access-Token'], 'test-token');
  assert.equal(calls[0].options.redirect, 'error', 'Storefront credentials must not follow cross-origin redirects');
  assert.deepEqual(Object.keys(buildSource(products)).filter((key) => /price|currency|inventory/i.test(key)), []);
});

test('export fails on repeated pagination and caps rather than silently truncating', async () => {
  let count = 0;
  await assert.rejects(fetchCatalog({...syncOptions, fetchImpl: async () =>
    page([product(String(++count))], true, 'repeated')}), /invalid pagination/);
  await assert.rejects(fetchCatalog({...syncOptions, maxProducts: 1, fetchImpl: async () =>
    page([product()], true, 'next')}), /exceeds --max-products/);
});

test('credentials cannot be sent to arbitrary URLs', () => {
  for (const invalid of ['https://example.com', 'store.myshopify.com/secret', 'store.myshopify.com@evil.example', 'store.myshopify.com?token=x']) {
    assert.throws(() => normalizeStoreDomain(invalid), /bare myshopify.com/);
  }
});

test('sync preserves unchanged translations but removes changed and deleted source entries', async (t) => {
  const path = await seed(t, [product(), product('2', 'Deleted')]);
  const original = await readCatalog(path);
  const translated = Object.fromEntries(Object.entries(original.source).map(([key, text]) => [key, `French ${text}`]));
  await writeFile(join(path, 'fr.json'), JSON.stringify(translated));
  const changed = product('1', 'New board');
  changed.options[0].optionValues = [{name: 'Blue'}, {name: 'Green'}];
  const result = await syncCatalog({...syncOptions, directory: path, fetchImpl: async () => page([changed])});
  assert.equal(result.translations.fr.product_1_title, undefined);
  assert.equal(result.translations.fr.product_1_description, 'French A mountain snowboard.');
  assert.ok(!Object.keys(result.translations.fr).some((key) => key.startsWith('product_2_')));
  assert.equal(result.translations.fr[catalogKey(changed.id, 'optionValue', 'Color', 'Red')], undefined);
  assert.equal(result.translations.fr[catalogKey(changed.id, 'optionValue', 'Color', 'Green')], undefined);
  assert.equal(result.translations.fr[catalogKey(changed.id, 'optionValue', 'Color', 'Blue')], 'French Blue');
});

test('last-page network/GraphQL failures and empty exports preserve every previous file', async (t) => {
  const path = await seed(t);
  const before = await files(path);
  let count = 0;
  await assert.rejects(syncCatalog({...syncOptions, directory: path, fetchImpl: async () => {
    if (++count === 1) return page([product('3')], true, 'last');
    throw new Error('secret-token-must-not-leak');
  }}), /request failed/);
  assert.deepEqual(await files(path), before);
  await assert.rejects(syncCatalog({...syncOptions, directory: path, fetchImpl: async () => ({
    ok: true, json: async () => ({errors: [{message: 'secret-token-must-not-leak'}]}),
  })}), /rejected the catalog query/);
  assert.deepEqual(await files(path), before);
  await assert.rejects(syncCatalog({...syncOptions, directory: path, fetchImpl: async () => page([])}), /No published products/);
  assert.deepEqual(await files(path), before);
});

test('a store change requires an explicit flag and invalidates same-ID translations', async (t) => {
  const path = await seed(t);
  await writeFile(join(path, 'fr.json'), JSON.stringify({product_1_title: 'Planche'}));
  const before = await files(path);
  const changed = {...syncOptions, storeDomain: 'different.myshopify.com', directory: path, fetchImpl: async () => page([product()])};
  await assert.rejects(syncCatalog(changed), /--allow-store-change/);
  assert.deepEqual(await files(path), before);
  const result = await syncCatalog({...changed, allowStoreChange: true});
  assert.deepEqual(result.translations.fr, {});
  assert.equal(result.manifest.storeDomain, 'different.myshopify.com');
});

test('translation saves valid successes, rejects wrong-language/format failures, and requests only missing strings next time', async (t) => {
  const path = await seed(t);
  const calls = [];
  const result = await translateCatalog({directory: path, translator: {translateMany: async (entries, options) => {
    calls.push({entries, options});
    return entries.map((entry, index) => index === 0
      ? {success: true, translation: `Translated ${entry.source}`, locale: options.targetLocale, dataFormat: 'STRING'}
      : index === 1
        ? {success: true, translation: 'Wrong language', locale: 'de', dataFormat: 'STRING'}
        : {success: false, error: 'service error', code: 500});
  }}});
  assert.ok(result.failures.length);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].entries.every((entry) => entry.metadata.dataFormat === 'STRING' && entry.metadata.context));
  assert.equal(Object.keys(result.catalog.translations.fr).length, 1);
  const succeeded = calls[0].entries[0].metadata.id;
  const retryCalls = [];
  const retry = await translateCatalog({directory: path, translator: {translateMany: async (entries, options) => {
    retryCalls.push(entries);
    return entries.map((entry) => ({success: true, translation: `Translated ${entry.source}`, locale: options.targetLocale, dataFormat: 'STRING'}));
  }}});
  assert.ok(retryCalls.every((entries) => !entries.some((entry) => entry.metadata.id === succeeded)));
  assert.equal(retry.failures.length, 0);
  assert.equal(catalogStatus(retry.catalog).fr.missing, 0);
});

test('a thrown GT request preserves previous successful batches and does not write error text', async (t) => {
  const path = await seed(t);
  let calls = 0;
  const result = await translateCatalog({directory: path, batchSize: 1, translator: {translateMany: async (entries, options) => {
    if (++calls > 1) throw new Error('credential-secret-value');
    return entries.map(() => ({success: true, translation: 'Traduction', locale: options.targetLocale, dataFormat: 'STRING'}));
  }}});
  assert.equal(Object.keys(result.catalog.translations.fr).length, 1);
  assert.ok(result.failures.length);
  assert.ok(!JSON.stringify(await files(path)).includes('credential-secret-value'));
});

test('translation refuses manually edited source or concurrent catalog updates', async (t) => {
  const path = await seed(t);
  const before = await readCatalog(path);
  await writeFile(join(path, 'en.json'), JSON.stringify({...before.source, product_1_title: 'Edited outside sync'}));
  await assert.rejects(translateCatalog({directory: path, translator: {translateMany: () => assert.fail('must not call GT')}}), /does not match/);
  await syncCatalog({...syncOptions, directory: path, fetchImpl: async () => page([product()])});
  await assert.rejects(translateCatalog({directory: path, translator: {translateMany: async (entries, options) => {
    await syncCatalog({...syncOptions, directory: path, fetchImpl: async () => page([product('1', 'Updated during request')])});
    return entries.map(() => ({success: true, translation: 'Old source translation', locale: options.targetLocale, dataFormat: 'STRING'}));
  }}}), /changed during translation/);
  assert.deepEqual((await readCatalog(path)).translations.fr, {});
});
