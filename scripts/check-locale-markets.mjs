import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Uses only this app's pages/actions, never the Shopify API directly.
// LIVE_CART_CHECK=1 additionally creates and removes one isolated test-cart line.
const baseUrl = new URL(process.argv[2] || process.env.LOCALE_MARKET_BASE_URL || 'http://localhost:3140');
assert.ok(['http:', 'https:'].includes(baseUrl.protocol), 'Use an HTTP(S) storefront URL');
assert.ok(!baseUrl.username && !baseUrl.password, 'Do not put credentials in the URL');
const liveCart = process.env.LIVE_CART_CHECK === '1';
const authBypassToken = process.env.OXYGEN_AUTH_BYPASS_TOKEN;
const testStoreDomain = 'gt-supply-demo.myshopify.com';
const localeCookie = 'generaltranslation.locale';
const selections = [
  {locale: 'en', country: 'US', currency: 'USD'},
  {locale: 'fr', country: 'FR', currency: 'EUR'},
  {locale: 'id', country: 'ID', currency: 'IDR'},
  {locale: 'ja', country: 'JP', currency: 'JPY'},
  {locale: 'ko', country: 'KR', currency: 'KRW'},
];
const gtConfig = JSON.parse(await readFile(new URL('../gt.config.json', import.meta.url), 'utf8'));
assert.deepEqual(
  selections.map(({locale}) => locale).sort(),
  [...new Set([gtConfig.defaultLocale, ...gtConfig.locales])].sort(),
  'Update the live-check market expectations when configured languages change',
);
const cookies = new Map();
let checks = 0;
let createdLineId;
let createdCartId;
let creatingCart = false;
let merchandiseId;

function pass(message) {
  checks += 1;
  console.log(`PASS ${message}`);
}

function check(condition, message) {
  // Explicit messages avoid diagnostics printing private IDs, cookies, or loader data.
  assert.ok(condition, message);
}

async function request(path, options = {}) {
  const url = new URL(path, baseUrl);
  check(url.origin === baseUrl.origin, 'Requests must stay on the configured app origin');
  const headers = new Headers(options.headers);
  if (authBypassToken) headers.set('oxygen-auth-bypass-token', authBypassToken);
  if (cookies.size) headers.set('Cookie', [...cookies].map(([name, value]) => `${name}=${value}`).join('; '));
  if (options.method === 'POST') headers.set('Origin', baseUrl.origin);
  const response = await fetch(url, {...options, headers, redirect: 'manual', signal: AbortSignal.timeout(30000)});
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';', 1)[0];
    const separator = pair.indexOf('=');
    if (separator < 1) continue;
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (!value || /(?:^|;)\s*Max-Age=0(?:;|$)/i.test(cookie)) cookies.delete(name);
    else cookies.set(name, value);
  }
  return {response, text: await response.text()};
}

function status(result, expected, label) {
  check(result.response.status === expected, `${label}: expected HTTP ${expected}, received ${result.response.status}`);
}

function table(text) {
  let result;
  try { result = JSON.parse(text.split('\n')[0]); }
  catch { throw new Error('Expected a React Router single-fetch data response'); }
  check(Array.isArray(result), 'Expected a React Router single-fetch value table');
  return result;
}

// Follow references in the first turbo-stream frame; no deferred data is needed.
function value(data, ...path) {
  let reference = 0;
  for (const key of path) {
    const record = data[reference];
    check(record && typeof record === 'object', `Missing loader record before ${key}`);
    if (typeof key === 'number') {
      check(Array.isArray(record), 'Expected a loader array');
      reference = record[key];
    } else {
      const encodedKey = Object.keys(record).find((candidate) => /^_\d+$/.test(candidate) && data[Number(candidate.slice(1))] === key);
      check(encodedKey, `Missing loader field ${key}`);
      reference = record[encodedKey];
    }
    check(typeof reference === 'number', `Expected a loader reference for ${key}`);
  }
  return reference === -5 ? null : reference < 0 ? undefined : data[reference];
}

