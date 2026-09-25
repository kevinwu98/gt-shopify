import {createHash, randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseEnv} from 'node:util';
import {catalogKey} from '../app/lib/catalogKeys.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TARGET_LOCALES = ['fr', 'ja'];
const KEY_PATTERN = /^product_[1-9]\d*_(?:title|description|option_[a-f\d]*_(?:name|value_[a-f\d]*))$/;
const QUERY = `#graphql
  query CatalogExport($first: Int!, $after: String) @inContext(language: EN) {
    products(first: $first, after: $after, sortKey: ID) {
      nodes {
        id
        title
        description
        options { name optionValues { name } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function sorted(dictionary) {
  return Object.fromEntries(Object.entries(dictionary).sort(([a], [b]) => a.localeCompare(b, 'en')));
}

export function sourceHash(source) {
  return createHash('sha256').update(JSON.stringify(sorted(source))).digest('hex');
}

function validateDictionary(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a flat JSON object.`);
  }
  for (const [key, text] of Object.entries(value)) {
    if (!KEY_PATTERN.test(key) || typeof text !== 'string') {
      throw new Error(`${label} must contain only catalog keys and string values.`);
    }
  }
  return value;
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw new Error(`Cannot read valid JSON from ${path}. Restore or correct that file.`);
  }
}

async function writeJson(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, {flag: 'wx'});
    await rename(temp, path);
  } finally {
    await unlink(temp).catch(() => {});
  }
}

export function normalizeStoreDomain(domain) {
  if (typeof domain !== 'string' || !domain.trim()) {
    throw new Error('Configure PUBLIC_STORE_DOMAIN in .env or the environment.');
  }
  const candidate = domain.trim().toLowerCase();
  // Restrict where Storefront credentials can be sent; no arbitrary endpoint flag.
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(candidate)) {
    throw new Error('PUBLIC_STORE_DOMAIN must be a bare myshopify.com store domain.');
  }
  return candidate;
}

/** Reads only products published to the configured Storefront channel. */
export async function fetchCatalog({
  storeDomain,
  publicToken,
  privateToken,
  apiVersion = '2026-04',
  maxProducts = 10000,
  fetchImpl = fetch,
}) {
  const domain = normalizeStoreDomain(storeDomain);
  if (!/^\d{4}-(01|04|07|10)$/.test(apiVersion)) throw new Error('Invalid Shopify API version.');
  if (!Number.isSafeInteger(maxProducts) || maxProducts < 1 || maxProducts > 100000) {
    throw new Error('--max-products must be between 1 and 100000.');
  }
  if (!publicToken && !privateToken) {
    throw new Error('Configure PUBLIC_STOREFRONT_API_TOKEN or PRIVATE_STOREFRONT_API_TOKEN in .env.');
  }
  const products = [];
  const cursors = new Set();
  const ids = new Set();
  let after = null;
  do {
    let response;
    try {
      response = await fetchImpl(`https://${domain}/api/${apiVersion}/graphql.json`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          ...(privateToken
            ? {'Shopify-Storefront-Private-Token': privateToken}
            : {'X-Shopify-Storefront-Access-Token': publicToken}),
        },
        body: JSON.stringify({query: QUERY, variables: {first: 100, after}}),
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new Error('Shopify catalog request failed. Check the connection and retry; existing files were not changed.');
    }
    if (!response.ok) {
      throw new Error(`Shopify returned HTTP ${response.status}. Check Storefront credentials and product publication; existing files were not changed.`);
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error('Shopify returned invalid JSON; existing files were not changed.');
    }
    if (payload.errors?.length) {
      throw new Error('Shopify rejected the catalog query. Check the API version and Storefront permissions; existing files were not changed.');
    }
    const connection = payload.data?.products;
    if (!Array.isArray(connection?.nodes) || typeof connection.pageInfo?.hasNextPage !== 'boolean') {
      throw new Error('Shopify returned an incomplete product page; existing files were not changed.');
    }
    for (const product of connection.nodes) {
      // Validate every product before accepting the export, including the last page.
      productEntries(product);
      if (ids.has(product.id)) throw new Error('Shopify returned duplicate products. Retry the export.');
      ids.add(product.id);
      products.push(product);
    }
    if (products.length > maxProducts) {
      throw new Error('Catalog exceeds --max-products. Increase the limit and rerun; existing files were not changed.');
    }
    if (!connection.pageInfo.hasNextPage) break;
    after = connection.pageInfo.endCursor;
    if (typeof after !== 'string' || !after || cursors.has(after) || !connection.nodes.length) {
      throw new Error('Shopify returned invalid pagination; existing files were not changed.');
    }
    if (products.length >= maxProducts) {
      throw new Error('Catalog exceeds --max-products. Increase the limit and rerun; existing files were not changed.');
    }
    cursors.add(after);
  } while (after !== null);
  return products;
}

