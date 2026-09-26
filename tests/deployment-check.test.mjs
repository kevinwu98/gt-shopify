import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {test} from 'node:test';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/check-deployment.mjs', import.meta.url));
const gtConfig = JSON.parse(await readFile(new URL('../gt.config.json', import.meta.url), 'utf8'));
const configuredLocales = [...new Set([gtConfig.defaultLocale, ...gtConfig.locales])];
const expectedChecks = 9 + configuredLocales.length;
const token = 'test-only-oxygen-bypass-token';

// Run the actual CLI with a deterministic fetch fixture, without network access.
const fixture = `
  import assert from 'node:assert/strict';
  const mode = process.env.DEPLOYMENT_CHECK_FIXTURE;
  const token = process.env.OXYGEN_AUTH_BYPASS_TOKEN;
  const locales = JSON.parse(process.env.DEPLOYMENT_CHECK_LOCALES);
  const fallbackLocale = process.env.DEPLOYMENT_CHECK_FALLBACK_LOCALE;
  let cdnRequests = 0;
  process.on('exit', () => {
    if (mode === 'cdn') assert.equal(cdnRequests, 2, 'Validate both CDN JavaScript and CSS');
  });
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    const cdn = url.origin === 'https://cdn.shopify.com';
    if (cdn) {
      assert.ok(url.pathname.startsWith('/oxygen-v2/'), 'Only Oxygen assets are allowed on the CDN');
      cdnRequests += 1;
    } else {
      assert.equal(url.origin, 'https://preview.myshopify.dev', 'No other cross-origin requests');
    }
    assert.equal(options.redirect, 'manual', 'Redirects must not forward the token');
    assert.equal(new Headers(options.headers).get('oxygen-auth-bypass-token'), cdn ? null : token || null);
    if (mode === 'redirect') {
      return new Response('', {status: 302, headers: {location: 'https://other.example/'}});
    }
    const headers = {'content-type': 'text/html', 'content-security-policy': "default-src 'self'"};
    if (mode === 'echo-token') {
      return new Response('<html lang="fr"><h1>' + token + '</h1></html>', {headers});
    }
    if (url.pathname.endsWith('.js')) {
      return new Response('export {};', {headers: {'content-type': 'text/javascript'}});
    }
    if (url.pathname.endsWith('.css')) {
      return new Response('body {}', {headers: {'content-type': 'text/css'}});
    }
    const requestHeaders = new Headers(options.headers);
    const cookieLocale = requestHeaders.get('Cookie')?.split('generaltranslation.locale=')[1];
    const locale = cookieLocale || requestHeaders.get('Accept-Language') || 'en';
    const copyLocale = mode === 'localized-fallback' && locale === fallbackLocale ? 'en' : locale;
    const copy = {
      en: {heading: 'Good things, worn often.', search: 'No results. Try a different search.', cart: 'Your cart is empty. Find something you love.', purchase: 'Add to cart'},
      fr: {heading: 'De belles choses, souvent portées.', search: 'Aucun résultat. Essayez une autre recherche.', cart: 'Votre panier est vide. Trouvez votre bonheur.', purchase: 'Ajouter au panier'},
      ja: {heading: '毎日を彩る、お気に入り。', search: '結果がありません。別の検索をお試しください。', cart: 'カートは空です。お気に入りを見つけましょう。', purchase: 'カートに追加'},
      ko: {heading: '좋은 옷, 자주 입는 옷.', search: '검색 결과가 없습니다. 다른 검색어를 입력해 보세요.', cart: '장바구니가 비어 있습니다. 마음에 드는 상품을 찾아보세요.', purchase: '장바구니에 추가'},
      id: {heading: 'Barang bagus, sering dipakai.', search: 'Tidak ada hasil. Coba pencarian lain.', cart: 'Keranjang Anda kosong. Temukan yang Anda sukai.', purchase: 'Tambahkan ke keranjang'},
    }[copyLocale];
    const translatedCatalog = mode.startsWith('catalog') && mode !== 'catalog-stale-fallback';
    const titleLocale = mode === 'catalog-locale-title-fallback' && locale === fallbackLocale ? 'en' : locale;
    const title = translatedCatalog && mode !== 'catalog-brand' && mode !== 'catalog-wrong-title'
      ? {en: 'Shirt', fr: 'Chemise', ja: 'シャツ', ko: '셔츠', id: 'Kemeja'}[titleLocale] : 'Shirt';
    const description = translatedCatalog
      ? {en: 'A soft cotton shirt.', fr: 'Une chemise en coton doux.', ja: '柔らかなコットンのシャツ。', ko: '부드러운 면 셔츠.', id: 'Kemeja katun yang lembut.'}[locale]
      : 'A soft cotton shirt.';
    let body;
    if (url.pathname === '/') {
      const assetRoot = mode === 'cdn'
        ? 'https://cdn.shopify.com/oxygen-v2/61555/179082/365980/4550792/assets'
        : '/assets';
      const brand = {en: 'Great Things', fr: 'De belles choses', ja: '素敵なもの', ko: '멋진 것들', id: 'Hal-Hal Hebat'}[copyLocale];
      body = '<main><h1>' + brand + '</h1><a class="button-primary" href="/collections/all">' + copy.heading + '</a></main><link href="' + assetRoot + '/app.css"><script src="' + assetRoot + '/app.js"></script><script src="https://other.example/foreign.js"></script><script src="http://cdn.shopify.com/oxygen-v2/insecure.js"></script><script src="https://cdn.shopify.com/s/files/non-oxygen.js"></script><script src="https://cdn.shopify.com.evil.example/oxygen-v2/spoof.js"></script>';
    } else if (url.pathname === '/collections/all') {
      body = '<a href="/products/shirt">Shirt</a>';
    } else if (url.pathname === '/products/shirt') {
      const product = {title: 'Shirt', ...(mode.startsWith('catalog') ? {id: 'gid://shopify/Product/123'} : {})};
      const selectedVariant = {id: 'gid://shopify/ProductVariant/456', product, price: {amount: '1500.00', currencyCode: 'USD'}, selectedOptions: [{name: 'Size', value: 'M'}]};
      const merchandiseId = mode === 'catalog-changed-input' && locale === 'fr' ? 'gid://shopify/ProductVariant/789' : selectedVariant.id;
      const form = JSON.stringify({action: 'LinesAdd', inputs: {lines: [{merchandiseId, quantity: 1, selectedVariant}]}}).replaceAll('&', '&amp;').replaceAll('"', '&quot;');
      const price = new Intl.NumberFormat(mode === 'catalog-wrong-currency' ? 'en' : locale, {style: 'currency', currency: 'USD'}).format(1500);
      body = '<main><h1>' + title + '</h1><div>' + price + '</div><form><input name="cartFormInput" value="' + form + '"><button>' + copy.purchase + '</button></form><div>' + description + '</div></main>';
    } else if (url.pathname === '/search') {
      body = '<main><h1>Search</h1>' + (url.searchParams.get('q') === 'gtOxygenNoMatch7f96f8'
        ? '<p>' + copy.search + '</p>'
        : '<a href="/products/shirt">Shirt</a>') + '</main>';
    } else if (url.pathname === '/cart') {
      body = '<main><h1>Cart</h1><p>' + copy.cart + '</p></main>';
    } else {
      throw new Error('Unexpected request path');
    }
    const select = '<select class="locale-switcher">' + locales.map((value) => '<option value="' + value + '"' + (value === locale ? ' selected' : '') + '>' + value + '</option>').join('') + '</select>';
    return new Response('<html lang="' + locale + '">' + select + body + '</html>', {headers});
  };
`;