function initialMarkup(html) { return html.split(/<script\b/i)[0]; }

function decodeEntities(text) {
  return text.replace(/&(?:quot|amp|lt|gt|apos|#39|#x27);/g, (entity) => ({
    '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&apos;': "'", '&#39;': "'", '&#x27;': "'",
  })[entity]);
}

function visibleText(markup) {
  return decodeEntities(markup.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' '))
    .replace(/&#(x[\da-f]+|\d+);/gi, (entity, encoded) => {
      const code = encoded.toLowerCase().startsWith('x') ? parseInt(encoded.slice(1), 16) : Number(encoded);
      return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }).replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function cartInputs(markup) {
  return [...markup.matchAll(/<input\b[^>]*>/gi)].flatMap(([tag]) => {
    const attributes = Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, text]) => [key, decodeEntities(text)]));
    if (attributes.name !== 'cartFormInput' || !attributes.value) return [];
    try { return [JSON.parse(attributes.value)]; }
    catch { throw new Error('Invalid product/cart form input'); }
  });
}

function checkLocale(html, locale) {
  const markup = initialMarkup(html);
  check(new RegExp(`<html\\b[^>]*lang="${locale}"`).test(markup), `${locale}: wrong initial HTML language`);
  const selector = [...markup.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)]
    .find(([, attributes]) => /class="[^"]*\blocale-switcher\b/.test(attributes));
  check(selector, 'Missing server-rendered language selector');
  check(/\bname="locale"/.test(selector[1]), 'Selector must submit the locale to the app');
  const option = [...selector[2].matchAll(/<option\b([^>]*)>/gi)]
    .find(([, attributes]) => new RegExp(`\\bvalue="${locale}"`).test(attributes));
  check(option && /\bselected(?:\s|=|$)/.test(option[1]), `${locale}: selector differs from HTML language`);
  return markup;
}

function checkPrice(markup, locale, currency, amount, label) {
  check(typeof amount === 'string' && Number.isFinite(Number(amount)), `${label}: missing numeric Shopify price`);
  const expected = new Intl.NumberFormat(locale, {
    style: 'currency', currency,
    // Match the storefront's stable whole-rupiah display across ICU versions.
    ...(currency === 'IDR' ? {minimumFractionDigits: 0, maximumFractionDigits: 0} : {}),
  }).format(Number(amount)).replace(/\s+/g, ' ');
  check(visibleText(markup).includes(expected), `${label}: initial HTML must format Shopify's actual ${currency} amount in ${locale}`);
}

async function select(selection, returnTo, {allowUnavailable = false} = {}) {
  const previousCookies = JSON.stringify([...cookies]);
  const result = await request('/market', {
    method: 'POST', body: new URLSearchParams({locale: selection.locale, returnTo}),
  });
  if (allowUnavailable && result.response.status === 409) {
    let error;
    try { error = JSON.parse(result.text); }
    catch { throw new Error('Expected a structured market availability error'); }
    check(error.code === 'CART_MARKET_UNAVAILABLE', 'Only known cart availability conflicts may block switching');
    check(result.response.headers.getSetCookie().length === 0, 'Blocked selection must not write cookies');
    check(previousCookies === JSON.stringify([...cookies]), 'Blocked selection must retain all previous cookies');
    return false;
  }
  status(result, 303, `${selection.locale} selection`);
  check(result.response.headers.get('Location') === returnTo, 'Selection must preserve the same-page return URL');
  check(result.response.headers.get('X-Remix-Reload-Document') === 'true', 'Selection must request a full document reload');
  check(cookies.get(localeCookie) === selection.locale, 'Selection must write the GT-readable language cookie');
  check(cookies.has('session'), 'Selection must persist the market session');
  return true;
}