function productEntries(product) {
  if (!product || typeof product.title !== 'string' || !product.title.trim() ||
      typeof product.description !== 'string' || !Array.isArray(product.options)) {
    throw new Error('Shopify returned invalid product content; existing files were not changed.');
  }
  const source = {
    [catalogKey(product.id, 'title')]: product.title,
    [catalogKey(product.id, 'description')]: product.description,
  };
  for (const option of product.options) {
    if (typeof option.name !== 'string' || !Array.isArray(option.optionValues)) {
      throw new Error('Shopify returned invalid product options; existing files were not changed.');
    }
    source[catalogKey(product.id, 'optionName', option.name)] = option.name;
    for (const value of option.optionValues) {
      if (typeof value.name !== 'string') throw new Error('Shopify returned an invalid option value.');
      source[catalogKey(product.id, 'optionValue', option.name, value.name)] = value.name;
    }
  }
  return source;
}

export function buildSource(products) {
  const source = {};
  for (const product of products) Object.assign(source, productEntries(product));
  return sorted(source);
}

export function pruneTranslations(previousSource, source, translations, sameStore = true) {
  return sorted(Object.fromEntries(Object.entries(source)
    .filter(([key, text]) => sameStore && previousSource[key] === text &&
      typeof translations[key] === 'string' && (!text.trim() || translations[key].trim()))
    .map(([key]) => [key, translations[key]])));
}

export async function readCatalog(directory = join(ROOT, 'catalog')) {
  const source = validateDictionary(await readJson(join(directory, 'en.json'), {}), 'English catalog');
  const manifest = await readJson(join(directory, 'manifest.json'), null);
  const translations = {};
  for (const locale of TARGET_LOCALES) {
    translations[locale] = validateDictionary(await readJson(join(directory, `${locale}.json`), {}), `${locale} catalog`);
  }
  return {source, translations, manifest};
}

function validateSourceManifest({source, manifest}) {
  if (!manifest || manifest.version !== 1 || manifest.sourceLocale !== 'en' ||
      manifest.sourceHash !== sourceHash(source) || !manifest.storeDomain ||
      !Number.isSafeInteger(manifest.productCount) || manifest.productCount < 1) {
    throw new Error('Catalog source is missing or does not match its manifest. Run npm run catalog:sync before translating.');
  }
  normalizeStoreDomain(manifest.storeDomain);
}

/** Fetch and validate the entire catalog before replacing any local files. */
export async function syncCatalog({directory = join(ROOT, 'catalog'), allowStoreChange = false, ...options}) {
  const previous = await readCatalog(directory);
  const storeDomain = normalizeStoreDomain(options.storeDomain);
  const sameStore = previous.manifest?.storeDomain === storeDomain;
  if (previous.manifest?.storeDomain && !sameStore && !allowStoreChange) {
    throw new Error('This export points to a different Shopify store. Use --allow-store-change to replace the source and reset translations.');
  }
  const products = await fetchCatalog({...options, storeDomain});
  if (!products.length) {
    throw new Error('No published products were returned. Check Storefront publication; existing files were not changed.');
  }
  const source = buildSource(products);
  const previousIsValid = previous.manifest?.sourceHash === sourceHash(previous.source);
  const translations = {};
  for (const locale of TARGET_LOCALES) {
    translations[locale] = pruneTranslations(previous.source, source, previous.translations[locale], sameStore && previousIsValid);
  }
  const unchanged = sameStore && previousIsValid && sourceHash(source) === previous.manifest.sourceHash;
  const manifest = {
    version: 1,
    storeDomain,
    sourceLocale: 'en',
    targetLocales: TARGET_LOCALES,
    productCount: products.length,
    exportedAt: unchanged ? previous.manifest.exportedAt : new Date().toISOString(),
    sourceHash: sourceHash(source),
  };
  await mkdir(directory, {recursive: true});
  for (const locale of TARGET_LOCALES) await writeJson(join(directory, `${locale}.json`), translations[locale]);
  await writeJson(join(directory, 'en.json'), source);
  await writeJson(join(directory, 'manifest.json'), manifest);
  return {source, translations, manifest};
}

