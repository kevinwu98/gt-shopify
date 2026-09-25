import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';

const baseUrl = new URL(process.env.SMOKE_BASE_URL || 'http://localhost:3101');
const demoDomain = 'hydrogen-preview.myshopify.com';
const config = {...parseEnv(await readFile(new URL('../.env', import.meta.url), 'utf8')), ...process.env};
const gtConfig = JSON.parse(await readFile(new URL('../gt.config.json', import.meta.url), 'utf8'));
const locales = [...new Set([gtConfig.defaultLocale, ...gtConfig.locales])];
const translatedLocales = locales.filter((locale) => locale !== gtConfig.defaultLocale);
const cookies = new Map();
let checks = 0;
let createdLineId;

function pass(message) {
  checks += 1;
  console.log(`PASS ${message}`);
}

async function request(path, options = {}) {
  const url = new URL(path, baseUrl);
  assert.equal(url.origin, baseUrl.origin, 'Smoke requests must stay on the configured application origin');
  const headers = new Headers(options.headers);
  if (cookies.size) headers.set('Cookie', [...cookies].map(([name, value]) => `${name}=${value}`).join('; '));
  if (options.method === 'POST') headers.set('Origin', baseUrl.origin);
  const response = await fetch(url, {
    ...options,
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
  });
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';', 1)[0];
    const separator = pair.indexOf('=');
    cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  return {response, text: await response.text()};
}

function assertStatus(result, status, label) {
  assert.equal(result.response.status, status, `${label}: expected HTTP ${status}, got ${result.response.status}`);
}

function decodeEntities(text) {
  return text.replace(/&(?:quot|amp|lt|gt|apos|#39|#x27);/g, (entity) => ({
    '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&apos;': "'", '&#39;': "'", '&#x27;': "'",
  })[entity]);
}

function initialMarkup(html) {
  return html.split(/<script\b/i)[0];
}

function visibleText(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '));
}

function assertLocale(markup, locale) {
  assert.match(markup, new RegExp(`<html\\b[^>]*lang="${locale}"`));
  const select = [...markup.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)]
    .find(([, attributes]) => /class="[^"]*\blocale-switcher\b/.test(attributes));
  assert.ok(select, 'Expected the language selector before scripts');
  const options = [...select[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)];
  for (const supported of locales) {
    const option = options.find(([, attributes]) => new RegExp(`\\bvalue="${supported}"`).test(attributes));
    assert.ok(option && visibleText(option[2]).trim(), `Expected the ${supported} language option`);
    if (supported === locale) assert.match(option[1], /\bselected(?:\s|=|$)/, 'Language selector must match the document locale');
  }
}

function cartInputs(html) {
  return [...html.matchAll(/<input\b[^>]*>/gi)].flatMap(([tag]) => {
    const attributes = Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => [key, decodeEntities(value)]));
    return attributes.name === 'cartFormInput' && attributes.value ? [JSON.parse(attributes.value)] : [];
  });
}

function dataTable(text) {
  const table = JSON.parse(text.split('\n')[0]);
  assert.ok(Array.isArray(table), 'Expected a React Router single-fetch value table');
  return table;
}

// Follow references in the first turbo-stream frame; deferred promises are not needed here.
function dataValue(table, ...path) {
  let reference = 0;
  for (const key of path) {
    const record = table[reference];
    assert.ok(record && typeof record === 'object', `Missing data record before ${key}`);
    if (typeof key === 'number') {
      assert.ok(Array.isArray(record), `Expected an array before index ${key}`);
      reference = record[key];
    } else {
      const encodedKey = Object.keys(record).find((candidate) => /^_\d+$/.test(candidate) && table[Number(candidate.slice(1))] === key);
      assert.ok(encodedKey, `Missing data field ${key}; available fields: ${Object.keys(record).map((entry) => table[Number(entry.slice(1))]).join(', ')}`);
      reference = record[encodedKey];
    }
    assert.equal(typeof reference, 'number', `Expected a reference for ${key}`);
  }
  return reference === -5 ? null : reference < 0 ? undefined : table[reference];
}

function formBody(action, inputs, extras = {}) {
  return new URLSearchParams({cartFormInput: JSON.stringify({action, inputs}), ...extras});
}

async function cartAction(action, inputs) {
  const result = await request('/cart.data', {method: 'POST', body: formBody(action, inputs)});
  assertStatus(result, 200, action);
  const table = dataTable(result.text);
  assert.equal(dataValue(table, 'data', 'cartAction'), action);
  for (const field of ['errors', 'userErrors']) {
    const errors = dataValue(table, 'data', field);
    assert.ok(!errors || errors.length === 0, `${action} returned ${field}`);
  }
  return table;
}