async function check(mode, bypassToken = token, {localization = false, catalog = false, dictionaries, locales = gtConfig.locales, fallbackLocale} = {}) {
  // Isolate local catalogs from real merchant content while exercising the CLI.
  const root = await mkdtemp(join(tmpdir(), 'gt-deployment-check-'));
  try {
    await mkdir(join(root, 'scripts'));
    const fixtureScript = join(root, 'scripts/check-deployment.mjs');
    await writeFile(fixtureScript, await readFile(script));
    await writeFile(join(root, 'gt.config.json'), JSON.stringify({...gtConfig, locales}));
    if (dictionaries) {
      await mkdir(join(root, 'catalog'));
      for (const [locale, dictionary] of Object.entries(dictionaries)) {
        await writeFile(join(root, 'catalog', `${locale}.json`), JSON.stringify(dictionary));
      }
    }
    return await run(process.execPath, [
      '--import', `data:text/javascript,${encodeURIComponent(fixture)}`,
      fixtureScript, 'https://preview.myshopify.dev',
    ], {
      env: {...process.env, DEPLOYMENT_CHECK_FIXTURE: mode, OXYGEN_AUTH_BYPASS_TOKEN: bypassToken,
        DEPLOYMENT_CHECK_LOCALES: JSON.stringify([...new Set([gtConfig.defaultLocale, ...locales])]),
        DEPLOYMENT_CHECK_FALLBACK_LOCALE: fallbackLocale || '',
        CHECK_LOCALIZATION: localization ? '1' : '0', CHECK_CATALOG: catalog ? '1' : '0'},
    });
  } finally {
    await rm(root, {recursive: true, force: true});
  }
}

