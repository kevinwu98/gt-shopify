import {createHash, randomUUID} from 'node:crypto';
import {mkdir, open, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs, parseEnv} from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const API_VERSION = '2026-04';
export const RESOURCE_FIELDS = {
  PRODUCT: ['title', 'product_type', 'meta_title', 'meta_description'],
  PRODUCT_OPTION: ['name'],
  PRODUCT_OPTION_VALUE: ['name'],
};
const RESOURCE_GIDS = {PRODUCT: 'Product', PRODUCT_OPTION: 'ProductOption', PRODUCT_OPTION_VALUE: 'ProductOptionValue'};
const IDENTITY_QUERY = `query CatalogIdentity { shop { id } shopLocales { locale primary published } }`;
const REGISTER = `mutation CatalogRegister($resourceId: ID!, $translations: [TranslationInput!]!) {
  translationsRegister(resourceId: $resourceId, translations: $translations) {
    translations { key locale value outdated } userErrors { field code }
  }
}`;
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const entryId = (resourceId, key, locale) => JSON.stringify([resourceId, key, locale]);
const supported = (type, field) => RESOURCE_FIELDS[type]?.includes(field.key) && field.value.trim();

export function normalizeAdminDomain(value) {
  const domain = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) {
    throw new Error('SHOPIFY_STORE_DOMAIN must be a bare myshopify.com domain.');
  }
  return domain;
}

export function validateLocales(locales) {
  if (!Array.isArray(locales) || !locales.length || locales.length > 10 ||
      new Set(locales).size !== locales.length ||
      locales.some((locale) => typeof locale !== 'string' || !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale) || locale === 'en')) {
    throw new Error('Provide 1–10 distinct target locales, excluding the English source locale.');
  }
  return locales;
}

function resourceSelection(locales) {
  validateLocales(locales);
  return `resourceId translatableContent { key value digest locale }
    ${locales.map((locale, index) => `t${index}: translations(locale: ${JSON.stringify(locale)}) { key value locale outdated market { id } }`).join('\n')}`;
}

/** Credentials are sent only to the configured Shopify Admin endpoint. No automatic mutation retry. */
export function createAdminClient({storeDomain, token, fetchImpl = fetch}) {
  const domain = normalizeAdminDomain(storeDomain);
  if (typeof token !== 'string' || !token.trim()) throw new Error('Set SHOPIFY_ADMIN_ACCESS_TOKEN in .env.shopify-catalog. Storefront tokens cannot authorize this connector.');
  return {
    storeDomain: domain,
    async query(query, variables = {}) {
      let response;
      try {
        response = await fetchImpl(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
          headers: {'Content-Type': 'application/json', 'X-Shopify-Access-Token': token},
          body: JSON.stringify({query, variables}),
        });
      } catch {
        throw new Error('Shopify Admin request failed. If applying, its outcome may be unknown; export and create a new plan before retrying.');
      }
      if (!response.ok) throw new Error(`Shopify Admin returned HTTP ${response.status}. Check credentials, scopes, or throttling; retry later.`);
      let payload;
      try { payload = await response.json(); } catch { throw new Error('Shopify Admin returned invalid JSON. Export again before retrying an apply.'); }
      if (payload.errors?.length || !plainObject(payload.data)) throw new Error('Shopify Admin rejected the query. Check read_translations, write_translations, read_locales scopes and API access.');
      return payload.data;
    },
  };
}

export async function fetchIdentity(client, locales, requirePublished = false) {
  validateLocales(locales);
  const result = await client.query(IDENTITY_QUERY);
  if (!/^gid:\/\/shopify\/Shop\/\d+$/.test(result.shop?.id) || !Array.isArray(result.shopLocales) ||
      result.shopLocales.some((item) => !item || typeof item.locale !== 'string' || typeof item.primary !== 'boolean' || typeof item.published !== 'boolean')) {
    throw new Error('Shopify returned incomplete store identity or locale data.');
  }
  if (result.shopLocales.filter((item) => item.primary).length !== 1 || !result.shopLocales.some((item) => item.primary && item.locale === 'en')) {
    throw new Error('This reference connector requires an English primary Shopify locale.');
  }
  for (const locale of locales) {
    const setting = result.shopLocales.find((item) => item.locale === locale);
    if (!setting || (requirePublished && !setting.published)) throw new Error(`Enable${requirePublished ? ' and publish' : ''} ${locale} in Shopify Languages before continuing. This connector does not modify language or market settings.`);
  }
  return {shopId: result.shop.id, shopLocales: result.shopLocales};
}

