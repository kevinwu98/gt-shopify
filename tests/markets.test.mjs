import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {cartGetIdDefault} from '@shopify/hydrogen';
import {initializeGT, parseLocale} from 'gt-react';
import ts from 'typescript';
import {AppSession} from '../app/lib/session.ts';

const countries = [
  {isoCode: 'US', name: 'United States', currency: {isoCode: 'USD', symbol: '$'}},
  {isoCode: 'CA', name: 'Canada', currency: {isoCode: 'CAD', symbol: '$'}},
];
const origin = 'https://store.example';
const sessionSecret = 'market-test-only-signing-secret';
const gtConfig = JSON.parse(await readFile(new URL('../gt.config.json', import.meta.url), 'utf8'));
initializeGT({defaultLocale: gtConfig.defaultLocale, locales: gtConfig.locales});
const localeMarketUrl = await typeScriptUrl('../app/lib/locale-market.ts', {
  '../../gt.config.json': `data:text/javascript,${encodeURIComponent(`export default ${JSON.stringify(gtConfig)};`)}`,
});
const marketUrl = await typeScriptUrl('../app/lib/markets.server.ts', {
  '@shopify/hydrogen': import.meta.resolve('@shopify/hydrogen'),
  'react-router': import.meta.resolve('react-router'),
  './locale-market': localeMarketUrl,
});
const {changeMarket, getMarketCountry, getMarkets, MARKET_QUERY, CART_MARKET_AVAILABILITY_QUERY} = await import(marketUrl);
const variantId = 'gid://shopify/ProductVariant/1';

const localeMarkets = [
  {locale: 'en', country: 'US', currency: 'USD'},
  {locale: 'fr', country: 'FR', currency: 'EUR'},
  {locale: 'id', country: 'ID', currency: 'IDR'},
  {locale: 'ja', country: 'JP', currency: 'JPY'},
  {locale: 'ko', country: 'KR', currency: 'KRW'},
];
const allCountries = localeMarkets.map(({country, currency}) => ({
  isoCode: country, name: country, currency: {isoCode: currency, symbol: currency},
}));

function localeRequest(locale, fields = {}, headers = {Origin: origin}) {
  return new Request(`${origin}/market`, {
    method: 'POST', headers,
    body: new URLSearchParams({locale, returnTo: '/products/shirt?Size=M#details', ...fields}),
  });
}

function localeContext(options = {}) {
  return context({queryResult: {localization: {country: allCountries[0], availableCountries: allCountries}}, ...options});
}

function request(fields = {}, headers = {Origin: origin}) {
  return new Request(`${origin}/market`, {
    method: 'POST', headers, body: new URLSearchParams({country: 'CA', returnTo: '/products/shirt?Size=M', ...fields}),
  });
}

function context({cartId, queryResult, result, queryError, cartError, availabilityResult, availabilityError,
  readResult = {id: cartId, totalQuantity: 1, lines: {nodes: [{id: 'line-1', quantity: 1, merchandise: {id: variantId}}]}}, readError} = {}) {
  const events = [];
  const ctx = {
    events,
    session: {set: (...args) => events.push(['session', ...args])},
    storefront: {
      i18n: {country: 'US', language: 'EN'},
      CacheShort: () => ({maxAge: 1}),
      CacheNone: () => ({mode: 'no-store'}),
      query: async (query, options) => {
        if (query === CART_MARKET_AVAILABILITY_QUERY) {
          events.push(['availability', query, options]);
          if (availabilityError) throw availabilityError;
          return availabilityResult ?? {nodes: [{id: variantId, availableForSale: true}]};
        }
        events.push(['query', query, options]);
        if (queryError) throw queryError;
        return queryResult ?? {localization: {country: countries[0], availableCountries: countries}};
      },
    },
    cart: {
      getCartId: () => cartId,
      get: async (options) => {
        ctx.readOptions = options;
        events.push(['read-cart']);
        if (readError) throw readError;
        return readResult;
      },
      updateBuyerIdentity: async (identity) => {
        events.push(['buyer', identity]);
        if (cartError) throw cartError;
        return result ?? {cart: {id: 'gid://shopify/Cart/updated'}, errors: [], userErrors: []};
      },
      setCartId: (id) => {
        events.push(['cart-cookie', id]);
        return new Headers({'Set-Cookie': 'cart=updated; Path=/; HttpOnly'});
      },
    },
  };
  return ctx;
}

