import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {
  applyPlan, buildPlan, createAdminClient, exportCatalog, fetchResources,
  normalizeAdminDomain, readState, savePlan, translateCatalog, validateLocales,
} from '../scripts/shopify-catalog.mjs';

const storeDomain = 'connector-test.myshopify.com';
const locales = ['fr', 'ja'];
const field = (key, value, digest = `${key}-digest`) => ({key, value, digest, locale: 'en'});
const product = (id = '1') => ({resourceId: `gid://shopify/Product/${id}`,
  translatableContent: [field('title', `Snowboard ${id}`), field('body_html', '<p>A <b>great</b> board.</p>'), field('handle', `board-${id}`)], t0: [], t1: []});
const clone = (value) => JSON.parse(JSON.stringify(value));
const translation = (key, value, locale = 'fr', outdated = false, market = null) => ({key, value, locale, outdated, market});
const translator = {translateMany: async (entries, options) => entries.map((entry) => ({
  success: true, translation: `${options.targetLocale}: ${entry.source}`, locale: options.targetLocale, dataFormat: 'STRING',
}))};

async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'gt-shopify-connector-'));
  t.after(() => rm(path, {recursive: true, force: true}));
  return path;
}

function mockClient(products = [product()]) {
  const resources = clone(products);
  const calls = [];
  const client = {
    storeDomain, resources, calls, shopId: 'gid://shopify/Shop/1', published: true,
    async query(query, variables) {
      calls.push({query, variables});
      if (query.includes('CatalogIdentity')) return {shop: {id: client.shopId}, shopLocales: [
        {locale: 'en', primary: true, published: true},
        ...locales.map((locale) => ({locale, primary: false, published: client.published})),
      ]};
      if (query.includes('CatalogExport')) return {translatableResources: {
        nodes: variables.type === 'PRODUCT' ? clone(resources) : [], pageInfo: {hasNextPage: false, endCursor: null},
      }};
      const current = resources.find((item) => item.resourceId === variables.resourceId);
      if (query.includes('CatalogCurrent')) return {translatableResource: current ? clone(current) : null};
      if (query.includes('CatalogRegister')) {
        const translations = variables.translations.map(({key, locale, value}) => translation(key, value, locale));
        for (const item of translations) {
          const alias = `t${locales.indexOf(item.locale)}`;
          current[alias] = [...current[alias].filter((previous) => previous.key !== item.key || previous.market !== null), item];
        }
        return {translationsRegister: {translations, userErrors: []}};
      }
      throw new Error('Unexpected query');
    },
  };
  return client;
}

async function seed(t, products) {
  const path = await directory(t);
  const client = mockClient(products);
  await exportCatalog({directory: path, client});
  return {path, client};
}

async function ready(t, products) {
  const {path, client} = await seed(t, products);
  await translateCatalog({directory: path, translator});
  const plan = await savePlan(path);
  return {path, client, plan};
}
const mutations = (client) => client.calls.filter(({query}) => query.includes('mutation'));

test('Admin client restricts token destination, pins API, blocks redirects, and redacts remote errors', async () => {
  for (const invalid of ['https://shop.myshopify.com', 'shop.myshopify.com@evil.example', 'evil.example', 'shop.myshopify.com/redirect']) assert.throws(() => normalizeAdminDomain(invalid), /bare myshopify.com/);
  for (const invalid of [['en'], ['fr', 'fr'], ['fr") { secret }']]) assert.throws(() => validateLocales(invalid), /target locales/);
  let observed;
  const client = createAdminClient({storeDomain, token: 'secret-value', fetchImpl: async (url, options) => {
    observed = {url, options};
    return {ok: true, json: async () => ({errors: [{message: 'secret-value'}]})};
  }});
  await assert.rejects(client.query('query { shop { id } }'), (error) => !error.message.includes('secret-value') && /rejected/.test(error.message));
  assert.equal(observed.url, `https://${storeDomain}/admin/api/2026-04/graphql.json`);
  assert.equal(observed.options.redirect, 'error');
  assert.equal(observed.options.headers['X-Shopify-Access-Token'], 'secret-value');
  const failed = createAdminClient({storeDomain, token: 'secret-value', fetchImpl: async () => { throw new Error('secret-value'); }});
  await assert.rejects(failed.query('mutation { test }'), /outcome may be unknown/);
  const incomplete = createAdminClient({storeDomain, token: 'secret-value', fetchImpl: async () => ({ok: true, json: async () => ({})})});
  await assert.rejects(incomplete.query('query { shop { id } }'), /rejected the query/);
});