function checkRoot(data, {locale, country, currency}) {
  const root = ['root', 'data'];
  check(value(data, ...root, 'locale') === locale, `${locale}: GT root locale does not match selection`);
  check(value(data, ...root, 'markets', 'country', 'isoCode') === country, `${locale}: Shopify market country does not match`);
  check(value(data, ...root, 'markets', 'country', 'currency', 'isoCode') === currency, `${locale}: Shopify market currency does not match`);
  check(value(data, ...root, 'consent', 'country') === country, `${locale}: commerce country does not match`);
  check(value(data, ...root, 'consent', 'language') === 'EN', 'GT catalog integration must keep canonical Shopify source language English');
}

async function checkProduct(selection, productPath) {
  const loaded = await request(`${productPath}.data?_routes=root,routes/products.$handle`);
  status(loaded, 200, 'Product loaders');
  const data = table(loaded.text);
  checkRoot(data, selection);
  const variantPath = ['routes/products.$handle', 'data', 'product', 'selectedOrFirstAvailableVariant'];
  check(value(data, ...variantPath, 'id') === merchandiseId, 'Language/market selection must preserve the product variant');
  check(value(data, ...variantPath, 'price', 'currencyCode') === selection.currency, `${selection.locale}: product returned the wrong currency`);
  const document = await request(productPath, {headers: {'Accept-Language': selection.locale === 'en' ? 'ja' : 'en'}});
  status(document, 200, 'Product document');
  const markup = checkLocale(document.text, selection.locale);
  checkPrice(markup, selection.locale, selection.currency, value(data, ...variantPath, 'price', 'amount'), 'Product price');
  check(cartInputs(markup).some((input) => input.action === 'LinesAdd' && input.inputs?.lines?.some((line) => line.merchandiseId === merchandiseId)), 'Product HTML must preserve canonical purchase identifiers');
}

async function cartAction(action, inputs) {
  const result = await request('/cart.data', {method: 'POST', body: new URLSearchParams({cartFormInput: JSON.stringify({action, inputs})})});
  status(result, 200, action);
  const data = table(result.text);
  check(value(data, 'data', 'cartAction') === action, 'Unexpected cart action result');
  for (const field of ['errors', 'userErrors']) {
    const errors = value(data, 'data', field);
    check(!errors || errors.length === 0, `${action} returned ${field}`);
  }
  return data;
}

async function checkCart(selection) {
  const result = await request('/cart.data?_routes=root,routes/cart');
  status(result, 200, 'Cart loaders');
  const data = table(result.text);
  checkRoot(data, selection);
  const cart = ['routes/cart', 'data'];
  check(value(data, ...cart, 'id') === createdCartId, 'Language/market selection must retain the same cart');
  check(value(data, ...cart, 'buyerIdentity', 'countryCode') === selection.country, 'Cart buyer country does not match selected market');
  const quantity = value(data, ...cart, 'totalQuantity');
  check(quantity === 1, `${selection.locale}: selection must preserve total quantity (received ${typeof quantity === 'number' ? quantity : 'missing'})`);
  check(value(data, ...cart, 'lines', 'nodes').length === 1, 'Selection must preserve the isolated cart line');
  check(value(data, ...cart, 'lines', 'nodes', 0, 'id') === createdLineId, 'Selection must preserve the same line');
  check(value(data, ...cart, 'lines', 'nodes', 0, 'quantity') === 1, 'Selection must preserve line quantity');
  check(value(data, ...cart, 'lines', 'nodes', 0, 'cost', 'totalAmount', 'currencyCode') === selection.currency, 'Cart line currency does not match selected market');
  for (const field of ['subtotalAmount', 'totalAmount']) {
    check(value(data, ...cart, 'cost', field, 'currencyCode') === selection.currency, 'Cart total currency does not match selected market');
  }
  const document = await request('/cart');
  status(document, 200, 'Cart document');
  const markup = checkLocale(document.text, selection.locale);
  check(cartInputs(markup).some((input) => input.action === 'LinesRemove' && input.inputs.lineIds.includes(createdLineId)), 'Cart line must persist in initial HTML');
  checkPrice(markup, selection.locale, selection.currency, value(data, ...cart, 'cost', 'subtotalAmount', 'amount'), 'Cart subtotal');
}