test('markets use the selected country context and expose Shopify available countries and currencies', async () => {
  const ctx = context();
  ctx.storefront.i18n.country = 'CA';
  const markets = await getMarkets(ctx.storefront);
  assert.deepEqual(markets.availableCountries, countries);
  assert.equal(ctx.events[0][1], MARKET_QUERY);
  assert.deepEqual(ctx.events[0][2], {variables: {country: 'CA'}, cache: {maxAge: 1}});
});

test('a signed market session defaults to US and rejects tampered cookies', async () => {
  const fresh = await AppSession.init(new Request(origin), [sessionSecret]);
  assert.equal(getMarketCountry(fresh), 'US');
  fresh.set('country', 'CA');
  const cookie = (await fresh.commit()).split(';')[0];
  const saved = await AppSession.init(new Request(origin, {headers: {Cookie: cookie}}), [sessionSecret]);
  assert.equal(getMarketCountry(saved), 'CA');
  const tampered = await AppSession.init(new Request(origin, {headers: {Cookie: `${cookie}tampered`}}), [sessionSecret]);
  assert.equal(getMarketCountry(tampered), 'US');
  saved.set('country', 'invalid');
  assert.equal(getMarketCountry(saved), 'US');
});

test('selecting a market without a cart stores the country without creating a cart', async () => {
  const ctx = context();
  const response = await changeMarket(request(), ctx);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), '/products/shirt?Size=M');
  assert.deepEqual(ctx.events.map(([event]) => event), ['query', 'session']);
  assert.deepEqual(ctx.events.at(-1), ['session', 'country', 'CA']);
  assert.equal(response.headers.get('Set-Cookie'), null);
});

test('an existing cart buyer country is updated before the session, preserving its new cart cookie', async () => {
  const ctx = context({cartId: 'gid://shopify/Cart/old'});
  const response = await changeMarket(request({returnTo: '/cart?view=full#items'}), ctx);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), '/cart?view=full#items');
  assert.match(response.headers.get('Set-Cookie'), /^cart=updated/);
  assert.deepEqual(ctx.events.slice(1).filter(([event]) => event !== 'availability'), [
    ['read-cart'],
    ['buyer', {countryCode: 'CA'}],
    ['cart-cookie', 'gid://shopify/Cart/updated'],
    ['session', 'country', 'CA'],
  ]);
});

test('an expired cart permits a market change and clears its stale cookie without a cart mutation', async () => {
  const ctx = context({cartId: 'gid://shopify/Cart/expired', readResult: null});
  const response = await changeMarket(request(), ctx);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), '/products/shirt?Size=M');
  const cookie = response.headers.get('Set-Cookie');
  assert.match(cookie, /^cart=;/);
  assert.match(cookie, /Max-Age=0/i);
  assert.match(cookie, /Path=\//i);
  assert.equal(cartGetIdDefault(new Headers({Cookie: cookie.split(';')[0]}))(), undefined);
  assert.deepEqual(ctx.events.slice(1), [['read-cart'], ['session', 'country', 'CA']]);
});

test('an existing empty cart is updated rather than discarded', async () => {
  const ctx = context({cartId: 'existing', readResult: {id: 'existing', totalQuantity: 0, lines: {nodes: []}}});
  const response = await changeMarket(request(), ctx);
  assert.equal(response.status, 303);
  assert.match(response.headers.get('Set-Cookie'), /^cart=updated/);
  assert.ok(ctx.events.some(([event]) => event === 'buyer'));
  assert.ok(!ctx.events.some(([event]) => event === 'availability'));
});