const dictionaries = {
  en: {product_123_title: 'Shirt', product_123_description: 'A soft cotton shirt.'},
  fr: {product_123_title: 'Chemise', product_123_description: 'Une chemise en coton doux.'},
  ja: {product_123_title: 'シャツ', product_123_description: '柔らかなコットンのシャツ。'},
  ko: {product_123_title: '셔츠', product_123_description: '부드러운 면 셔츠.'},
  id: {product_123_title: 'Kemeja', product_123_description: 'Kemeja katun yang lembut.'},
};

test('protected deployment checks authenticate same-origin pages and assets without printing the token', async () => {
  const {stdout, stderr} = await check('protected');
  assert.match(stdout, /7 deployment checks passed/);
  assert.equal(stderr, '');
  assert.ok(!stdout.includes(token));
});

test('public deployment checks omit the bypass header when no token is configured', async () => {
  const {stdout, stderr} = await check('public', '');
  assert.match(stdout, /7 deployment checks passed/);
  assert.equal(stderr, '');
});

test('Oxygen CDN assets are checked without forwarding the storefront token', async () => {
  const {stdout, stderr} = await check('cdn');
  assert.match(stdout, /All 2 referenced JavaScript and CSS assets load/);
  assert.match(stdout, /7 deployment checks passed/);
  assert.equal(stderr, '');
  assert.ok(!stdout.includes(token));
});

test('protected deployment redirects fail with authentication guidance instead of following another origin', async () => {
  await assert.rejects(check('redirect'), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /OXYGEN_AUTH_BYPASS_TOKEN/);
    assert.ok(!(error.stdout + error.stderr).includes(token));
    return true;
  });
});

test('assertion errors redact a token echoed in a response', async () => {
  await assert.rejects(check('echo-token'), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /\[REDACTED\]/);
    assert.ok(!(error.stdout + error.stderr).includes(token));
    return true;
  });
});

test('localization-only checks preserve the twelve groups for older deployments without catalog files or product IDs', async () => {
  const {stdout, stderr} = await check('localized', token, {localization: true, locales: ['fr', 'ja']});
  assert.match(stdout, /12 deployment checks passed/);
  assert.equal(stderr, '');
});

test('catalog checks verify translated SSR titles and descriptions, canonical purchase inputs, and currency formats', async () => {
  const {stdout, stderr} = await check('catalog', token, {catalog: true, dictionaries});
  assert.ok(stdout.includes(`${expectedChecks} deployment checks passed`));
  for (const locale of configuredLocales) assert.ok(stdout.includes(`PASS ${locale} initial HTML`));
  assert.match(stdout, /catalog translations, purchase inputs, and currency checked/);
  assert.equal(stderr, '');
});