async function cleanUp() {
  // The jar starts empty and belongs only to this process. Discover the added
  // line after an interrupted action only if its sole variant matches our add.
  if (!createdLineId && creatingCart && cookies.has('cart')) {
    const result = await request('/cart.data?_routes=routes/cart');
    status(result, 200, 'Cleanup cart lookup');
    const data = table(result.text);
    const nodes = ['routes/cart', 'data', 'lines', 'nodes'];
    if (value(data, ...nodes).length === 1 && value(data, ...nodes, 0, 'merchandise', 'id') === merchandiseId) {
      createdLineId = value(data, ...nodes, 0, 'id');
    }
  }
  if (!createdLineId) return;
  const removed = await cartAction('LinesRemove', {lineIds: [createdLineId]});
  check(value(removed, 'data', 'cart', 'totalQuantity') === 0, 'Cleanup should leave our isolated cart empty');
  createdLineId = undefined;
  creatingCart = false;
  pass('Removed only the test-created cart line; no checkout or order was attempted');
}

async function findProduct(productPaths, allMarkets) {
  for (const path of productPaths.slice(0, 12)) {
    await select(selections[0], path);
    const result = await request(path);
    status(result, 200, 'Product discovery');
    const input = cartInputs(initialMarkup(result.text)).find((entry) => entry.action === 'LinesAdd' && entry.inputs?.lines?.[0]?.selectedVariant?.availableForSale);
    if (!input) {
      if (allMarkets) console.log(`SKIP live-cart candidate ${path}: selected variant unavailable in US`);
      continue;
    }
    const candidateId = input.inputs.lines[0].merchandiseId;
    if (!allMarkets) return {path, merchandiseId: candidateId};
    // A cart-test product must be purchasable in every selected market;
    // checking only US inventory could legitimately remove a line elsewhere.
    let availableEverywhere = true;
    for (const selection of selections.slice(1)) {
      await select(selection, path);
      const candidate = await request(`${path}.data?_routes=routes/products.$handle`);
      status(candidate, 200, 'Market product availability');
      const candidateData = table(candidate.text);
      const variant = ['routes/products.$handle', 'data', 'product', 'selectedOrFirstAvailableVariant'];
      if (value(candidateData, ...variant, 'id') !== candidateId || value(candidateData, ...variant, 'availableForSale') !== true) {
        console.log(`SKIP live-cart candidate ${path}: same variant unavailable in ${selection.country}`);
        availableEverywhere = false;
        break;
      }
    }
    if (availableEverywhere) return {path, merchandiseId: candidateId};
  }
  return undefined;
}