export function catalogStatus({source, translations, manifest}) {
  validateSourceManifest({source, manifest});
  return Object.fromEntries(TARGET_LOCALES.map((locale) => {
    const dictionary = translations[locale];
    const missing = Object.keys(source).filter((key) =>
      typeof dictionary[key] !== 'string' || (source[key].trim() && !dictionary[key].trim()));
    const stale = Object.keys(dictionary).filter((key) => !Object.hasOwn(source, key));
    return [locale, {total: Object.keys(source).length, translated: Object.keys(source).length - missing.length, missing: missing.length, stale: stale.length}];
  }));
}

function entryContext(key) {
  const field = key.endsWith('_title') ? 'product title'
    : key.endsWith('_description') ? 'plain-text product description'
      : key.endsWith('_name') ? 'product option label' : 'product option value';
  return `Translate this Shopify storefront ${field} for shoppers. Translate descriptive words naturally. Preserve brand names, distinctive model names, measurements, sizes, and technical codes when appropriate. Return plain text without HTML, markdown, or commentary. Product IDs and purchasing data are managed separately.`;
}

/** Runs at authoring time. Failed entries stay missing and fall back to English. */
export async function translateCatalog({
  directory = join(ROOT, 'catalog'),
  translator,
  batchSize = 20,
  onProgress = () => {},
}) {
  const catalog = await readCatalog(directory);
  validateSourceManifest(catalog);
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 50) throw new Error('Translation batch size must be between 1 and 50.');
  const failures = [];
  for (const locale of TARGET_LOCALES) {
    const current = pruneTranslations(catalog.source, catalog.source, catalog.translations[locale]);
    const keys = Object.keys(catalog.source).filter((key) => !Object.hasOwn(current, key));
    // Empty descriptions do not require a translation service request.
    for (const key of keys.filter((key) => !catalog.source[key].trim())) current[key] = catalog.source[key];
    const pending = keys.filter((key) => catalog.source[key].trim());
    for (let start = 0; start < pending.length; start += batchSize) {
      const batch = pending.slice(start, start + batchSize);
      let results;
      try {
        results = await translator.translateMany(batch.map((key) => ({
          source: catalog.source[key],
          metadata: {id: key, dataFormat: 'STRING', context: entryContext(key)},
        })), {sourceLocale: 'en', targetLocale: locale}, 120000);
      } catch {
        failures.push({locale, keys: batch, reason: 'request failed'});
        // Preserve validated earlier batches, but do not repeat a likely credential/quota error.
        break;
      }
      if (!Array.isArray(results) || results.length !== batch.length) {
        failures.push({locale, keys: batch, reason: 'invalid batch response'});
        break;
      }
      for (let index = 0; index < batch.length; index++) {
        const result = results[index];
        let language;
        try { language = new Intl.Locale(result?.locale).language; } catch { /* invalid response */ }
        if (result?.success === true && result.dataFormat === 'STRING' && language === locale &&
            typeof result.translation === 'string' && result.translation.trim()) {
          current[batch[index]] = result.translation;
        } else {
          failures.push({locale, keys: [batch[index]], reason: 'missing or invalid translation'});
        }
      }
      await verifyUnchangedSource(directory, catalog);
      await writeJson(join(directory, `${locale}.json`), sorted(current));
      onProgress({locale, completed: Math.min(start + batchSize, pending.length), total: pending.length});
    }
    await verifyUnchangedSource(directory, catalog);
    await writeJson(join(directory, `${locale}.json`), sorted(current));
    catalog.translations[locale] = current;
  }
  return {catalog, failures};
}