test('cart lookup failures preserve the cart and market instead of treating them as expired', async () => {
  for (const options of [
    {readError: new Error('private read error')},
    {readResult: {errors: [{message: 'private read error'}]}},
    {readResult: {id: 'existing', totalQuantity: 2, errors: [{message: 'private read error'}]}},
    {readResult: {}},
  ]) {
    const ctx = context({cartId: 'existing', ...options});
    const response = await changeMarket(request(), ctx);
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.deepEqual(ctx.events.slice(1), [['read-cart']]);
    assert.ok(!(await response.text()).includes('private read error'));
  }
});

test('unavailable countries and invalid form values cannot change the session or cart', async () => {
  for (const country of ['FR', 'ZZ', 'ca', '', 'CA\n']) {
    const ctx = context({cartId: 'existing'});
    assert.equal((await changeMarket(request({country}), ctx)).status, 400);
    assert.ok(ctx.events.every(([event]) => event === 'query'));
  }
});

test('cross-origin requests and external return destinations are rejected before Shopify calls', async () => {
  for (const destination of ['https://evil.example', '//evil.example', '//store.example/cart', '/\\evil.example', 'cart', '/\n/evil.example']) {
    const ctx = context({cartId: 'existing'});
    assert.equal((await changeMarket(request({returnTo: destination}), ctx)).status, 400);
    assert.deepEqual(ctx.events, []);
  }
  for (const invalidOrigin of ['https://evil.example', 'null', '']) {
    const ctx = context({cartId: 'existing'});
    assert.equal((await changeMarket(request({}, {Origin: invalidOrigin}), ctx)).status, 403);
    assert.deepEqual(ctx.events, []);
  }
  const noOrigin = context();
  assert.equal((await changeMarket(request({}, {}), noOrigin)).status, 303);
});

test('cart GraphQL, user, transport, and missing-cart failures leave the country and cookies unchanged', async () => {
  for (const options of [
    {result: {cart: {id: 'partial'}, errors: [{message: 'private error'}]}},
    {result: {cart: {id: 'partial'}, userErrors: [{message: 'private error'}]}},
    {result: {cart: null, userErrors: []}},
    {cartError: new Error('private error')},
  ]) {
    const ctx = context({cartId: 'existing', ...options});
    const response = await changeMarket(request(), ctx);
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.ok(!ctx.events.some(([event]) => event === 'session' || event === 'cart-cookie'));
    assert.ok(!(await response.text()).includes('private error'));
  }
});

test('market lookup failures cannot update buyer identity or country', async () => {
  for (const options of [
    {queryError: new Error('private error')},
    {queryResult: {localization: null}},
    {queryResult: {localization: {country: countries[0], availableCountries: countries}, errors: [{message: 'private error'}]}},
  ]) {
    const ctx = context({cartId: 'existing', ...options});
    const response = await changeMarket(request(), ctx);
    assert.equal(response.status, 502);
    assert.deepEqual(ctx.events.map(([event]) => event), ['query']);
    assert.ok(!(await response.text()).includes('private error'));
  }
});

test('every configured selector language has a verified demo market mapping', () => {
  assert.deepEqual(
    localeMarkets.map(({locale}) => locale).sort(),
    [gtConfig.defaultLocale, ...gtConfig.locales].sort(),
  );
});

for (const {locale, country} of localeMarkets) {
  test(`selecting ${locale} derives ${country} and sets a GT-readable language cookie without creating a cart`, async () => {
    const ctx = localeContext();
    const response = await changeMarket(localeRequest(locale), ctx);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('Location'), '/products/shirt?Size=M#details');
    assert.equal(response.headers.get('X-Remix-Reload-Document'), 'true');
    assert.deepEqual(ctx.events.map(([event]) => event), ['query', 'session']);
    assert.deepEqual(ctx.events.at(-1), ['session', 'country', country]);
    const cookies = response.headers.getSetCookie();
    assert.equal(cookies.length, 1);
    assert.match(cookies[0], new RegExp(`^generaltranslation\\.locale=${locale};`));
    assert.match(cookies[0], /(?:^|;)\s*Path=\//i);
    assert.match(cookies[0], /(?:^|;)\s*SameSite=Lax(?:;|$)/i);
    assert.match(cookies[0], /(?:^|;)\s*Secure(?:;|$)/i);
    assert.doesNotMatch(cookies[0], /HttpOnly/i);
    assert.equal(parseLocale(new Request(origin, {
      headers: {Cookie: cookies[0].split(';')[0], 'Accept-Language': locale === 'en' ? 'ja' : 'en'},
    })), locale);
  });
}