test('export includes all three bounded resource types and never treats omitted translations as absent', async (t) => {
  const {path, client} = await seed(t);
  assert.deepEqual(client.calls.filter(({query}) => query.includes('CatalogExport')).map(({variables}) => variables.type), ['PRODUCT', 'PRODUCT_OPTION', 'PRODUCT_OPTION_VALUE']);
  const before = await readFile(join(path, 'state.json'), 'utf8');
  delete client.resources[0].t0;
  await assert.rejects(exportCatalog({directory: path, client}), /omitted existing/);
  assert.equal(await readFile(join(path, 'state.json'), 'utf8'), before);
});

test('pagination fails closed on repeats, duplicate resources, and size caps', async () => {
  let page = 0;
  const client = {query: async () => ({translatableResources: {
    nodes: [product(String(++page))], pageInfo: {hasNextPage: true, endCursor: 'repeat'},
  }})};
  await assert.rejects(fetchResources(client, locales), /invalid pagination/);
  page = 0;
  await assert.rejects(fetchResources(client, locales, 1), /exceeds --max-resources/);
  const duplicate = {query: async () => ({translatableResources: {
    nodes: [product(), product()], pageInfo: {hasNextPage: false},
  }})};
  await assert.rejects(fetchResources(duplicate, locales), /duplicate resources/);
});

test('export binds state to both domain and immutable shop ID', async (t) => {
  const {path, client} = await seed(t);
  await assert.rejects(exportCatalog({directory: path, client: {...client, storeDomain: 'other.myshopify.com'}}), /different store/);
  client.shopId = 'gid://shopify/Shop/2';
  await assert.rejects(exportCatalog({directory: path, client}), /account differs/);
});

test('translation and plan protect pre-existing merchant text and report HTML and handles explicitly', async (t) => {
  const p = product();
  p.t0.push(translation('title', 'Merchant title'));
  p.t1.push(translation('title', 'Market override', 'ja', false, {id: 'gid://shopify/Market/1'}));
  const {path} = await seed(t, [p]);
  const calls = [];
  await translateCatalog({directory: path, translator: {translateMany: async (entries, options) => {
    calls.push({entries, options}); return translator.translateMany(entries, options);
  }}});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.targetLocale, 'ja');
  assert.ok(calls[0].entries.every((item) => item.metadata.dataFormat === 'STRING' && !item.source.includes('<p>')));
  const plan = await savePlan(path);
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.protectedFields.length, 1);
  assert.deepEqual(plan.unsupported.map((item) => item.key), ['body_html', 'handle']);
  assert.equal(plan.changes[0].before, null, 'market-specific overrides do not become global translation inputs');
});

test('GT partial results resume only missing fields and do not save invalid language or format', async (t) => {
  const {path} = await seed(t, [product(), product('2')]);
  const first = await translateCatalog({directory: path, translator: {translateMany: async (entries, options) => entries.map((entry, index) => ({
    success: true, translation: `Translated ${entry.source}`, locale: index ? 'de' : options.targetLocale, dataFormat: 'STRING',
  }))}});
  assert.equal(first.failures.length, 2);
  assert.equal(Object.keys(first.state.generated).length, 2);
  const calls = [];
  const retry = await translateCatalog({directory: path, translator: {translateMany: async (entries, options) => {
    calls.push(entries); return translator.translateMany(entries, options);
  }}});
  assert.equal(retry.failures.length, 0);
  assert.ok(calls.every((entries) => entries.length === 1 && entries[0].source === 'Snowboard 2'));
});

test('source edits prune cached GT results and concurrent local edits cannot be overwritten', async (t) => {
  const {path, client} = await ready(t);
  client.resources[0].translatableContent[0] = field('title', 'New title', 'new-digest');
  const exported = await exportCatalog({directory: path, client});
  assert.deepEqual(exported.generated, {});
  await assert.rejects(translateCatalog({directory: path, translator: {translateMany: async (entries, options) => {
    const current = JSON.parse(await readFile(join(path, 'state.json'), 'utf8'));
    current.exportedAt = 'concurrent change';
    await writeFile(join(path, 'state.json'), JSON.stringify(current));
    return translator.translateMany(entries, options);
  }}}), /state changed during translation/);
  assert.deepEqual((await readState(path)).generated, {});
});

