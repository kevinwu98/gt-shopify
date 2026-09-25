import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import ts from 'typescript';
import {AppSession} from '../app/lib/session.ts';
import {changeMarket, getMarketCountry, getMarkets, MARKET_QUERY} from '../app/lib/markets.server.ts';

const countries = [
  {isoCode: 'US', name: 'United States', currency: {isoCode: 'USD', symbol: '$'}},
  {isoCode: 'CA', name: 'Canada', currency: {isoCode: 'CAD', symbol: '$'}},
];
const origin = 'https://store.example';
const sessionSecret = 'market-test-only-signing-secret';

function request(fields = {}, headers = {Origin: origin}) {
  return new Request(`${origin}/market`, {
    method: 'POST', headers, body: new URLSearchParams({country: 'CA', returnTo: '/products/shirt?Size=M', ...fields}),
  });
}

function context({cartId, queryResult, result, queryError, cartError} = {}) {
  const events = [];
  const ctx = {
    events,
    session: {set: (...args) => events.push(['session', ...args])},
    storefront: {
      i18n: {country: 'US', language: 'EN'},
      CacheShort: () => ({maxAge: 1}),
      query: async (query, options) => {
        events.push(['query', query, options]);
        if (queryError) throw queryError;
        return queryResult ?? {localization: {country: countries[0], availableCountries: countries}};
      },
    },
    cart: {
      getCartId: () => cartId,
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
  assert.deepEqual(ctx.events.slice(1), [
    ['buyer', {countryCode: 'CA'}],
    ['cart-cookie', 'gid://shopify/Cart/updated'],
    ['session', 'country', 'CA'],
  ]);
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

async function loadTypeScript(path, imports) {
  let compiled = ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022},
  }).outputText;
  for (const [specifier, replacement] of Object.entries(imports)) {
    compiled = compiled.replaceAll(`'${specifier}'`, JSON.stringify(replacement))
      .replaceAll(JSON.stringify(specifier), JSON.stringify(replacement));
  }
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

test('actual Hydrogen context creates new carts with the signed market country while keeping source language English', async (t) => {
  const {createHydrogenRouterContext} = await loadTypeScript('../app/lib/context.ts', {
    '@shopify/hydrogen': import.meta.resolve('@shopify/hydrogen'),
    '~/lib/session': new URL('../app/lib/session.ts', import.meta.url).href,
    '~/lib/fragments': new URL('../app/lib/fragments.ts', import.meta.url).href,
    '~/lib/markets.server': new URL('../app/lib/markets.server.ts', import.meta.url).href,
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

test('the server preserves the cart cookie when committing the market session cookie', async () => {
  const hydrogen = `data:text/javascript,${encodeURIComponent("export const createRequestHandler = () => async () => new Response(null, {status:303,headers:{'Set-Cookie':'cart=updated; Path=/','Location':'/cart'}}); export const storefrontRedirect = () => {throw Error('Unexpected redirect');};")}`;
  const contextModule = `data:text/javascript,${encodeURIComponent("export const createHydrogenRouterContext = async () => ({session:{isPending:true,commit:async () => 'session=signed; Path=/; HttpOnly'}});")}`;
  const {default: server} = await loadTypeScript('../server.ts', {
    'virtual:react-router/server-build': 'data:text/javascript,export const routes={};',
    '@shopify/hydrogen': hydrogen,
    '~/lib/context': contextModule,
  });
  const response = await server.fetch(request(), {}, {});
  assert.equal(response.status, 303);
  assert.deepEqual(response.headers.getSetCookie(), ['cart=updated; Path=/', 'session=signed; Path=/; HttpOnly']);
});