test('the locale cookie works on localhost HTTP while retaining path and SameSite scope', async () => {
  const ctx = localeContext();
  const response = await changeMarket(new Request('http://localhost:3140/market', {
    method: 'POST', headers: {Origin: 'http://localhost:3140'},
    body: new URLSearchParams({locale: 'ja', returnTo: '/'}),
  }), ctx);
  assert.equal(response.status, 303);
  const cookie = response.headers.getSetCookie()[0];
  assert.match(cookie, /^generaltranslation\.locale=ja;/);
  assert.match(cookie, /(?:^|;)\s*Path=\//i);
  assert.match(cookie, /(?:^|;)\s*SameSite=Lax(?:;|$)/i);
  assert.doesNotMatch(cookie, /(?:^|;)\s*Secure(?:;|$)/i);
});

test('an explicitly matching locale and country is accepted as one selection', async () => {
  const ctx = localeContext();
  const response = await changeMarket(localeRequest('ja', {country: 'JP'}), ctx);
  assert.equal(response.status, 303);
  assert.deepEqual(ctx.events.at(-1), ['session', 'country', 'JP']);
  assert.ok(response.headers.getSetCookie().some((cookie) => cookie.startsWith('generaltranslation.locale=ja;')));
});

test('a language selection updates an existing cart market before writing either preference and preserves both cookies', async () => {
  const ctx = localeContext({cartId: 'gid://shopify/Cart/old'});
  const response = await changeMarket(localeRequest('ja'), ctx);
  assert.equal(response.status, 303);
  assert.deepEqual(ctx.events.slice(1).filter(([event]) => event !== 'availability'), [
    ['read-cart'],
    ['buyer', {countryCode: 'JP'}],
    ['cart-cookie', 'gid://shopify/Cart/updated'],
    ['session', 'country', 'JP'],
  ]);
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  assert.ok(cookies.some((cookie) => cookie.startsWith('cart=updated;')));
  assert.ok(cookies.some((cookie) => cookie.startsWith('generaltranslation.locale=ja;')));
});

test('cart market availability is checked for the destination without cache before buyer identity changes', async () => {
  const ctx = localeContext({cartId: 'existing'});
  const response = await changeMarket(localeRequest('ja'), ctx);
  assert.equal(response.status, 303);
  assert.deepEqual(ctx.readOptions, {numCartLines: 250});
  assert.deepEqual(ctx.events.map(([event]) => event), ['query', 'read-cart', 'availability', 'buyer', 'cart-cookie', 'session']);
  const availability = ctx.events.find(([event]) => event === 'availability');
  assert.equal(availability[1], CART_MARKET_AVAILABILITY_QUERY);
  assert.deepEqual(availability[2], {variables: {ids: [variantId], country: 'JP'}, cache: {mode: 'no-store'}});
});

test('unavailable or missing destination variants cannot drop a cart line or partially switch language', async () => {
  for (const nodes of [
    [{id: variantId, availableForSale: false}],
    [null],
    [],
    [{id: 'gid://shopify/ProductVariant/other', availableForSale: true}],
  ]) {
    const ctx = localeContext({cartId: 'existing', availabilityResult: {nodes}});
    const response = await changeMarket(localeRequest('fr'), ctx);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'CART_MARKET_UNAVAILABLE');
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.deepEqual(ctx.events.map(([event]) => event), ['query', 'read-cart', 'availability']);
  }
});