test('apply requires exact reviewed hash, published locale, and matching shop before mutating', async (t) => {
  const {path, client, plan} = await ready(t);
  await assert.rejects(applyPlan({directory: path, client, planHash: 'wrong'}), /exact --plan-hash/);
  client.published = false;
  await assert.rejects(applyPlan({directory: path, client, planHash: plan.planHash}), /publish fr/);
  client.published = true;
  client.shopId = 'gid://shopify/Shop/2';
  await assert.rejects(applyPlan({directory: path, client, planHash: plan.planHash}), /account differs/);
  assert.equal(mutations(client).length, 0);
});

test('apply preflights every resource and prevents writes when a later source or translation changed', async (t) => {
  const {path, client, plan} = await ready(t, [product(), product('2')]);
  client.resources[1].translatableContent[0].digest = 'changed';
  await assert.rejects(applyPlan({directory: path, client, planHash: plan.planHash}), /Source content changed/);
  assert.equal(mutations(client).length, 0);
  client.resources[1].translatableContent[0].digest = 'title-digest';
  client.resources[1].t0.push(translation('title', 'Edited by merchant'));
  await assert.rejects(applyPlan({directory: path, client, planHash: plan.planHash}), /protected/);
  assert.equal(mutations(client).length, 0);
});

test('confirmed writes use Shopify digests, retain receipts, and are idempotent', async (t) => {
  const {path, client, plan} = await ready(t);
  assert.deepEqual(await applyPlan({directory: path, client, planHash: plan.planHash}), {applied: 2, alreadyCurrent: 0});
  const writes = mutations(client);
  assert.equal(writes.length, 1);
  assert.ok(writes[0].variables.translations.every((item) => item.translatableContentDigest === 'title-digest' && !Object.hasOwn(item, 'marketId')));
  assert.equal(Object.keys((await readState(path)).managed).length, 2);
  assert.deepEqual(await applyPlan({directory: path, client, planHash: plan.planHash}), {applied: 0, alreadyCurrent: 2});
  assert.equal(mutations(client).length, 1);
  assert.equal(buildPlan(await readState(path)).changes.length, 0);
});

test('connector-owned outdated values can update, but subsequent merchant edits are protected', async (t) => {
  const {path, client, plan} = await ready(t);
  await applyPlan({directory: path, client, planHash: plan.planHash});
  client.resources[0].translatableContent[0] = field('title', 'Edited English', 'v2');
  client.resources[0].t0[0].outdated = true;
  client.resources[0].t1[0] = translation('title', 'Merchant Japanese edit', 'ja', true);
  await exportCatalog({directory: path, client});
  await translateCatalog({directory: path, translator});
  const nextPlan = await savePlan(path);
  assert.equal(nextPlan.changes.length, 1);
  assert.equal(nextPlan.protectedFields.length, 1);
  assert.equal(nextPlan.changes[0].locale, 'fr');
  assert.equal(nextPlan.changes[0].digest, 'v2');
  await applyPlan({directory: path, client, planHash: nextPlan.planHash});
  assert.equal(client.resources[0].t1[0].value, 'Merchant Japanese edit');
});

test('partial apply keeps receipts for confirmed resources and fails closed for unknown outcomes', async (t) => {
  const {path, client, plan} = await ready(t, [product(), product('2')]);
  const query = client.query.bind(client);
  client.query = async (text, variables) => {
    if (text.includes('CatalogRegister') && variables.resourceId.endsWith('/2')) throw new Error('unknown outcome');
    return query(text, variables);
  };
  await assert.rejects(applyPlan({directory: path, client, planHash: plan.planHash}), /unknown outcome/);
  assert.equal(Object.keys((await readState(path)).managed).length, 2);
  client.query = query;
  assert.deepEqual(await applyPlan({directory: path, client, planHash: plan.planHash}), {applied: 2, alreadyCurrent: 2});
});

test('a missing confirmation or user error cannot establish ownership of target translations', async (t) => {
  const {path, client, plan} = await ready(t);
  const query = client.query.bind(client);
  client.query = async (text, variables) => {
    if (text.includes('CatalogRegister')) return {translationsRegister: {translations: [], userErrors: []}};
    return query(text, variables);
  };
  await assert.rejects(applyPlan({directory: path, client, planHash: plan.planHash}), /did not confirm every/);
  assert.deepEqual((await readState(path)).managed, {});
  client.query = async (text, variables) => {
    if (text.includes('CatalogRegister')) return {translationsRegister: {translations: [], userErrors: [{code: 'INVALID_DIGEST', field: ['translations']}]}};
    return query(text, variables);
  };
  await assert.rejects(applyPlan({directory: path, client, planHash: plan.planHash}), /did not confirm every/);
  assert.deepEqual((await readState(path)).managed, {});
});