function normalizeResource(raw, type, locales) {
  if (!raw || !new RegExp(`^gid://shopify/${RESOURCE_GIDS[type]}/\\d+$`).test(raw.resourceId) || !Array.isArray(raw.translatableContent)) {
    throw new Error('Shopify returned an invalid translatable resource.');
  }
  const seen = new Set();
  const content = raw.translatableContent.map((field) => {
    if (!field || typeof field.key !== 'string' || !field.key || typeof field.value !== 'string' ||
        typeof field.digest !== 'string' || !field.digest || field.locale !== 'en' || seen.has(field.key)) {
      throw new Error('Shopify returned incomplete or non-English translatable content.');
    }
    seen.add(field.key);
    return {key: field.key, value: field.value, digest: field.digest, locale: field.locale};
  }).sort((a, b) => a.key.localeCompare(b.key, 'en'));
  const existing = {};
  for (const [index, locale] of locales.entries()) {
    if (!Array.isArray(raw[`t${index}`])) throw new Error('Shopify omitted existing translation data; refusing to treat it as empty.');
    existing[locale] = {};
    for (const item of raw[`t${index}`]) {
      if (!item || typeof item.key !== 'string' || typeof item.value !== 'string' || item.locale !== locale || typeof item.outdated !== 'boolean' || !Object.hasOwn(item, 'market')) {
        throw new Error('Shopify returned invalid existing translations.');
      }
      // This connector manages global translations only; market overrides remain untouched.
      if (item.market !== null) continue;
      if (Object.hasOwn(existing[locale], item.key)) throw new Error('Shopify returned duplicate global translations.');
      existing[locale][item.key] = {value: item.value, outdated: item.outdated};
    }
  }
  return {resourceId: raw.resourceId, type, content, existing};
}

export async function fetchResources(client, locales, maxResources = 10000) {
  validateLocales(locales);
  if (!Number.isSafeInteger(maxResources) || maxResources < 1 || maxResources > 100000) throw new Error('--max-resources must be between 1 and 100000.');
  const resources = [];
  const ids = new Set();
  for (const type of Object.keys(RESOURCE_FIELDS)) {
    let after = null;
    const cursors = new Set();
    do {
      const result = await client.query(`query CatalogExport($type: TranslatableResourceType!, $after: String) {
        translatableResources(first: 50, after: $after, resourceType: $type) {
          nodes { ${resourceSelection(locales)} } pageInfo { hasNextPage endCursor }
        }
      }`, {type, after});
      const connection = result.translatableResources;
      if (!Array.isArray(connection?.nodes) || typeof connection.pageInfo?.hasNextPage !== 'boolean') throw new Error('Shopify returned an incomplete catalog page.');
      for (const raw of connection.nodes) {
        const resource = normalizeResource(raw, type, locales);
        if (ids.has(resource.resourceId)) throw new Error('Shopify returned duplicate resources.');
        ids.add(resource.resourceId);
        resources.push(resource);
        if (resources.length > maxResources) throw new Error('Catalog exceeds --max-resources; nothing was saved. Increase the cap and retry.');
      }
      if (!connection.pageInfo.hasNextPage) break;
      after = connection.pageInfo.endCursor;
      if (typeof after !== 'string' || !after || cursors.has(after) || !connection.nodes.length) throw new Error('Shopify returned invalid pagination.');
      cursors.add(after);
    } while (after !== null);
  }
  return resources.sort((a, b) => a.resourceId.localeCompare(b.resourceId, 'en'));
}

