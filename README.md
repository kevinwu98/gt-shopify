# GT Supply — Hydrogen localization demo

A Shopify Hydrogen storefront on Oxygen with a GT dashboard and Locadex localization workflow. It uses Hydrogen 2026.4.5, React Router 7.16.0, React 18, and `gt-react`. English is the source language; French, Japanese, Korean, and Indonesian are the target languages in `gt.config.json`. GT handles interface copy, exported catalog text, and price formatting, while Shopify supplies live products, variants, amounts, currencies, search, cart, and checkout.

Follow [the local catalog translation walkthrough](docs/CATALOG.md) to export the linked store's product text, translate it with your GT API key, and preview translated product names, descriptions, options, and locale-formatted prices. Translation generation is a separate manual step; missing catalog translations fall back to English.

The [Demos / gt-shopify GT project](https://dash.generaltranslation.com/en-US/project/prj_l3zra1ucz2hgr1esdfq0tlxi) is connected to GitHub with three localization automations. [Setup PR #2](https://github.com/kevinwu98/gt-shopify/pull/2) merged as `f91b4d2`. [Code-generation PR #3](https://github.com/kevinwu98/gt-shopify/pull/3) contains internationalized copy and French/Japanese catalogs covering 148 entries. Its local runtime passed nine unit tests, 17 smoke checks, and 12 localized deployment-check groups. See [docs/LOCADEX.md](docs/LOCADEX.md) for the ongoing workflow.

## Run locally

Use a current Node.js 22 or 24 release (Node 24 recommended) and npm.

```bash
npm ci
test -f .env || cp .env.example .env
npm run dev -- --port 3100
```

Open [http://localhost:3100](http://localhost:3100).

For a new checkout, `.env.example` connects to Shopify's public `hydrogen-preview.myshopify.com` demo catalog using the public Storefront token published in [Shopify's demo-store repository](https://github.com/Shopify/hydrogen-demo-store/blob/main/.env). The command above preserves an existing `.env`, including credentials pulled from the linked store. Products, images, variants, prices, search, and cart operations come from Shopify's Storefront API. The store defaults to the US market and preserves existing signed market preferences; there is no visible country/currency selector. Internet access is required; the included session secret is for local development.

Browse the catalog, select a product variant, search for products, and add/update/remove cart items. **Checkout is disabled for the shared public sample store.** The deployed GT Supply Demo store has a working Shopify test-checkout handoff. Customer accounts are outside this demo's scope.

## Build and check

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run preview:built
```

The production preview runs at [http://localhost:3101](http://localhost:3101). In a second terminal:

```bash
npm run test:smoke
CHECK_LOCALIZATION=1 npm run test:deployment -- http://localhost:3101
```

The smoke script uses Node built-ins and needs no browser installation. It checks the storefront and exercises a sample cart without checking out; cart mutations are restricted to Shopify's demo store. Use `SMOKE_BASE_URL=http://localhost:3100 npm run test:smoke` to target the development server instead. `npm run preview` rebuilds before starting a preview server.

The suite includes catalog sync, dictionary rendering, currency, search, and deployment regression tests, plus 17 commerce/locale smoke checks. The read-only deployment checker runs seven default-English groups; `CHECK_LOCALIZATION=1` adds translated initial HTML, language controls, search/cart empty states, expected catalog titles, cookie preference, and request isolation. Add `CHECK_CATALOG=1` after generating the catalog translations to require catalog translation coverage for the tested product. For protected Oxygen previews, provide a private `OXYGEN_AUTH_BYPASS_TOKEN` for the exact deployment URL; see [docs/OXYGEN.md](docs/OXYGEN.md). Do not commit or log the token.

GitHub Actions runs lint, typechecking, regression tests, the production build, and both smoke suites against Shopify's public sample catalog, with `CHECK_LOCALIZATION=1` enabled for the deployment checker. Vite is pinned to 7.3.6, which is supported by this Hydrogen release and produces the bundle-analysis artifacts expected by the pinned Shopify CLI.

Browser automation can modify the favicon and document before React hydrates. The developer console confirms a `data-codex-favicon-badge` mismatch in controlled Chrome tabs, followed by hydration recovery. The application contains no automation-specific workaround. Verify the final preview in a normal browser tab as well as with the HTTP checks.

## Oxygen deployment

Open [GT Supply Demo on Oxygen](https://gt-supply-demo-d4eecb57c0a4e7a633e0.o2.myshopify.dev/). GitHub deploys repository changes automatically. This development store requires store login; the URL is not a public demo. The verified English checkpoint before localization is [`f77447c`](https://github.com/kevinwu98/gt-shopify/commit/f77447c).

See [docs/OXYGEN.md](docs/OXYGEN.md) for the development-store setup, GitHub connection, environment configuration, and deployment checks. Product browsing, variants, search, cart changes, reload persistence, and Shopify test-checkout handoff have been verified. No order was placed.

## Work with Locadex

The existing project targets `kevinwu98/gt-shopify`, directory `.`, framework **React Router**, and locales `en`, `fr`, `ja`, `ko`, and `id`. Generate code runs on PR changes; Generate translations and push runs on commits to `main`; Keep locales in sync runs manually. Auto-merge is disabled. Review generated PRs and run the checks above before merging.

The language selector changes GT's language and Shopify's shopping country together: English → US, French → France, Indonesian → Indonesia, Japanese → Japan, Korean → South Korea. Shopify determines each country's prices and currency. The server checks market availability and updates any existing cart before saving both preferences, then reloads the current URL. A failed switch keeps the current language and market and displays an inline error. URLs stay unchanged; no separate currency selector is needed.

Before changing a populated cart, the app checks that its items are purchasable in the target market. If any are unavailable, the switch is blocked with a message and the cart is retained. The linked demo currently exposes the local currencies, but its products still need Shopify configuration to become purchasable in the international markets.

Server rendering uses the GT locale cookie, then `Accept-Language`, then English. A new visitor's shopping country defaults to US until they use the selector; browser language detection alone does not change the country. The catalog query language remains English for GT's translated display dictionaries. Locadex handles authored interface copy; the [catalog workflow](docs/CATALOG.md) adds GT-generated catalog dictionaries and GT currency formatting. Shopify controls market pricing and currency conversion. The [Locadex guide](docs/LOCADEX.md) covers integration constraints, automation settings, and an optional internal wrapper.

This is a technical demonstration, not a merchant customer reference. Completing the localization proof requires passing the localized Oxygen checks and browser commerce flow.
