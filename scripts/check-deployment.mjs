import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';

// Read-only checks: safe to run against either the sample catalog or a linked store.
const baseUrl = new URL(process.argv[2] || 'http://localhost:3101');
assert.ok(['http:', 'https:'].includes(baseUrl.protocol), 'Use an HTTP(S) storefront URL');
assert.ok(!baseUrl.username && !baseUrl.password, 'Do not put credentials in the URL');
const authBypassToken = process.env.OXYGEN_AUTH_BYPASS_TOKEN;
// Opt in after translated copy lands: CHECK_LOCALIZATION=1 npm run test:deployment -- URL
const checkCatalog = process.env.CHECK_CATALOG === '1';
const checkLocalization = process.env.CHECK_LOCALIZATION === '1' || checkCatalog;
const oxygenCdnOrigin = 'https://cdn.shopify.com';
let checks = 0;

function isOxygenCdnAsset(url) {
  return url.origin === oxygenCdnOrigin && url.pathname.startsWith('/oxygen-v2/');
}

async function get(path, {asset = false, locale, cookie} = {}) {
  const url = new URL(path, baseUrl);
  const sameOrigin = url.origin === baseUrl.origin;
  assert.ok(sameOrigin || (asset && isOxygenCdnAsset(url)), 'Checks must stay on the storefront origin or use an allowed Oxygen CDN asset');
  const headers = new Headers();
  if (sameOrigin && url.origin !== oxygenCdnOrigin) {
    if (authBypassToken) headers.set('oxygen-auth-bypass-token', authBypassToken);
    if (locale) headers.set('Accept-Language', locale);
    if (cookie) headers.set('Cookie', cookie);
  }
  const response = await fetch(url, {
    headers,
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

function textContent(markup) {
  return decodeEntities(markup.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' '))
    .replace(/&#(x[\da-f]+|\d+);/gi, (entity, value) => {
      const code = value.toLowerCase().startsWith('x') ? parseInt(value.slice(1), 16) : Number(value);
      return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    })
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function elementText(markup, tag) {
  const content = markup.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1];
  const text = textContent(content || '');
  assert.ok(text, `Expected nonempty server-rendered ${tag} text`);
  return text;
}

function pageMarkup(html) {
  // Drawer dialogs also contain <main>; the page is the one containing its h1.
  const main = [...initialMarkup(html).matchAll(/<main\b[^>]*>([\s\S]*?)<\/main>/gi)]
    .find(([, content]) => /<h1\b/i.test(content))?.[1];
  assert.ok(main, 'Expected the page heading and content in initial HTML');
  return main;
}

function assertLocale(html, locale, locales) {
  const markup = initialMarkup(html);
  assert.match(markup, new RegExp(`<html\\b[^>]*lang="${locale}"`), `Expected initial HTML in ${locale}`);
  const select = [...markup.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)]
    .find(([, attributes]) => /class="[^"]*\blocale-switcher\b/.test(attributes));
  assert.ok(select, 'Expected the locale selector in initial HTML');
  assert.doesNotMatch(select[1], /\bhidden(?:\s|=|$)|aria-hidden="true"|display\s*:\s*none|visibility\s*:\s*hidden/i);
  const options = [...select[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)];
  for (const supported of locales) {
    const option = options.find(([, attributes]) => new RegExp(`\\bvalue="${supported}"`).test(attributes));
    assert.ok(option && textContent(option[2]), `Expected the ${supported} language option`);
    if (supported === locale) assert.match(option[1], /\bselected(?:\s|=|$)/, 'Locale selector must match SSR language');
  }
}

function purchaseText(markup) {
  const form = [...markup.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/gi)]
    .find(([, content]) => /name="cartFormInput"/.test(content))?.[1];
  assert.ok(form, 'Expected a product cart form');
  return elementText(form, 'button');
}

function purchaseInput(markup) {
  const input = [...markup.matchAll(/<input\b[^>]*>/gi)]
    .find(([tag]) => /\bname="cartFormInput"/.test(tag))?.[0];
  const value = input?.match(/\bvalue="([^"]*)"/)?.[1];
  if (!value) return undefined;
  try {
    return JSON.parse(decodeEntities(value));
  } catch {
    // Never include a cart payload in a diagnostic.
    throw new Error('The product purchase input is not valid JSON');
  }
}