export function sourceFingerprint(state) {
  return hash({shopId: state.shopId, storeDomain: state.storeDomain, locales: state.locales,
    resources: state.resources.map(({resourceId, type, content}) => ({resourceId, type, content}))});
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw new Error('Cannot read connector JSON. Restore its local state or rerun export.');
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), {recursive: true, mode: 0o700});
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, {flag: 'wx', mode: 0o600});
    await rename(temp, path);
  } finally { await unlink(temp).catch(() => {}); }
}

export async function readState(directory) {
  const state = await readJson(join(directory, 'state.json'));
  if (!state || state.version !== 1 || state.apiVersion !== API_VERSION || state.sourceLocale !== 'en' || !Array.isArray(state.resources) ||
      !plainObject(state.generated) || !plainObject(state.managed) || !/^gid:\/\/shopify\/Shop\/\d+$/.test(state.shopId)) throw new Error('Invalid connector state. Run export.');
  normalizeAdminDomain(state.storeDomain);
  validateLocales(state.locales);
  const resourceIds = new Set();
  for (const resource of state.resources) {
    if (!RESOURCE_FIELDS[resource.type] || resourceIds.has(resource.resourceId)) throw new Error('Invalid connector resources.');
    resourceIds.add(resource.resourceId);
    normalizeResource({resourceId: resource.resourceId, translatableContent: resource.content,
      ...Object.fromEntries(state.locales.map((locale, index) => [`t${index}`, Object.entries(resource.existing?.[locale] ?? {}).map(([key, value]) => ({key, ...value, locale, market: null}))])),
    }, resource.type, state.locales);
    if (state.locales.some((locale) => !plainObject(resource.existing?.[locale]))) throw new Error('Existing translations missing from connector state.');
  }
  for (const values of [state.generated, state.managed]) {
    if (Object.values(values).some((item) => !item || typeof item.value !== 'string' || !item.value.trim() || typeof item.digest !== 'string' || !item.digest)) throw new Error('Invalid local translation state.');
  }
  if (state.sourceHash !== sourceFingerprint(state)) throw new Error('Connector source was edited. Rerun export before translating or applying.');
  return state;
}

export async function exportCatalog({directory, client, locales = ['fr', 'ja'], maxResources}) {
  const prior = await readJson(join(directory, 'state.json'), null);
  if (prior && prior.storeDomain !== client.storeDomain) throw new Error('Connector state belongs to a different store. Use a separate state directory.');
  const identity = await fetchIdentity(client, locales);
  if (prior && prior.shopId !== identity.shopId) throw new Error('Shopify account differs from this connector state. Use a separate state directory.');
  const resources = await fetchResources(client, locales, maxResources);
  const generated = {};
  const managed = {};
  // A corrupt prior snapshot cannot be used as evidence that we own merchant content.
  if (prior) await readState(directory);
  for (const resource of resources) for (const field of resource.content) for (const locale of locales) {
    if (!supported(resource.type, field)) continue;
    const id = entryId(resource.resourceId, field.key, locale);
    if (prior?.generated[id]?.digest === field.digest) generated[id] = prior.generated[id];
    if (prior?.managed[id]) managed[id] = prior.managed[id];
  }
  const state = {version: 1, apiVersion: API_VERSION, storeDomain: client.storeDomain,
    ...identity, sourceLocale: 'en', locales, exportedAt: new Date().toISOString(), resources, generated, managed};
  state.sourceHash = sourceFingerprint(state);
  await writeJson(join(directory, 'state.json'), state);
  return state;
}

function merchantOwned(state, resource, field, locale) {
  const existing = resource.existing[locale][field.key];
  const managed = state.managed[entryId(resource.resourceId, field.key, locale)];
  return existing !== undefined && (!managed || managed.value !== existing.value);
}

