import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {test} from 'node:test';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/check-deployment.mjs', import.meta.url));
const token = 'test-only-oxygen-bypass-token';

// Run the actual CLI with a deterministic fetch fixture, without network access.
const fixture = `
  import assert from 'node:assert/strict';
  const mode = process.env.DEPLOYMENT_CHECK_FIXTURE;
  const token = process.env.OXYGEN_AUTH_BYPASS_TOKEN;
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://preview.myshopify.dev', 'No cross-origin requests');
    assert.equal(options.redirect, 'manual', 'Redirects must not forward the token');
    assert.equal(new Headers(options.headers).get('oxygen-auth-bypass-token'), token || null);
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
    let body;
    if (url.pathname === '/') {
      body = '<html lang="en"><h1>Good things, worn often.</h1><link href="/assets/app.css"><script src="/assets/app.js"></script><script src="https://other.example/foreign.js"></script>';
    } else if (url.pathname === '/collections/all') {
      body = '<a href="/products/shirt">Shirt</a>';
    } else if (url.pathname === '/products/shirt') {
      body = '<h1>Shirt</h1><button>Add to cart</button>';
    } else if (url.pathname === '/search') {
      body = '<h1>Search</h1>' + (url.searchParams.get('q') === 'gtOxygenNoMatch7f96f8'
        ? '<p>No results. Try a different search.</p>'
        : '<a href="/products/shirt">Shirt</a>');
    } else if (url.pathname === '/cart') {
      body = '<p>Your cart is empty. Find something you love.</p>';
    } else {
      throw new Error('Unexpected request path');
    }
    return new Response(body, {headers});
  };
`;

async function check(mode, bypassToken = token) {
  return run(process.execPath, [
    '--import', `data:text/javascript,${encodeURIComponent(fixture)}`,
    script, 'https://preview.myshopify.dev',
  ], {
    env: {...process.env, DEPLOYMENT_CHECK_FIXTURE: mode, OXYGEN_AUTH_BYPASS_TOKEN: bypassToken},
  });
}

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