async function verifyUnchangedSource(directory, original) {
  const latest = await readCatalog(directory);
  validateSourceManifest(latest);
  if (latest.manifest.storeDomain !== original.manifest.storeDomain ||
      latest.manifest.sourceHash !== original.manifest.sourceHash) {
    throw new Error('Catalog source changed during translation. Rerun catalog:translate against the updated source.');
  }
}

function parseArguments(args) {
  const [command = 'status', ...rest] = args;
  const options = {command};
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index];
    if (flag === '--allow-store-change') { options.allowStoreChange = true; continue; }
    if (!['--env-file', '--max-products', '--api-version'].includes(flag) || !rest[index + 1] || rest[index + 1].startsWith('--')) {
      throw new Error('Expected sync|translate|status|check with --env-file PATH, --max-products N, --api-version YYYY-MM, or --allow-store-change.');
    }
    options[flag.slice(2)] = rest[++index];
  }
  if (!['sync', 'translate', 'status', 'check'].includes(command)) throw new Error('Expected sync, translate, status, or check.');
  return options;
}

async function envFile(path, optional = false) {
  if (optional && !existsSync(path)) return {};
  try { return parseEnv(await readFile(path, 'utf8')); } catch { throw new Error(`Cannot read environment file ${path}.`); }
}

function printStatus(catalog) {
  const status = catalogStatus(catalog);
  console.log(`Catalog: ${catalog.manifest.productCount} products; source en; exported ${catalog.manifest.exportedAt}.`);
  for (const [locale, counts] of Object.entries(status)) {
    console.log(`${locale}: ${counts.translated}/${counts.total} entries translated, ${counts.missing} missing, ${counts.stale} obsolete.`);
  }
  return Object.values(status).every((counts) => counts.missing === 0 && counts.stale === 0);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.command === 'sync') {
    const file = options['env-file'] || '.env';
    const path = isAbsolute(file) ? file : resolve(ROOT, file);
    const config = {...await envFile(path, !options['env-file']), ...process.env};
    const catalog = await syncCatalog({
      storeDomain: config.PUBLIC_STORE_DOMAIN,
      publicToken: config.PUBLIC_STOREFRONT_API_TOKEN,
      privateToken: config.PRIVATE_STOREFRONT_API_TOKEN,
      apiVersion: options['api-version'] || '2026-04',
      maxProducts: options['max-products'] ? Number(options['max-products']) : 10000,
      allowStoreChange: options.allowStoreChange,
    });
    printStatus(catalog);
    console.log('Catalog exported. New and changed English content needs catalog:translate.');
    return;
  }
  if (options.command === 'translate') {
    if (options['env-file']) throw new Error('Translation credentials must be in ignored .env.catalog or environment variables. --env-file is only for catalog:sync.');
    const config = {...await envFile(join(ROOT, '.env.catalog'), true), ...process.env};
    if (!config.GT_API_KEY || !config.GT_PROJECT_ID) {
      throw new Error('Set GT_API_KEY and GT_PROJECT_ID in ignored .env.catalog, then rerun npm run catalog:translate. Do not put the key in public/client environment variables.');
    }
    const {GT} = await import('generaltranslation');
    const result = await translateCatalog({
      translator: new GT({apiKey: config.GT_API_KEY, projectId: config.GT_PROJECT_ID, sourceLocale: 'en'}),
      onProgress: ({locale, completed, total}) => console.log(`${locale}: processed ${completed}/${total} pending entries.`),
    });
    const complete = printStatus(result.catalog);
    if (result.failures.length || !complete) {
      console.error('Some entries were not translated. Successful results were saved; missing entries fall back to English. Check the GT project/key, quota, and network, then rerun catalog:translate.');
      process.exitCode = 1;
    }
    return;
  }
  const complete = printStatus(await readCatalog());
  if (options.command === 'check' && !complete) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