/** The translator is injected; only the CLI translate command creates a GT client. */
export async function translateCatalog({directory, translator}) {
  const state = await readState(directory);
  const initialHash = hash(state);
  let lastHash = initialHash;
  const failures = [];
  for (const locale of state.locales) {
    const pending = [];
    for (const resource of state.resources) for (const field of resource.content) {
      if (!supported(resource.type, field) || merchantOwned(state, resource, field, locale)) continue;
      const id = entryId(resource.resourceId, field.key, locale);
      if (state.generated[id]?.digest === field.digest) continue;
      pending.push({id, resource, field});
    }
    for (let start = 0; start < pending.length; start += 20) {
      const batch = pending.slice(start, start + 20);
      let results;
      try {
        results = await translator.translateMany(batch.map(({id, resource, field}) => ({source: field.value,
          metadata: {id, dataFormat: 'STRING', context: `Shopify ${resource.type} ${field.key}. Preserve product brand names, measurements, and model numbers. Translate this merchant-authored catalog text.`}})),
        {sourceLocale: 'en', targetLocale: locale}, 120000);
      } catch { results = []; }
      if (!Array.isArray(results) || results.length !== batch.length) results = [];
      for (const [index, {id, field}] of batch.entries()) {
        const result = results[index];
        if (result?.success === true && result.locale === locale && result.dataFormat === 'STRING' && typeof result.translation === 'string' && result.translation.trim()) {
          state.generated[id] = {digest: field.digest, value: result.translation};
        } else failures.push({id, reason: 'GT did not return a valid translation; rerun translate to retry.'});
      }
      if (hash(await readState(directory)) !== lastHash) throw new Error('Connector state changed during translation. Export and retry; this batch was not saved.');
      await writeJson(join(directory, 'state.json'), state);
      lastHash = hash(state);
    }
  }
  return {state, failures};
}

export function buildPlan(state) {
  const changes = [], protectedFields = [], missing = [], unsupported = [];
  for (const resource of state.resources) for (const field of resource.content) {
    if (!supported(resource.type, field)) {
      if (field.value.trim()) unsupported.push({resourceId: resource.resourceId, key: field.key, reason: 'Outside this reference connector’s plain-text product scope.'});
      continue;
    }
    for (const locale of state.locales) {
      const id = entryId(resource.resourceId, field.key, locale);
      const current = resource.existing[locale][field.key];
      const generated = state.generated[id];
      if (merchantOwned(state, resource, field, locale)) {
        protectedFields.push({resourceId: resource.resourceId, key: field.key, locale});
      } else if (!generated || generated.digest !== field.digest) {
        missing.push({resourceId: resource.resourceId, key: field.key, locale});
      } else if (current?.value !== generated.value || current.outdated) {
        changes.push({resourceId: resource.resourceId, type: resource.type, key: field.key, locale,
          source: field.value, digest: field.digest, before: current ?? null, value: generated.value});
      }
    }
  }
  const plan = {version: 1, apiVersion: API_VERSION, storeDomain: state.storeDomain, shopId: state.shopId,
    sourceHash: state.sourceHash, locales: state.locales, changes, protectedFields, missing, unsupported};
  return {...plan, planHash: hash(plan)};
}

export async function savePlan(directory) {
  const plan = buildPlan(await readState(directory));
  await writeJson(join(directory, 'plan.json'), plan);
  return plan;
}

async function getCurrentResource(client, resource, locales) {
  const result = await client.query(`query CatalogCurrent($resourceId: ID!) {
    translatableResource(resourceId: $resourceId) { ${resourceSelection(locales)} }
  }`, {resourceId: resource.resourceId});
  if (!result.translatableResource) throw new Error('A planned resource was deleted. Export, translate, and plan again.');
  return normalizeResource(result.translatableResource, resource.type, locales);
}

function checkChange(current, change) {
  const source = current.content.find((field) => field.key === change.key);
  if (!source || source.digest !== change.digest || source.value !== change.source) throw new Error('Source content changed after export. No stale translation will be registered. Export, translate, and plan again.');
  const existing = current.existing[change.locale][change.key] ?? null;
  if (existing?.value === change.value && !existing.outdated) return false;
  if (hash(existing) !== hash(change.before)) throw new Error('A Shopify translation changed after planning. It was protected; export and plan again.');
  return true;
}

