# English storefront on Oxygen

## Store and repository

Repository: https://github.com/kevinwu98/gt-shopify (private).

The free dev store **GT Supply Demo** (`gt-supply-demo.myshopify.com`) has been created and the Hydrogen sales channel is installed. Six complete sample snowboard products are available to this storefront. The homepage uses a collection image or its first product's image.

Oxygen supports dev stores, but dev stores have no public Oxygen environments. Their deployment URLs require store login in a browser or an authentication bypass token for automated checks. A paid plan with a public environment is needed for a public demo. [Shopify's supported plans](https://shopify.dev/docs/storefronts/headless/hydrogen/fundamentals#supported-plans)

The **GT Supply Demo** Hydrogen storefront (ID `1000180871`) is connected to `kevinwu98/gt-shopify`, with `main` as its production branch. Shopify's generated deployment workflow was reviewed and merged in [PR #1](https://github.com/kevinwu98/gt-shopify/pull/1). The existing `ci.yml` checks the app; Shopify's generated workflow deploys it. Both use Node 24. [Official GitHub setup](https://shopify.dev/docs/storefronts/headless/hydrogen/deployments/github)

Storefront URL: https://gt-supply-demo-d4eecb57c0a4e7a633e0.o2.myshopify.dev

Manage deployments: https://admin.shopify.com/store/gt-supply-demo/hydrogen/1000180871

## Verified English baseline

On September 24, 2026, commit `5319dc1` deployed successfully through GitHub Actions. Seven automated checks passed on its protected Oxygen preview: English server-rendered HTML/CSP, 15 JavaScript/CSS assets, catalog, purchasable product, full search, empty search, and fresh empty cart. Browser checks on the production environment confirmed variant switching, cart add/update/remove, reload persistence, and checkout handoff with the correct variant and quantity. Shopify displayed its Test Payment Gateway; no order was placed.

The development-store checkout requires the store password on first access. Find the existing password under **Online Store → Preferences**; keep it private. Oxygen itself uses your Shopify store login.

## Link the local checkout

Keep the shared sample-store configuration in `.env.example`. Pull the linked store's configuration into the ignored `.env` file:

```bash
npx shopify hydrogen link
npx shopify hydrogen env pull
```

Before deploying, check the Hydrogen channel's **Storefront settings → Environments and variables**. Use the linked store's supplied Storefront and checkout values and a unique, secret `SESSION_SECRET`. The `SESSION_SECRET` in `.env.example` is only for local/CI sample-catalog testing. Never commit pulled credentials or paste them into logs.

Shopify owns environment variables for the deployed app; the checked-in `.env.example` does not configure Oxygen.

## Validate and deploy

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npx shopify hydrogen deploy --preview --auth-bypass-token
```

The deployment command returns the Oxygen preview URL and authentication bypass token. CLI 3.93.2 writes `h2_deploy_log.json` only when running in CI. Keep tokens and deployment logs private and uncommitted; the JSON filename is gitignored. Open the preview while signed into the store. Verify home, collection, product variant selection, predictive/full search, and cart add/update/remove plus reload persistence. For the development store, verify that the checkout link opens Shopify's test checkout; no order is needed for this milestone.

The shared sample catalog intentionally disables checkout. Once linked to your store, the cart enables Shopify checkout and the footer updates accordingly.

For a protected Oxygen preview, set `OXYGEN_AUTH_BYPASS_TOKEN` privately. When deploying in CI, this command reads `authBypassToken` from the deployment log without printing it or putting it in shell history:

```bash
node --input-type=module <<'NODE'
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const {url, authBypassToken} = JSON.parse(readFileSync('h2_deploy_log.json', 'utf8'));
if (!url || !authBypassToken) throw new Error('Deploy with --auth-bypass-token first.');
const result = spawnSync(process.execPath, ['scripts/check-deployment.mjs', url], {
  stdio: 'inherit',
  env: {...process.env, OXYGEN_AUTH_BYPASS_TOKEN: authBypassToken},
});
process.exitCode = result.status ?? 1;
NODE
```

Tokens work only with the exact Oxygen deployment URL from the log, not custom domains. They expire after two hours by default; use `--auth-bypass-token-duration=HOURS` when deploying to select 1–12 hours. Generate a fresh deployment/token when one expires. The check sends the `oxygen-auth-bypass-token` header only to the storefront origin, also validates JavaScript and CSS under `https://cdn.shopify.com/oxygen-v2/` without the token, follows no redirects, and redacts the token from errors. [Shopify's authenticated testing guide](https://shopify.dev/docs/storefronts/headless/hydrogen/debugging/end-to-end-testing)

If the token is already configured privately in the environment, or the deployment is unprotected, run:

```bash
npm run test:deployment -- https://exact-deployment-url.myshopify.dev
```

The script checks initial English HTML, CSS/JavaScript assets, a published available product among the first eight catalog items, product search, empty search, and a fresh empty cart. It does not mutate carts or visit checkout. An optional second argument selects a known matching product-search term.

`npm run test:smoke` is deliberately restricted to Shopify's shared sample catalog. It performs isolated cart mutations and is the CI regression check, not a test to point at a live merchant store.

## Localization checkpoint

Keep a successful English Oxygen deployment and its commit before running Locadex. Later localization must update the English-only smoke assertions and verify translated initial HTML, locale switching, variants, search, and cart persistence on Oxygen.