test('localization checks use configured Korean and Indonesian locales without requiring French or Japanese', async () => {
  const {stdout, stderr} = await check('localized', token, {localization: true, locales: ['ko', 'id']});
  assert.match(stdout, /12 deployment checks passed/);
  for (const locale of ['en', 'ko', 'id']) assert.ok(stdout.includes(`PASS ${locale} initial HTML`));
  assert.doesNotMatch(stdout, /PASS (?:fr|ja) initial HTML/);
  assert.match(stdout, /Locale cookies override conflicting Accept-Language preferences/);
  assert.match(stdout, /Repeated language requests do not share locale state/);
  assert.equal(stderr, '');
});

test('configured Korean and Indonesian locales cannot silently serve English UI or catalog titles', async () => {
  for (const fallbackLocale of ['ko', 'id']) {
    await assert.rejects(check('localized-fallback', token, {localization: true, fallbackLocale}), (error) => {
      assert.ok(error.stderr.includes(`${fallbackLocale} heading must contain translated copy, not English fallback`));
      return true;
    });
    await assert.rejects(check('catalog-locale-title-fallback', token, {catalog: true, dictionaries, fallbackLocale}), (error) => {
      assert.match(error.stderr, /Product title must match the current GT catalog translation/);
      return true;
    });
  }
});

test('catalog checks require files for every configured locale', async () => {
  for (const locale of ['ko', 'id']) {
    const missing = {...dictionaries};
    delete missing[locale];
    await assert.rejects(check('catalog', token, {catalog: true, dictionaries: missing}), (error) => {
      assert.ok(error.stderr.includes(`requires catalog/${locale}.json`));
      return true;
    });
  }
});

test('catalog checks allow unchanged branded product titles', async () => {
  const branded = Object.fromEntries(Object.entries(dictionaries)
    .map(([locale, entries]) => [locale, {...entries, product_123_title: 'Shirt'}]));
  const {stdout, stderr} = await check('catalog-brand', token, {catalog: true, dictionaries: branded});
  assert.ok(stdout.includes(`${expectedChecks} deployment checks passed`));
  assert.equal(stderr, '');
});

test('localization checks fall back to live English for a stale catalog source', async () => {
  const stale = {...dictionaries, en: {...dictionaries.en, product_123_title: 'Old shirt'}};
  const {stdout, stderr} = await check('catalog-stale-fallback', token, {localization: true, dictionaries: stale});
  assert.ok(stdout.includes(`${expectedChecks} deployment checks passed`));
  assert.equal(stderr, '');
});

test('catalog checks reject stale source mappings and missing catalog files', async () => {
  const stale = {...dictionaries, en: {...dictionaries.en, product_123_title: 'Old shirt'}};
  await assert.rejects(check('catalog-stale', token, {catalog: true, dictionaries: stale}), (error) => {
    assert.match(error.stderr, /Catalog title source must match the live English product/);
    return true;
  });
  await assert.rejects(check('catalog-missing', token, {catalog: true}), (error) => {
    assert.match(error.stderr, /requires catalog\/en.json/);
    return true;
  });
});

test('catalog checks reject English title fallback, translated purchase inputs, and the wrong currency format', async () => {
  for (const [mode, message] of [
    ['catalog-wrong-title', /Product title must match the current GT catalog translation/],
    ['catalog-changed-input', /preserve canonical Shopify variant IDs and purchase inputs/],
    ['catalog-wrong-currency', /Expected the fr currency format/],
  ]) {
    await assert.rejects(check(mode, token, {catalog: true, dictionaries}), (error) => {
      assert.match(error.stderr, message);
      assert.ok(!(error.stdout + error.stderr).includes('gid://shopify/ProductVariant/'));
      assert.ok(!(error.stdout + error.stderr).includes(token));
      return true;
    });
  }
});