/** Apply performs two read checks, but Shopify has no CAS for target translations; avoid concurrent editors. */
export async function applyPlan({directory, client, planHash}) {
  const state = await readState(directory);
  const plan = await readJson(join(directory, 'plan.json'));
  const {planHash: storedHash, ...body} = plan;
  if (!planHash || storedHash !== planHash || hash(body) !== planHash) throw new Error('Review .shopify-catalog/plan.json, then pass its exact --plan-hash to apply.');
  if (plan.storeDomain !== client.storeDomain || plan.shopId !== state.shopId || plan.sourceHash !== state.sourceHash ||
      plan.apiVersion !== API_VERSION || !Array.isArray(plan.changes) || hash(plan.locales) !== hash(state.locales)) throw new Error('Plan does not match the configured store or current source. Export and plan again.');
  const identity = await fetchIdentity(client, state.locales, true);
  if (identity.shopId !== state.shopId) throw new Error('Shopify account differs from the reviewed plan.');
  const groups = new Map();
  const seen = new Set();
  for (const change of plan.changes) {
    const resource = state.resources.find((item) => item.resourceId === change.resourceId && item.type === change.type);
    const field = resource?.content.find((item) => item.key === change.key);
    const id = entryId(change.resourceId, change.key, change.locale);
    if (!resource || !field || !supported(resource.type, field) || !state.locales.includes(change.locale) ||
        field.digest !== change.digest || field.value !== change.source || state.generated[id]?.value !== change.value ||
        state.generated[id]?.digest !== change.digest || seen.has(id) || merchantOwned(state, resource, field, change.locale)) throw new Error('Plan has changes outside the exported, GT-generated, connector-owned scope. Generate a fresh plan.');
    seen.add(id);
    if (!groups.has(resource.resourceId)) groups.set(resource.resourceId, {resource, changes: []});
    groups.get(resource.resourceId).changes.push(change);
  }
  // Preflight the entire plan before the first write, so a known conflict cannot cause a partial apply.
  for (const {resource, changes} of groups.values()) {
    const current = await getCurrentResource(client, resource, state.locales);
    changes.forEach((change) => checkChange(current, change));
  }
  let applied = 0, alreadyCurrent = 0;
  for (const {resource, changes} of groups.values()) {
    const current = await getCurrentResource(client, resource, state.locales);
    const pending = changes.filter((change) => {
      const needed = checkChange(current, change);
      if (!needed) alreadyCurrent++;
      return needed;
    });
    if (!pending.length) continue;
    // A product has at most four supported fields × ten locales, below Shopify's input-array limit.
    const result = await client.query(REGISTER, {resourceId: resource.resourceId, translations: pending.map((change) => ({
      locale: change.locale, key: change.key, value: change.value, translatableContentDigest: change.digest,
    }))});
    const payload = result.translationsRegister;
    if (!payload || !Array.isArray(payload.userErrors) || payload.userErrors.length || !Array.isArray(payload.translations) ||
        pending.some((change) => !payload.translations.some((item) => item.key === change.key && item.locale === change.locale && item.value === change.value && item.outdated === false))) {
      throw new Error('Shopify did not confirm every planned translation. Earlier resources may have succeeded. Export and review a new plan before retrying.');
    }
    for (const change of pending) {
      state.managed[entryId(change.resourceId, change.key, change.locale)] = {digest: change.digest, value: change.value};
      resource.existing[change.locale][change.key] = {value: change.value, outdated: false};
      applied++;
    }
    // Persist receipts after every confirmed resource, so a later failure is safely resumable.
    await writeJson(join(directory, 'state.json'), state);
  }
  return {applied, alreadyCurrent};
}