test('availability lookup failures preserve the previous language, country, and cart', async () => {
  for (const options of [
    {availabilityError: new Error('private availability error')},
    {availabilityResult: {nodes: [{id: variantId, availableForSale: true}], errors: [{message: 'private availability error'}]}},
    {availabilityResult: {}},
  ]) {
    const ctx = localeContext({cartId: 'existing', ...options});
    const response = await changeMarket(localeRequest('ko'), ctx);
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.deepEqual(ctx.events.map(([event]) => event), ['query', 'read-cart', 'availability']);
    assert.doesNotMatch(await response.text(), /private availability error/);
  }
});

test('incomplete cart pages or missing merchandise cannot silently omit a line from availability checks', async () => {
  for (const readResult of [
    {id: 'existing', totalQuantity: 2, lines: {nodes: [{id: 'line-1', quantity: 1, merchandise: {id: variantId}}]}},
    {id: 'existing', totalQuantity: 1, lines: {nodes: [{id: 'line-1', quantity: 1}]}},
    {id: 'existing', totalQuantity: 1, lines: {nodes: []}},
    {id: 'existing', totalQuantity: 1},
  ]) {
    const ctx = localeContext({cartId: 'existing', readResult});
    const response = await changeMarket(localeRequest('id'), ctx);
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.deepEqual(ctx.events.map(([event]) => event), ['query', 'read-cart']);
  }
});

test('an expired cart is cleared while both language and country change successfully', async () => {
  const ctx = localeContext({cartId: 'expired', readResult: null});
  const response = await changeMarket(localeRequest('ko'), ctx);
  assert.equal(response.status, 303);
  assert.deepEqual(ctx.events.slice(1), [['read-cart'], ['session', 'country', 'KR']]);
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  assert.ok(cookies.some((cookie) => cookie.startsWith('cart=;') && /Max-Age=0/i.test(cookie)));
  assert.ok(cookies.some((cookie) => cookie.startsWith('generaltranslation.locale=ko;')));
});

test('unconfigured locales and mismatched locale-country requests cannot change either preference', async () => {
  for (const [locale, fields] of [
    ['es', {}], ['ja-JP', {}], ['JA', {}], ['', {}], ['ja\n', {}],
    ['ja', {country: 'US'}], ['fr', {country: 'CA'}],
  ]) {
    const ctx = localeContext({cartId: 'existing'});
    const response = await changeMarket(localeRequest(locale, fields), ctx);
    assert.equal(response.status, 400, `${JSON.stringify({locale, fields})} must be rejected`);
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.deepEqual(ctx.events, []);
  }
});

test('a translated language with no available Shopify market leaves the previous language and country unchanged', async () => {
  const ctx = context({cartId: 'existing'});
  const response = await changeMarket(localeRequest('ja'), ctx);
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.deepEqual(ctx.events.map(([event]) => event), ['query']);
});

test('cart read and update failures cannot partially change the GT language', async () => {
  for (const options of [
    {readError: new Error('private read error')},
    {readResult: {errors: [{message: 'private read error'}]}},
    {readResult: {}},
    {result: {cart: {id: 'partial'}, errors: [{message: 'private update error'}]}},
    {result: {cart: {id: 'partial'}, userErrors: [{message: 'private update error'}]}},
    {result: {cart: null, userErrors: []}},
    {cartError: new Error('private update error')},
  ]) {
    const ctx = localeContext({cartId: 'existing', ...options});
    const response = await changeMarket(localeRequest('fr'), ctx);
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.ok(!ctx.events.some(([event]) => event === 'session' || event === 'cart-cookie'));
    assert.doesNotMatch(await response.text(), /private (read|update) error/);
  }
});

test('Shopify market lookup failures cannot partially change the GT language', async () => {
  const ctx = localeContext({cartId: 'existing', queryError: new Error('private error')});
  const response = await changeMarket(localeRequest('id'), ctx);
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.deepEqual(ctx.events.map(([event]) => event), ['query']);
});

