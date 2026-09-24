# English storefront on Oxygen

## Store and repository

Repository: https://github.com/kevinwu98/gt-shopify (private).

Create a free **Dev store** in the [Shopify Dev Dashboard](https://dev.shopify.com/dashboard), with **Generate test data for store** enabled. This is a demo store, not a live merchant shop. Install the Hydrogen sales channel and make sample products and at least one collection available to it. A collection image supplies the homepage hero.

Oxygen supports dev stores, but their deployment URLs require a store login. A paid plan with a public environment is needed for a public demo. [Shopify's supported plans](https://shopify.dev/docs/storefronts/headless/hydrogen/fundamentals#supported-plans)

In the Hydrogen channel, create a storefront named **GT Supply**, connect `kevinwu98/gt-shopify`, and select `main` as the production branch. Shopify opens a PR containing the storefront-specific Oxygen deployment workflow. Review and merge it. The existing `ci.yml` checks the app; Shopify's generated workflow deploys it. [Official GitHub setup](https://shopify.dev/docs/storefronts/headless/hydrogen/deployments/github)

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
npx shopify hydrogen deploy --preview
```

The deployment command returns the Oxygen preview URL. Open it while signed into the store. Verify home, collection, product variant selection, predictive/full search, and cart add/update/remove plus reload persistence. For the development store, verify that the checkout link opens Shopify's test checkout; no order is needed for this milestone.

The shared sample catalog intentionally disables checkout. Once linked to your store, the cart enables Shopify checkout and the footer updates accordingly.

For an unprotected deployment, run the read-only checks:

```bash
npm run test:deployment -- https://your-oxygen-url
```

The script checks initial English HTML, CSS/JavaScript assets, a published available product among the first eight catalog items, product search, empty search, and a fresh empty cart. It does not mutate carts or visit checkout. An optional second argument selects a known matching product-search term.

`npm run test:smoke` is deliberately restricted to Shopify's shared sample catalog. It performs isolated cart mutations and is the CI regression check, not a test to point at a live merchant store.

## Localization checkpoint

Keep a successful English Oxygen deployment and its commit before running Locadex. Later localization must update the English-only smoke assertions and verify translated initial HTML, locale switching, variants, search, and cart persistence on Oxygen.