const HELP = `Local GT → Shopify catalog reference connector (Admin API ${API_VERSION})
  node scripts/shopify-catalog.mjs export     Read Shopify sources, digests, and existing translations
  node scripts/shopify-catalog.mjs translate  Send missing supported strings to GT; save results locally
  node scripts/shopify-catalog.mjs plan       Write a reviewable local plan; no network or Shopify writes
  node scripts/shopify-catalog.mjs apply --plan-hash HASH  Register the reviewed translations in Shopify
  node scripts/shopify-catalog.mjs status     Show local coverage; no network

Options: --env-file PATH (default .env.shopify-catalog), --directory PATH (default .shopify-catalog),
         --locales fr,ja, --max-resources 10000, --plan-hash HASH
Env: SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_ACCESS_TOKEN; GT_PROJECT_ID and GT_API_KEY for translate.
Scopes: read_translations, write_translations, read_locales. English source; targets must be enabled.
Apply requires published targets. Does not enable languages, change markets, prices, or checkout.
Scope: product titles/type/SEO text, option names and values. Rich HTML, handles, other resource types,
market overrides, webhooks, and OAuth installation are not implemented. See docs/SHOPIFY-CATALOG.md.`;

function summary(plan) {
  return {changes: plan.changes.length, protected: plan.protectedFields.length, missing: plan.missing.length,
    unsupported: plan.unsupported.length, planHash: plan.planHash};
}

export async function main(args = process.argv.slice(2)) {
  const {values, positionals} = parseArgs({args, allowPositionals: true, options: {
    'env-file': {type: 'string'}, directory: {type: 'string'}, locales: {type: 'string'},
    'max-resources': {type: 'string'}, 'plan-hash': {type: 'string'}, help: {type: 'boolean', short: 'h'},
  }});
  if (values.help || !positionals.length) { console.log(HELP); return; }
  const [command] = positionals;
  if (positionals.length !== 1 || !['export', 'translate', 'plan', 'apply', 'status'].includes(command)) throw new Error('Use export, translate, plan, apply, or status.');
  const directory = resolve(ROOT, values.directory || '.shopify-catalog');
  let fileEnv = {};
  try { fileEnv = parseEnv(await readFile(resolve(ROOT, values['env-file'] || '.env.shopify-catalog'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read .env.shopify-catalog.'); }
  const env = {...fileEnv, ...process.env};
  await mkdir(directory, {recursive: true, mode: 0o700});
  const lockPath = join(directory, '.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); } catch { throw new Error('Another connector command holds .shopify-catalog/.lock. If a previous process crashed, confirm it stopped before removing that file.'); }
  try {
    if (command === 'status') { console.log(JSON.stringify(summary(buildPlan(await readState(directory))), null, 2)); return; }
    if (command === 'plan') { console.log(JSON.stringify(summary(await savePlan(directory)), null, 2)); return; }
    if (command === 'translate') {
      if (!env.GT_API_KEY || !env.GT_PROJECT_ID) throw new Error('Set GT_PROJECT_ID and GT_API_KEY in .env.shopify-catalog, then run translate locally.');
      const {GT} = await import('generaltranslation');
      const result = await translateCatalog({directory, translator: new GT({apiKey: env.GT_API_KEY, projectId: env.GT_PROJECT_ID, sourceLocale: 'en'})});
      console.log(JSON.stringify({...summary(buildPlan(result.state)), failed: result.failures.length}, null, 2));
      if (result.failures.length) process.exitCode = 1;
      return;
    }
    const client = createAdminClient({storeDomain: env.SHOPIFY_STORE_DOMAIN, token: env.SHOPIFY_ADMIN_ACCESS_TOKEN});
    if (command === 'export') {
      const locales = (values.locales || env.SHOPIFY_CATALOG_LOCALES || 'fr,ja').split(',').map((locale) => locale.trim());
      const state = await exportCatalog({directory, client, locales, maxResources: values['max-resources'] ? Number(values['max-resources']) : 10000});
      console.log(JSON.stringify({resources: state.resources.length, ...summary(buildPlan(state))}, null, 2));
    } else console.log(JSON.stringify(await applyPlan({directory, client, planHash: values['plan-hash']}), null, 2));
  } finally { await lock.close(); await unlink(lockPath); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