test('language changes preserve the existing origin and local-redirect protections', async () => {
  for (const [fields, headers, status] of [
    [{returnTo: 'https://evil.example'}, {Origin: origin}, 400],
    [{returnTo: '//evil.example'}, {Origin: origin}, 400],
    [{}, {Origin: 'https://evil.example'}, 403],
  ]) {
    const ctx = localeContext({cartId: 'existing'});
    const response = await changeMarket(localeRequest('ja', fields, headers), ctx);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.deepEqual(ctx.events, []);
  }
});

async function typeScriptUrl(path, imports) {
  let compiled = ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022},
  }).outputText;
  for (const [specifier, replacement] of Object.entries(imports)) {
    compiled = compiled.replaceAll(`'${specifier}'`, JSON.stringify(replacement))
      .replaceAll(JSON.stringify(specifier), JSON.stringify(replacement));
  }
  return `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`;
}

async function loadTypeScript(path, imports) {
  return import(await typeScriptUrl(path, imports));
}

test('actual Hydrogen context creates new carts with the signed market country while keeping source language English', async (t) => {
  const {createHydrogenRouterContext} = await loadTypeScript('../app/lib/context.ts', {
    '@shopify/hydrogen': import.meta.resolve('@shopify/hydrogen'),
    '~/lib/session': new URL('../app/lib/session.ts', import.meta.url).href,
    '~/lib/fragments': new URL('../app/lib/fragments.ts', import.meta.url).href,
    '~/lib/markets.server': marketUrl,
  });
  const originalCaches = globalThis.caches;
  globalThis.caches = {open: async () => undefined};
  t.after(() => { globalThis.caches = originalCaches; });
  t.mock.method(globalThis, 'fetch', () => assert.fail('No network request should be made'));
  const session = await AppSession.init(new Request(origin), [sessionSecret]);
  session.set('country', 'CA');
  const cookie = (await session.commit()).split(';')[0];
  const ctx = await createHydrogenRouterContext(new Request(origin, {headers: {Cookie: cookie}}), {
    SESSION_SECRET: sessionSecret,
    PUBLIC_STORE_DOMAIN: 'market-test.myshopify.com',
    PUBLIC_STOREFRONT_API_TOKEN: 'test-only-token',
  }, {waitUntil: () => {}});
  assert.equal(ctx.storefront.i18n.country, 'CA');
  assert.equal(ctx.storefront.i18n.language, 'EN');
  const calls = [];
  ctx.storefront.mutate = async (query, options) => {
    calls.push({query, options});
    return {cartCreate: {cart: {id: 'gid://shopify/Cart/new'}, userErrors: []}};
  };
  await ctx.cart.addLines([{merchandiseId: 'gid://shopify/ProductVariant/1', quantity: 1}]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].query, /mutation cartCreate/);
  assert.equal(calls[0].options.variables.input.buyerIdentity.countryCode, 'CA');
});

test('the server preserves both cart and GT locale cookies when committing the market session cookie', async () => {
  const hydrogen = `data:text/javascript,${encodeURIComponent("export const createRequestHandler = () => async () => new Response(null, {status:303,headers:[['Set-Cookie','cart=updated; Path=/'],['Set-Cookie','generaltranslation.locale=ja; Path=/'],['Location','/cart']]}); export const storefrontRedirect = () => {throw Error('Unexpected redirect');};")}`;
  const contextModule = `data:text/javascript,${encodeURIComponent("export const createHydrogenRouterContext = async () => ({session:{isPending:true,commit:async () => 'session=signed; Path=/; HttpOnly'}});")}`;
  const {default: server} = await loadTypeScript('../server.ts', {
    'virtual:react-router/server-build': 'data:text/javascript,export const routes={};',
    '@shopify/hydrogen': hydrogen,
    '~/lib/context': contextModule,
  });
  const response = await server.fetch(request(), {}, {});
  assert.equal(response.status, 303);
  assert.deepEqual(response.headers.getSetCookie(), ['cart=updated; Path=/', 'generaltranslation.locale=ja; Path=/', 'session=signed; Path=/; HttpOnly']);
});
