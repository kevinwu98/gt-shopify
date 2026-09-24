import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';

const baseUrl = new URL(process.env.SMOKE_BASE_URL || 'http://localhost:3101');
const demoDomain = 'hydrogen-preview.myshopify.com';
const config = {...parseEnv(await readFile(new URL('../.env', import.meta.url), 'utf8')), ...process.env};
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
  const result = await request('/fr/cart.data', {method: 'POST', body: formBody(action, inputs)});
  assertStatus(result, 200, action);
  const table = dataTable(result.text);
  assert.equal(dataValue(table, 'data', 'cartAction'), action);
  for (const field of ['errors', 'userErrors']) {
    const errors = dataValue(table, 'data', field);
    assert.ok(!errors || errors.length === 0, `${action} returned ${field}`);
  }
  return table;
}

async function main() {
  console.log(`Checking production storefront at ${baseUrl.origin}`);
  for (const [locale, path, headline, cartLabel] of [
    ['en', '/', 'Good things,', 'Cart'],
    ['fr', '/fr', 'De belles pièces,', 'Panier'],
    ['ja', '/ja', 'お気に入りを、', 'カート'],
  ]) {
    const result = await request(path);
    assertStatus(result, 200, `${locale} homepage`);
    const markup = initialMarkup(result.text);
    assert.match(markup, new RegExp(`<html\\b[^>]*lang="${locale}"`));
    const heading = markup.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
    assert.ok(heading && visibleText(heading).includes(headline), `${locale}: translated headline must appear before scripts`);
    assert.ok(visibleText(markup).includes(cartLabel), `${locale}: translated navigation must be server-rendered`);
    pass(`${locale} translated headline/navigation and html lang are present before scripts`);
  }

  let runtimeStore;
  for (const [locale, language] of [['fr', 'FR'], ['ja', 'JA']]) {
    const result = await request(`/${locale}.data?_routes=root`);
    assertStatus(result, 200, `${locale} single-fetch homepage`);
    const table = dataTable(result.text);
    assert.equal(dataValue(table, 'root', 'data', 'selectedLocale', 'locale'), locale);
    assert.equal(dataValue(table, 'root', 'data', 'consent', 'language'), language, 'Hydrogen context must use the same language as GT on .data requests');
    assert.equal(dataValue(table, 'root', 'data', 'consent', 'country'), 'US');
    runtimeStore = dataValue(table, 'root', 'data', 'publicStoreDomain');
    pass(`${locale}.data keeps GT and Hydrogen context aligned (${language}/US)`);
  }

  const search = await request('/ja/search?q=snowboard');
  assertStatus(search, 200, 'Japanese full search');
  const searchMarkup = initialMarkup(search.text);
  assert.match(searchMarkup, /<html\b[^>]*lang="ja"/);
  assert.match(searchMarkup, /<h1\b[^>]*>検索<\/h1>/);
  assert.match(searchMarkup, /<h2\b[^>]*>商品<\/h2>/);
  assert.match(searchMarkup, /<form\b[^>]*action="\/ja\/search"/);
  pass('Japanese full-search heading, product label, and form locale are server-rendered');

  const articlePaths = [...new Set([...searchMarkup.matchAll(/href="([^"]*\/blogs\/[^"]+)"/g)].map(([, path]) => decodeEntities(path)))];
  if (articlePaths.length) {
    assert.match(searchMarkup, /<h2\b[^>]*>ブログ記事<\/h2>/);
    for (const path of articlePaths) {
      assert.match(new URL(path, baseUrl).pathname, /^\/ja\/blogs\/journal\/[^/]+$/, 'Article URLs must retain locale, blog handle, and article handle');
    }
    assertStatus(await request(articlePaths[0]), 200, 'Japanese article result destination');
    pass('Japanese article result links include the blog handle and resolve successfully');
  } else {
    console.log('SKIP Article-link check: Shopify returned no articles for the sample query.');
  }

  const noResults = await request('/ja/search?q=gtSmokeNoMatch7f96f8');
  assertStatus(noResults, 200, 'Japanese search without matches');
  assert.ok(visibleText(initialMarkup(noResults.text)).includes('見つかりませんでした。別のキーワードで検索してください。'), 'No-results message must be translated in SSR');
  pass('Japanese empty-search state is translated before scripts');

  assertStatus(await request('/de'), 404, 'Unsupported locale homepage');
  pass('Unsupported locale homepage returns 404');

  assert.equal(config.PUBLIC_STORE_DOMAIN, demoDomain, 'Refusing cart mutations: .env/process PUBLIC_STORE_DOMAIN must be Shopify’s official demo store');
  assert.equal(runtimeStore, demoDomain, 'Refusing cart mutations: running server does not report Shopify’s official demo store');
  console.log('Cart mutation guard: official Shopify demo store confirmed; using an isolated cookie jar.');

  const invalidLocale = await request('/de/cart', {
    method: 'POST', body: formBody('LinesAdd', {lines: []}),
  });
  assertStatus(invalidLocale, 404, 'Unsupported locale cart POST');
  assert.ok(!cookies.has('cart'), 'Invalid locale must not create a cart');
  pass('Unsupported locale cart POST returns 404 before creating a cart');

  for (const redirectTo of ['https://example.com/', '//example.com/', '/\\example.com/']) {
    const result = await request('/fr/cart', {
      method: 'POST', body: formBody('LinesAdd', {lines: []}, {redirectTo}),
    });
    assertStatus(result, 400, 'External cart redirect');
    assert.equal(result.response.headers.get('Location'), null);
    assert.ok(!cookies.has('cart'), 'Rejected redirect must not create a cart');
  }
  pass('Absolute, protocol-relative, and backslash external redirects are rejected before mutation');

  const permalink = await request('/fr/cart/123:1');
  assertStatus(permalink, 302, 'Sample cart permalink');
  assert.equal(permalink.response.headers.get('Location'), '/fr/cart');
  assert.ok(!cookies.has('cart'), 'Sample permalink must not create a cart or start checkout');
  pass('Sample cart permalink stays on /fr/cart without creating a cart or visiting checkout');

  const catalog = await request('/fr/collections/all');
  assertStatus(catalog, 200, 'Sample catalog');
  const productPaths = [...new Set([...initialMarkup(catalog.text).matchAll(/href="(\/fr\/products\/[^"?#]+)[^"]*"/g)].map(([, path]) => decodeEntities(path)))];
  assert.ok(productPaths.length, 'Expected real sample product links');
  let merchandiseId;
  for (const path of productPaths.slice(0, 8)) {
    const product = await request(path);
    assertStatus(product, 200, 'Sample product');
    const markup = initialMarkup(product.text);
    const add = cartInputs(markup).find((input) => input.action === 'LinesAdd' && input.inputs?.lines?.[0]?.selectedVariant?.availableForSale);
    if (!add) continue;
    assert.ok(visibleText(markup).includes('Ajouter au panier'), 'Product add-to-cart label must be translated in SSR');
    merchandiseId = add.inputs.lines[0].merchandiseId;
    break;
  }
  assert.ok(merchandiseId, 'Expected an available Shopify sample product variant');
  pass('French product SSR contains an available real Shopify variant and translated cart control');

  const added = await cartAction('LinesAdd', {lines: [{merchandiseId, quantity: 1}]});
  assert.equal(dataValue(added, 'data', 'cart', 'totalQuantity'), 1);
  assert.ok(cookies.has('cart'), 'Add must set a cart cookie');
  pass('Real sample cart add succeeds and returns an isolated cart cookie');

  const reloaded = await request('/fr/cart');
  assertStatus(reloaded, 200, 'Cart reload');
  const cartMarkup = initialMarkup(reloaded.text);
  createdLineId = cartInputs(cartMarkup).find((input) => input.action === 'LinesRemove')?.inputs.lineIds[0];
  assert.ok(createdLineId, 'Reloaded cart must expose the added line ID in its removal form');
  assert.ok(cartInputs(cartMarkup).some((input) => input.action === 'LinesUpdate' && input.inputs.lines.some((line) => line.id === createdLineId)), 'Cart cookie must retain the added line on a new document request');
  assert.ok(visibleText(cartMarkup).includes('Boutique de démonstration. Le paiement est désactivé.'), 'Sample checkout-disabled message must be server-rendered');
  assert.doesNotMatch(cartMarkup, /<a\b[^>]*href="https?:\/\/[^"\s]*(?:checkout|checkouts)/i, 'Sample cart must not offer an external checkout link');
  pass('Cart survives a document reload and renders disabled sample checkout');

  const updated = await request('/fr/cart', {
    method: 'POST',
    body: formBody('LinesUpdate', {lines: [{id: createdLineId, quantity: 2}]}, {redirectTo: '/fr/cart?smoke=1'}),
  });
  assertStatus(updated, 303, 'Valid same-origin cart redirect');
  assert.equal(updated.response.headers.get('Location'), '/fr/cart?smoke=1');
  const cartAfterUpdate = await request('/fr/cart');
  assertStatus(cartAfterUpdate, 200, 'Cart after update');
  assert.ok(visibleText(initialMarkup(cartAfterUpdate.text)).includes('Quantité : 2'), 'Real sample line quantity should be two after update');
  pass('Real sample cart update succeeds and preserves an allowed localized redirect');

  const removed = await cartAction('LinesRemove', {lineIds: [createdLineId]});
  assert.equal(dataValue(removed, 'data', 'cart', 'totalQuantity'), 0);
  createdLineId = undefined;
  const emptyCart = await request('/ja/cart');
  assertStatus(emptyCart, 200, 'Japanese empty cart');
  assert.ok(visibleText(initialMarkup(emptyCart.text)).includes('カートは空です。お気に入りの商品を見つけましょう。'));
  pass('Real sample cart remove succeeds; the same cookie renders an empty Japanese cart');
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