async function main() {
  console.log(`Checking language and market selection at ${baseUrl.origin}`);
  const rootResult = await request('/_root.data?_routes=root');
  status(rootResult, 200, 'Initial root loader');
  const root = table(rootResult.text);
  const runtimeDomain = value(root, 'root', 'data', 'publicStoreDomain');
  if (liveCart) check(runtimeDomain === testStoreDomain, `Refusing cart mutations: running app must report ${testStoreDomain}`);
  const countries = ['root', 'data', 'markets', 'availableCountries'];
  const available = value(root, ...countries);
  check(Array.isArray(available), 'Missing available Shopify markets');
  for (const selection of selections) {
    const index = available.findIndex((_, i) => value(root, ...countries, i, 'isoCode') === selection.country);
    check(index >= 0, `${selection.country} must be available in Shopify Markets`);
    check(value(root, ...countries, index, 'currency', 'isoCode') === selection.currency, `${selection.country} must be configured with ${selection.currency}`);
  }
  pass('Shopify exposes all five expected countries and currencies');

  await select(selections[0], '/collections/all');
  const catalog = await request('/collections/all');
  status(catalog, 200, 'Product collection');
  const productPaths = [...new Set([...initialMarkup(catalog.text).matchAll(/href="(\/products\/[^"?#]+)[^"]*"/g)].map(([, path]) => decodeEntities(path)))];
  const initialProduct = await findProduct(productPaths, false);
  check(initialProduct, 'Expected an available test-store product');
  let productPath = initialProduct.path;
  merchandiseId = initialProduct.merchandiseId;

  for (const selection of selections) {
    await select(selection, `${productPath}?check=locale-market#details`);
    await checkProduct(selection, productPath);
    check(!cookies.has('cart'), 'Selecting a language without a cart must not create one');
    pass(`${selection.locale} → ${selection.country}/${selection.currency}: locale-only POST, persistent language/market, product currency and SSR formatting`);
  }

  if (!liveCart) {
    console.log('SKIP live cart: set LIVE_CART_CHECK=1 to verify an isolated cart on GT Supply Demo.');
    return;
  }
  const everywhereProduct = await findProduct(productPaths, true);
  const cartProduct = everywhereProduct || initialProduct;
  if (!everywhereProduct) console.log('INFO No product is available in all five markets; verifying unavailable-market switches preserve the original cart and language.');
  productPath = cartProduct.path;
  merchandiseId = cartProduct.merchandiseId;
  await select(selections[0], productPath);
  check(!cookies.has('cart'), 'Test must create its own cart from an empty isolated cookie jar');
  creatingCart = true;
  const added = await cartAction('LinesAdd', {lines: [{merchandiseId, quantity: 1}]});
  createdCartId = value(added, 'data', 'cart', 'id');
  // Hydrogen's cart mutation fragment is intentionally smaller than its full
  // cart loader; fetch the retained line from that loader after creation.
  const created = await request('/cart.data?_routes=routes/cart');
  status(created, 200, 'Created cart loader');
  const createdData = table(created.text);
  check(value(createdData, 'routes/cart', 'data', 'id') === createdCartId, 'Created cart must persist across loader requests');
  createdLineId = value(createdData, 'routes/cart', 'data', 'lines', 'nodes', 0, 'id');
  check(createdCartId && createdLineId && cookies.has('cart'), 'Add must create an isolated cart and line');
  await checkCart(selections[0]);
  pass('Created one isolated test-cart line in the selected US market');
  let currentSelection = selections[0];
  const blockedCountries = [];
  for (const selection of [...selections.slice(1), selections[0]]) {
    const changed = await select(selection, '/cart?check=locale-market#items', {allowUnavailable: true});
    if (changed) {
      currentSelection = selection;
      await checkCart(selection);
      await checkProduct(selection, productPath);
      pass(`${selection.locale} → ${selection.country}/${selection.currency}: same cart, line and quantity; matching buyer country, product/cart currency and SSR`);
    } else {
      blockedCountries.push(selection.country);
      await checkCart(currentSelection);
      await checkProduct(currentSelection, productPath);
      pass(`${selection.country} unavailable for this cart: switch rejected; original cart, line, quantity, language and market preserved`);
    }
  }
  await cleanUp();
  if (blockedCountries.length) console.log(`CONFIGURATION: The selected product is unavailable for ${blockedCountries.join(', ')}. Set up product/market and shipping availability before expecting an occupied cart to switch there.`);
}

try {
  await main();
  console.log(`\n${checks} language/market checks passed.`);
} catch (error) {
  let message = error instanceof Error ? error.message : 'Unexpected language/market check failure';
  for (const secret of [authBypassToken, createdCartId, createdLineId, cookies.get('cart'), cookies.get('session')].filter(Boolean)) {
    message = message.split(secret).join('[redacted]');
  }
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
} finally {
  if (createdLineId || (creatingCart && cookies.has('cart'))) {
    try { await cleanUp(); }
    catch {
      console.error('Could not clean up the isolated test-cart line; no checkout was attempted.');
      process.exitCode = 1;
    }
  }
}