function availableMarkets(table) {
  const path = ['root', 'data', 'markets', 'availableCountries'];
  const countries = dataValue(table, ...path);
  assert.ok(Array.isArray(countries) && countries.length, 'Shopify must provide at least one available country');
  return countries.map((_, index) => ({
    country: dataValue(table, ...path, index, 'isoCode'),
    currency: dataValue(table, ...path, index, 'currency', 'isoCode'),
  }));
}

async function checkCartMarket(market, cartId) {
  const change = await request('/market', {
    method: 'POST', body: new URLSearchParams({country: market.country, returnTo: '/cart?smoke=market'}),
  });
  assertStatus(change, 303, `${market.country} market selection`);
  assert.equal(change.response.headers.get('Location'), '/cart?smoke=market');
  assert.ok(cookies.has('session'), 'A successful market selection must persist a signed session');

  const result = await request('/cart.data?_routes=root,routes/cart');
  assertStatus(result, 200, `${market.country} market and cart loaders`);
  const table = dataTable(result.text);
  assert.equal(dataValue(table, 'root', 'data', 'markets', 'country', 'isoCode'), market.country);
  assert.equal(dataValue(table, 'root', 'data', 'markets', 'country', 'currency', 'isoCode'), market.currency);
  assert.equal(dataValue(table, 'root', 'data', 'consent', 'country'), market.country);
  assert.equal(dataValue(table, 'root', 'data', 'consent', 'language'), 'EN');
  assert.equal(dataValue(table, 'root', 'data', 'locale'), gtConfig.defaultLocale);

  const cartPath = ['routes/cart', 'data'];
  assert.ok(dataValue(table, ...cartPath, 'id') === cartId, 'Changing country must retain the same Shopify cart');
  assert.equal(dataValue(table, ...cartPath, 'buyerIdentity', 'countryCode'), market.country);
  assert.equal(dataValue(table, ...cartPath, 'totalQuantity'), 1);
  assert.equal(dataValue(table, ...cartPath, 'lines', 'nodes').length, 1);
  assert.ok(dataValue(table, ...cartPath, 'lines', 'nodes', 0, 'id') === createdLineId, 'Changing country must retain the same Shopify cart line');
  assert.equal(dataValue(table, ...cartPath, 'lines', 'nodes', 0, 'quantity'), 1);
  assert.equal(dataValue(table, ...cartPath, 'lines', 'nodes', 0, 'cost', 'totalAmount', 'currencyCode'), market.currency);
  for (const field of ['subtotalAmount', 'totalAmount']) {
    assert.equal(dataValue(table, ...cartPath, 'cost', field, 'currencyCode'), market.currency);
  }

  const document = await request('/cart');
  assertStatus(document, 200, `${market.country} cart document`);
  const markup = initialMarkup(document.text);
  assertLocale(markup, gtConfig.defaultLocale);
  assert.ok(cartInputs(markup).some((input) => input.action === 'LinesRemove' && input.inputs.lineIds.includes(createdLineId)), 'Market selection must preserve the cart line in initial HTML');
  assert.ok(visibleText(markup).includes('Quantity: 1'), 'Market selection must preserve the cart quantity in initial HTML');
  // Use Shopify's returned subtotal; formatting must never invent an exchange rate.
  const subtotal = dataValue(table, ...cartPath, 'cost', 'subtotalAmount', 'amount');
  assert.ok(Number.isFinite(Number(subtotal)), 'Shopify must return a numeric market subtotal');
  const expectedPrice = new Intl.NumberFormat(gtConfig.defaultLocale, {
    style: 'currency', currency: market.currency,
  }).format(Number(subtotal)).replace(/\s+/g, ' ');
  assert.ok(visibleText(markup).includes(expectedPrice), 'Cart SSR must format Shopify’s subtotal in the selected market currency');
}