async function localCatalogs(locales) {
  const catalogs = {};
  for (const locale of locales) {
    try {
      catalogs[locale] = JSON.parse(await readFile(new URL(`../catalog/${locale}.json`, import.meta.url), 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw new Error(`Cannot read catalog/${locale}.json`);
      assert.ok(!checkCatalog, `CHECK_CATALOG requires catalog/${locale}.json; export and translate the catalog first`);
      catalogs[locale] = {};
    }
  }
  return catalogs;
}

function expectedCatalogTitle(catalogs, locale, productId, liveEnglish) {
  const id = /^gid:\/\/shopify\/Product\/([1-9]\d*)$/.exec(productId || '')?.[1];
  assert.ok(!checkCatalog || id, 'CHECK_CATALOG requires the Shopify product ID in the purchase input');
  const key = id ? `product_${id}_title` : undefined;
  const matchesSource = key && catalogs.en[key] === liveEnglish;
  assert.ok(!checkCatalog || matchesSource, 'Catalog title source must match the live English product; export current catalog content first');
  if (!matchesSource || locale === 'en') return liveEnglish;
  const translated = catalogs[locale][key];
  assert.ok(!checkCatalog || (typeof translated === 'string' && translated.trim()), `CHECK_CATALOG requires a ${locale} title for the selected product`);
  return typeof translated === 'string' && translated.trim() ? translated : liveEnglish;
}

async function localizedChecks(productPath, productTitle, englishMarkup) {
  const config = JSON.parse(await readFile(new URL('../gt.config.json', import.meta.url), 'utf8'));
  const locales = [...new Set([config.defaultLocale, ...config.locales])];
  const catalogs = await localCatalogs(locales);
  const englishInput = purchaseInput(englishMarkup);
  const variant = englishInput?.inputs?.lines?.[0]?.selectedVariant;
  const productId = variant?.product?.id;
  const liveEnglish = typeof variant?.product?.title === 'string' ? variant.product.title : productTitle;
  const pages = new Map();
  for (const locale of locales) {
    const [home, search, cart, product] = await Promise.all([
      get('/', {locale}), get('/search?q=gtOxygenNoMatch7f96f8', {locale}),
      get('/cart', {locale}), get(productPath, {locale}),
    ]);
    for (const page of [home, search, cart, product]) assertLocale(page.text, locale, locales);
    const searchMain = pageMarkup(search.text);
    const cartMain = pageMarkup(cart.text);
    assert.doesNotMatch(searchMain, /role="alert"|href="\/products\//, 'Empty search must not contain an error or product result');
    assert.doesNotMatch(cartMain, /Lines(?:Update|Remove)/, 'Locale checks must receive a fresh empty cart');
    const productMain = pageMarkup(product.text);
    const expectedTitle = expectedCatalogTitle(catalogs, locale, productId, liveEnglish);
    assert.equal(elementText(productMain, 'h1'), expectedTitle.replace(/\s+/g, ' ').trim(), 'Product title must match the current GT catalog translation or its English fallback');
    const localizedInput = purchaseInput(productMain);
    if (englishInput || checkCatalog) {
      assert.ok(localizedInput && isDeepStrictEqual(localizedInput, englishInput), 'Language switching must preserve canonical Shopify variant IDs and purchase inputs');
    }
    if (checkCatalog) {
      const descriptionKey = `product_${productId.split('/').at(-1)}_description`;
      const sourceDescription = catalogs.en[descriptionKey];
      // Older exports may omit descriptions. Check them when the exported
      // English text can be verified against the live product's visible HTML.
      if (typeof sourceDescription === 'string' && sourceDescription.trim()
        && textContent(englishMarkup).includes(sourceDescription.replace(/\s+/g, ' ').trim())) {
        const description = locale === 'en' ? sourceDescription : catalogs[locale][descriptionKey];
        assert.ok(typeof description === 'string' && description.trim(), `CHECK_CATALOG requires a ${locale} product description`);
        assert.ok(textContent(productMain).includes(description.replace(/\s+/g, ' ').trim()), `Expected the ${locale} catalog description in initial HTML`);
      }
      if (variant?.price?.amount && variant?.price?.currencyCode) {
        const expectedPrice = new Intl.NumberFormat(locale, {
          style: 'currency', currency: variant.price.currencyCode,
        }).format(Number(variant.price.amount)).replace(/\s+/g, ' ').trim();
        assert.ok(textContent(productMain).includes(expectedPrice), `Expected the ${locale} currency format without changing Shopify's amount or currency`);
      }
    }
    const copy = {
      heading: elementText(pageMarkup(home.text), 'h1'),
      cta: textContent(pageMarkup(home.text).match(/<a\b[^>]*class="button-primary"[^>]*>([\s\S]*?)<\/a>/i)?.[1] || ''),
      search: elementText(searchMain, 'p'),
      cart: elementText(cartMain, 'p'),
      purchase: purchaseText(productMain),
    };
    const englishCopy = pages.get('en');
    if (englishCopy) {
      assert.ok(copy.cta, 'Expected translated collection CTA');
      for (const key of ['heading', 'cta', 'search', 'cart', 'purchase']) assert.notEqual(copy[key], englishCopy[key], `${locale} ${key} must contain translated copy, not English fallback`);
    }
    pages.set(locale, copy);
    pass(`${locale} initial HTML, language selector, empty states, and catalog title are correct${checkCatalog ? '; catalog translations, purchase inputs, and currency checked' : ''}`);
  }

  for (const locale of locales) {
    const otherLocale = locales.find((supported) => supported !== locale);
    if (!otherLocale) continue;
    const preference = await get('/', {locale: otherLocale, cookie: `generaltranslation.locale=${locale}`});
    assertLocale(preference.text, locale, locales);
    assert.equal(elementText(pageMarkup(preference.text), 'h1'), pages.get(locale).heading);
  }
  pass('Locale cookies override conflicting Accept-Language preferences');

  // No response cookies are retained: each request represents an independent visitor.
  for (const locale of [...locales].reverse().concat(locales)) {
    const page = await get('/', {locale});
    assertLocale(page.text, locale, locales);
    assert.equal(elementText(pageMarkup(page.text), 'h1'), pages.get(locale).heading, 'Locale requests must remain isolated');
  }
  pass('Repeated language requests do not share locale state');
}

async function main() {
  console.log(`Checking English storefront at ${baseUrl.origin}`);
  const home = await get('/');
  assert.match(home.response.headers.get('content-type') || '', /text\/html/);
  assert.ok(home.response.headers.get('content-security-policy'), 'Expected a Content Security Policy');
  const homeMarkup = initialMarkup(home.text);
  assert.match(homeMarkup, /<html\b[^>]*lang="en"/);
  assert.match(elementText(homeMarkup, 'h1'), /Great Things/);
  pass('English home page and headline are server-rendered with a Content Security Policy');

  const assets = [...new Set([...home.text.matchAll(/(?:src|href)="([^"<>]+\.(?:js|css)(?:\?[^"<>]*)?)"/g)]
    .map(([, path]) => decodeEntities(path))
    .filter((path) => {
      const url = new URL(path, baseUrl);
      return url.origin === baseUrl.origin || isOxygenCdnAsset(url);
    }))];
  assert.ok(assets.some((path) => path.includes('.js')), 'Expected a client JavaScript entry');
  assert.ok(assets.some((path) => path.includes('.css')), 'Expected a stylesheet');
  for (const path of assets) {
    const {response} = await get(path, {asset: true});
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
  let productPath;
  for (const path of productPaths.slice(0, 8)) {
    const product = await get(path);
    const markup = initialMarkup(product.text);
    if (textContent(markup).includes('Add to cart')) {
      productMarkup = markup;
      productPath = path;
      break;
    }
  }
  assert.ok(productMarkup, 'Publish an available product among the first eight catalog items for the commerce demo');
  const productTitle = elementText(productMarkup, 'h1');
  assert.ok(productTitle, 'Expected a server-rendered product title');
  pass('Product detail renders its title and an available purchase option');

  const term = process.argv[3] || productTitle;
  const search = await get(`/search?q=${encodeURIComponent(term)}`);
  const searchMarkup = initialMarkup(search.text);
  assert.equal(elementText(searchMarkup, 'h1'), 'Search');
  assert.match(searchMarkup, /href="\/products\//, 'Search should find a published product; optionally pass a matching search term as the second argument');
  pass('Full search returns product links');

  const emptySearch = await get('/search?q=gtOxygenNoMatch7f96f8');
  assert.match(textContent(initialMarkup(emptySearch.text)), /No results\. Try a different search\./);
  pass('Search renders its empty state');

  const cart = await get('/cart');
  assert.match(textContent(initialMarkup(cart.text)), /Your cart is empty\. Find something you love\./);
  assert.doesNotMatch(initialMarkup(cart.text), /Lines(?:Update|Remove)/, 'A fresh visitor must not receive another cart’s line controls');
  pass('A fresh visitor gets an empty cart');

  if (checkLocalization) await localizedChecks(productPath, productTitle, productMarkup);

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
