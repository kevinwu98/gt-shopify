import assert from 'node:assert/strict';

// Read-only checks: safe to run against either the sample catalog or a linked store.
const baseUrl = new URL(process.argv[2] || 'http://localhost:3101');
assert.ok(['http:', 'https:'].includes(baseUrl.protocol), 'Use an HTTP(S) storefront URL');
assert.ok(!baseUrl.username && !baseUrl.password, 'Do not put credentials in the URL');
const authBypassToken = process.env.OXYGEN_AUTH_BYPASS_TOKEN;
let checks = 0;

async function get(path) {
  const url = new URL(path, baseUrl);
  assert.equal(url.origin, baseUrl.origin, 'Checks must stay on the storefront origin');
  const response = await fetch(url, {
    headers: authBypassToken ? {'oxygen-auth-bypass-token': authBypassToken} : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200, `${url.pathname}: expected 200, received ${response.status}. Protected Oxygen previews require a valid OXYGEN_AUTH_BYPASS_TOKEN for the exact deployment URL from h2_deploy_log.json.`);
  return {response, text: await response.text()};
}

function pass(message) {
  checks += 1;
  console.log(`PASS ${message}`);
}

function initialMarkup(html) {
  return html.split(/<script\b/i)[0];
}

function decodeEntities(text) {
  return text.replace(/&(?:quot|amp|lt|gt|apos|#39|#x27);/g, (entity) => ({
    '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&apos;': "'", '&#39;': "'", '&#x27;': "'",
  })[entity]);
}

async function main() {
  console.log(`Checking English storefront at ${baseUrl.origin}`);
  const home = await get('/');
  assert.match(home.response.headers.get('content-type') || '', /text\/html/);
  assert.ok(home.response.headers.get('content-security-policy'), 'Expected a Content Security Policy');
  const homeMarkup = initialMarkup(home.text);
  assert.match(homeMarkup, /<html\b[^>]*lang="en"/);
  assert.match(homeMarkup, /<h1\b[^>]*>[\s\S]*?Good things,/);
  pass('English home page and headline are server-rendered with a Content Security Policy');

  const assets = [...new Set([...home.text.matchAll(/(?:src|href)="([^"<>]+\.(?:js|css)(?:\?[^"<>]*)?)"/g)]
    .map(([, path]) => decodeEntities(path))
    .filter((path) => new URL(path, baseUrl).origin === baseUrl.origin))];
  assert.ok(assets.some((path) => path.includes('.js')), 'Expected a client JavaScript entry');
  assert.ok(assets.some((path) => path.includes('.css')), 'Expected a stylesheet');
  for (const path of assets) {
    const {response} = await get(path);
    const contentType = response.headers.get('content-type') || '';
    assert.match(contentType, new URL(path, baseUrl).pathname.endsWith('.css')
      ? /^text\/css(?:;|$)/i
      : /^(?:text|application)\/(?:javascript|ecmascript)(?:;|$)/i,
    'Assets must use a browser-compatible JavaScript or CSS content type');
  }
  pass(`All ${assets.length} referenced JavaScript and CSS assets load`);

  const catalog = await get('/collections/all');
  const productPaths = [...new Set([...initialMarkup(catalog.text).matchAll(/href="(\/products\/[^"?#]+)[^"]*"/g)]
    .map(([, path]) => decodeEntities(path)))];
  assert.ok(productPaths.length, 'Publish at least one product to the Hydrogen channel');
  pass('Catalog renders a published product');

  // Search hides unavailable products, so use a purchasable item for both checks.
  let productMarkup;
  for (const path of productPaths.slice(0, 8)) {
    const product = await get(path);
    const markup = initialMarkup(product.text);
    if (markup.includes('Add to cart')) {
      productMarkup = markup;
      break;
    }
  }
  assert.ok(productMarkup, 'Publish an available product among the first eight catalog items for the commerce demo');
  const productTitle = decodeEntities(productMarkup.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]*>/g, '') || '').trim();
  assert.ok(productTitle, 'Expected a server-rendered product title');
  pass('Product detail renders its title and an available purchase option');

  const term = process.argv[3] || productTitle;
  const search = await get(`/search?q=${encodeURIComponent(term)}`);
  const searchMarkup = initialMarkup(search.text);
  assert.match(searchMarkup, /<h1\b[^>]*>Search<\/h1>/);
  assert.match(searchMarkup, /href="\/products\//, 'Search should find a published product; optionally pass a matching search term as the second argument');
  pass('Full search returns product links');

  const emptySearch = await get('/search?q=gtOxygenNoMatch7f96f8');
  assert.match(initialMarkup(emptySearch.text), /No results\. Try a different search\./);
  pass('Search renders its empty state');

  const cart = await get('/cart');
  assert.match(initialMarkup(cart.text), /Your cart is empty\. Find something you love\./);
  assert.doesNotMatch(initialMarkup(cart.text), /Lines(?:Update|Remove)/, 'A fresh visitor must not receive another cart’s line controls');
  pass('A fresh visitor gets an empty cart');

  console.log(`\n${checks} deployment checks passed. No cart was changed and no checkout was visited.`);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  // Assertion errors can include response content; redact a token echoed by a server.
  console.error(`FAIL ${authBypassToken ? message.split(authBypassToken).join('[REDACTED]') : message}`);
  process.exitCode = 1;
}