async function main() {
  console.log(`Checking production storefront at ${baseUrl.origin}`);
  const home = await request('/');
  assertStatus(home, 200, 'English homepage');
  const homeMarkup = initialMarkup(home.text);
  assertLocale(homeMarkup, 'en');
  const heading = homeMarkup.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  assert.ok(heading && visibleText(heading).includes('Great Things'), 'English headline must appear before scripts');
  assert.ok(visibleText(homeMarkup).includes('Cart'), 'English navigation must be server-rendered');
  for (const locale of translatedLocales) {
    assert.doesNotMatch(homeMarkup, new RegExp(`href="/${locale}(?:[/?#"])`), 'English navigation must not expose locale-prefixed routes');
  }
  pass('English headline, navigation, html lang, and configured language options are present before scripts');

  const rootData = await request('/_root.data?_routes=root');
  assertStatus(rootData, 200, 'English single-fetch homepage');
  const rootTable = dataTable(rootData.text);
  assert.equal(dataValue(rootTable, 'root', 'data', 'consent', 'language'), 'EN');
  assert.equal(dataValue(rootTable, 'root', 'data', 'consent', 'country'), 'US');
  const rootFields = Object.keys(dataValue(rootTable, 'root', 'data')).map((key) => rootTable[Number(key.slice(1))]);
  assert.ok(rootFields.includes('translations'), 'Root loader must include the GT translation snapshot');
  assert.equal(dataValue(rootTable, 'root', 'data', 'locale'), 'en');
  const runtimeStore = dataValue(rootTable, 'root', 'data', 'publicStoreDomain');
  const markets = availableMarkets(rootTable);
  const defaultMarket = markets.find((market) => market.country === 'US');
  assert.ok(defaultMarket, 'The sample store must expose its default US market');
  assert.equal(dataValue(rootTable, 'root', 'data', 'markets', 'country', 'isoCode'), defaultMarket.country);
  assert.equal(dataValue(rootTable, 'root', 'data', 'markets', 'country', 'currency', 'isoCode'), defaultMarket.currency);
  pass('Root loader exposes the English GT snapshot while retaining EN/US commerce context');

  for (const locale of [...translatedLocales, gtConfig.defaultLocale, ...translatedLocales.toReversed(), gtConfig.defaultLocale]) {
    const localized = await request('/', {headers: {'Accept-Language': locale}});
    assertStatus(localized, 200, `${locale} homepage`);
    assertLocale(initialMarkup(localized.text), locale);
    const localizedData = await request('/_root.data?_routes=root', {headers: {'Accept-Language': locale}});
    assertStatus(localizedData, 200, `${locale} loader`);
    const localizedTable = dataTable(localizedData.text);
    assert.equal(dataValue(localizedTable, 'root', 'data', 'locale'), locale);
    assert.equal(dataValue(localizedTable, 'root', 'data', 'consent', 'language'), 'EN');
    assert.equal(dataValue(localizedTable, 'root', 'data', 'consent', 'country'), 'US');
  }
  pass('All configured languages select independent SSR UI locales with unchanged Shopify market context');

  const preferredLocale = translatedLocales.at(-1) || gtConfig.defaultLocale;
  const browserLocale = locales.find((locale) => locale !== preferredLocale) || gtConfig.defaultLocale;
  cookies.set('generaltranslation.locale', preferredLocale);
  try {
    const savedLocale = await request('/', {headers: {'Accept-Language': browserLocale}});
    assertStatus(savedLocale, 200, 'Saved locale preference');
    assertLocale(initialMarkup(savedLocale.text), preferredLocale);
  } finally {
    cookies.delete('generaltranslation.locale');
  }
  pass('Saved language cookie takes precedence over the browser language');

  const search = await request('/search?q=snowboard');
  assertStatus(search, 200, 'English full search');
  const searchMarkup = initialMarkup(search.text);
  assert.match(searchMarkup, /<html\b[^>]*lang="en"/);
  assert.match(searchMarkup, /<h1\b[^>]*>Search<\/h1>/);
  assert.match(searchMarkup, /<h2\b[^>]*>Products<\/h2>/);
  assert.match(searchMarkup, /<form\b[^>]*action="\/search"/);
  pass('English search heading, product label, and search form are server-rendered');

  const articlePaths = [...new Set([...searchMarkup.matchAll(/href="([^"]*\/blogs\/[^"]+)"/g)].map(([, path]) => decodeEntities(path)))];
  if (articlePaths.length) {
    assert.match(searchMarkup, /<h2\b[^>]*>Articles<\/h2>/);
    for (const path of articlePaths) {
      assert.match(new URL(path, baseUrl).pathname, /^\/blogs\/journal\/[^/]+$/, 'Article URLs must include the blog handle and article handle');
    }
    assertStatus(await request(articlePaths[0]), 200, 'Article result destination');
    pass('Article result links include the blog handle and resolve successfully');
  } else {
    console.log('SKIP Article-link check: Shopify returned no articles for the sample query.');
  }

  const noResults = await request('/search?q=gtSmokeNoMatch7f96f8');
  assertStatus(noResults, 200, 'English search without matches');
  assert.ok(visibleText(initialMarkup(noResults.text)).includes('No results. Try a different search.'), 'English no-results message must appear in SSR');
  pass('English empty-search state is present before scripts');

  for (const [index, locale] of translatedLocales.entries()) {
    for (const path of [`/${locale}`, `/${locale}/${index % 2 ? 'cart' : 'collections/all'}`]) {
      assertStatus(await request(path), 404, `Removed locale route ${path}`);
    }
  }
  pass('Configured locale-prefixed routes return 404');

  assert.equal(config.PUBLIC_STORE_DOMAIN, demoDomain, 'Refusing cart mutations: .env/process PUBLIC_STORE_DOMAIN must be Shopify’s official demo store');
  assert.equal(runtimeStore, demoDomain, 'Refusing cart mutations: running server does not report Shopify’s official demo store');
  console.log('Cart mutation guard: official Shopify demo store confirmed; using an isolated cookie jar.');

  assert.ok(!markets.some((market) => market.country === 'ZZ'), 'The unavailable-country fixture must not be a published market');
  const invalidMarkets = [
    {country: 'usa', returnTo: '/cart'},
    {country: 'ZZ', returnTo: '/cart'},
    ...['https://example.com/', '//example.com/', '/\\example.com/']
      .map((returnTo) => ({country: defaultMarket.country, returnTo})),
  ];
  for (const selection of invalidMarkets) {
    const result = await request('/market', {method: 'POST', body: new URLSearchParams(selection)});
    assertStatus(result, 400, 'Invalid market selection or return destination');
    assert.equal(result.response.headers.get('Location'), null);
    assert.ok(!result.response.headers.getSetCookie().some((cookie) => /^(?:session|cart)=/.test(cookie)), 'Rejected market selections must not write a session or cart cookie');
    assert.ok(!cookies.has('session') && !cookies.has('cart'), 'Rejected market selections must leave the visitor without a session or cart');
  }
  pass('Malformed and unavailable countries and external market returns are rejected before setting session or cart cookies');

  const invalidLocale = await request(`/${translatedLocales[0] || gtConfig.defaultLocale}/cart`, {
    method: 'POST', body: formBody('LinesAdd', {lines: []}),
  });
  assert.ok([404, 405].includes(invalidLocale.response.status), `Removed locale cart POST must be rejected, got HTTP ${invalidLocale.response.status}`);
  assert.ok(!cookies.has('cart'), 'Invalid locale must not create a cart');
  pass('Removed locale cart POST is rejected before creating a cart');

  for (const redirectTo of ['https://example.com/', '//example.com/', '/\\example.com/']) {
    const result = await request('/cart', {
      method: 'POST', body: formBody('LinesAdd', {lines: []}, {redirectTo}),
    });
    assertStatus(result, 400, 'External cart redirect');
    assert.equal(result.response.headers.get('Location'), null);
    assert.ok(!cookies.has('cart'), 'Rejected redirect must not create a cart');
  }
  pass('Absolute, protocol-relative, and backslash external redirects are rejected before mutation');

  const permalink = await request('/cart/123:1');
  assertStatus(permalink, 302, 'Sample cart permalink');
  assert.equal(permalink.response.headers.get('Location'), '/cart');
  assert.ok(!cookies.has('cart'), 'Sample permalink must not create a cart or start checkout');
  pass('Sample cart permalink stays on /cart without creating a cart or visiting checkout');

  const catalog = await request('/collections/all');
  assertStatus(catalog, 200, 'Sample catalog');
  const productPaths = [...new Set([...initialMarkup(catalog.text).matchAll(/href="(\/products\/[^"?#]+)[^"]*"/g)].map(([, path]) => decodeEntities(path)))];
  assert.ok(productPaths.length, 'Expected real sample product links');
  let merchandiseId;
  for (const path of productPaths.slice(0, 8)) {
    const product = await request(path);
    assertStatus(product, 200, 'Sample product');
    const markup = initialMarkup(product.text);
    const add = cartInputs(markup).find((input) => input.action === 'LinesAdd' && input.inputs?.lines?.[0]?.selectedVariant?.availableForSale);
    if (!add) continue;
    assert.ok(visibleText(markup).includes('Add to cart'), 'Product add-to-cart label must be present in SSR');
    merchandiseId = add.inputs.lines[0].merchandiseId;
    break;
  }
  assert.ok(merchandiseId, 'Expected an available Shopify sample product variant');
  pass('English product SSR contains an available real Shopify variant and cart control');

  const added = await cartAction('LinesAdd', {lines: [{merchandiseId, quantity: 1}]});
  assert.equal(dataValue(added, 'data', 'cart', 'totalQuantity'), 1);
  assert.ok(cookies.has('cart'), 'Add must set a cart cookie');
  pass('Real sample cart add succeeds and returns an isolated cart cookie');

  const reloaded = await request('/cart');
  assertStatus(reloaded, 200, 'Cart reload');
  const cartMarkup = initialMarkup(reloaded.text);
  createdLineId = cartInputs(cartMarkup).find((input) => input.action === 'LinesRemove')?.inputs.lineIds[0];
  assert.ok(createdLineId, 'Reloaded cart must expose the added line ID in its removal form');
  assertLocale(cartMarkup, gtConfig.defaultLocale);
  assert.ok(cartInputs(cartMarkup).some((input) => input.action === 'LinesUpdate' && input.inputs.lines.some((line) => line.id === createdLineId)), 'Cart cookie must retain the added line on a new document request');
  assert.ok(visibleText(cartMarkup).includes('Sample storefront. Checkout is disabled.'), 'Sample checkout-disabled message must be server-rendered');
  assert.doesNotMatch(cartMarkup, /<a\b[^>]*href="https?:\/\/[^"\s]*(?:checkout|checkouts)/i, 'Sample cart must not offer an external checkout link');
  pass('Cart survives a document reload and renders disabled sample checkout');

  const alternateMarket = markets.find((market) => market.country !== 'US' && market.currency !== defaultMarket.currency)
    || markets.find((market) => market.country !== 'US');
  if (alternateMarket) {
    const cartId = dataValue(added, 'data', 'cart', 'id');
    await checkCartMarket(alternateMarket, cartId);
    await checkCartMarket(defaultMarket, cartId);
    pass(`Shopify market selection (${alternateMarket.country}/${alternateMarket.currency}) preserves the cart and quantity, verifies returned currency, and restores US`);
  } else {
    console.log('SKIP Market-switch check: Shopify exposes only the US country; no alternate country or currency is configured.');
  }

  for (const locale of translatedLocales) {
    const localizedCart = await request('/cart', {headers: {'Accept-Language': locale}});
    assertStatus(localizedCart, 200, `${locale} cart`);
    const localizedMarkup = initialMarkup(localizedCart.text);
    assertLocale(localizedMarkup, locale);
    assert.ok(cartInputs(localizedMarkup).some((input) => input.action === 'LinesRemove' && input.inputs.lineIds.includes(createdLineId)), 'Changing UI language must retain the same Shopify cart line');
  }
  pass('The same cart line persists across document requests in every configured language');

  const updated = await request('/cart', {
    method: 'POST',
    body: formBody('LinesUpdate', {lines: [{id: createdLineId, quantity: 2}]}, {redirectTo: '/cart?smoke=1'}),
  });
  assertStatus(updated, 303, 'Valid same-origin cart redirect');
  assert.equal(updated.response.headers.get('Location'), '/cart?smoke=1');
  const cartAfterUpdate = await request('/cart');
  assertStatus(cartAfterUpdate, 200, 'Cart after update');
  assert.ok(visibleText(initialMarkup(cartAfterUpdate.text)).includes('Quantity: 2'), 'Real sample line quantity should be two after update');
  pass('Real sample cart update succeeds and preserves an allowed same-origin redirect');

  const removed = await cartAction('LinesRemove', {lineIds: [createdLineId]});
  assert.equal(dataValue(removed, 'data', 'cart', 'totalQuantity'), 0);
  createdLineId = undefined;
  const emptyCart = await request('/cart');
  assertStatus(emptyCart, 200, 'English empty cart');
  assert.ok(visibleText(initialMarkup(emptyCart.text)).includes('Your cart is empty. Find something you love.'));
  pass('Real sample cart remove succeeds; the same cookie renders an empty English cart');
  console.log(`\n${checks} smoke checks passed. No checkout was visited or order placed.`);
}

try {
  await main();
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  if (createdLineId) {
    try {
      await cartAction('LinesRemove', {lineIds: [createdLineId]});
      console.log('Cleaned up the smoke-test cart line.');
    } catch {
      console.error('Could not clean up the isolated demo cart line; no checkout was attempted.');
    }
  }
}
