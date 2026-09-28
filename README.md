# GT Supply — Hydrogen localization demo

A Shopify Hydrogen storefront localized with [General Translation](https://generaltranslation.com) (GT). It runs Hydrogen 2026.4.5 on React Router 7.16.0 and React 18, deploys to Oxygen, and uses `gt-react` with Locadex, GT's localization agent. English is the source language; French, Japanese, Korean, and Indonesian are the target languages in `gt.config.json`.

GT handles the storefront's own code: interface copy, accessibility labels, and locale-aware price formatting. Shopify supplies products, variants, prices, currencies, search, cart, and checkout.

## What to look at

### Locadex pull requests

Locadex is connected to this repository and opened these pull requests:

| PR | What Locadex did |
| --- | --- |
| [#2](https://github.com/kevinwu98/gt-shopify/pull/2) | Set up `gt-react`: provider, configuration, and translation loading |
| [#3](https://github.com/kevinwu98/gt-shopify/pull/3) | Internationalized the storefront's interface copy and added French and Japanese translations |
| [#6](https://github.com/kevinwu98/gt-shopify/pull/6) | Added Korean and Indonesian when the project's languages changed |
| [#15](https://github.com/kevinwu98/gt-shopify/pull/15) | Internationalized new copy introduced by a feature pull request |
| [#4](https://github.com/kevinwu98/gt-shopify/pull/4), [#9](https://github.com/kevinwu98/gt-shopify/pull/9), [#13](https://github.com/kevinwu98/gt-shopify/pull/13) | Updated translations after changes merged to `main` |

Setup needed two manual follow-ups. [`099ff81`](https://github.com/kevinwu98/gt-shopify/commit/099ff81) moved `GTProvider` into the document `Layout`, so `<html lang>` and error pages are localized. [`9b31b79`](https://github.com/kevinwu98/gt-shopify/commit/9b31b79) normalized the generated lockfile so `npm ci` passes; the automations now run a lockfile step for this (see [docs/LOCADEX.md](docs/LOCADEX.md)).

### GT integration in the code

| Area | Files |
| --- | --- |
| Setup and server rendering | `gt.config.json`; `app/root.tsx` initializes GT, loads the active locale's translations in the root loader, and wraps the document in `GTProvider`; `app/loadTranslations.ts` |
| Generated translations | `public/_gt/[locale].json` |
| Interface copy | `<T>` and `gt()` across `app/components/` and `app/routes/` |
| Prices | `app/components/LocalizedMoney.tsx`: GT's `<Currency>` formats Shopify's amount and currency code for the active language. It never converts currency. |
| Language and market | `app/components/LocaleSwitcher.tsx`, `app/routes/market.tsx`, `app/lib/markets.server.ts`, `app/lib/locale-market.ts` |

### Catalog text is demo scaffolding

Product names, descriptions, and option labels are translated by a separate script, `scripts/catalog.mjs`. It exports them from Shopify, translates them with GT's API, and bundles the results under `catalog/`, rendered through `app/lib/useCatalog.ts`. The script stands in for Shopify's native translations, which a production storefront would use for merchant content. Locadex does not run it. See [docs/CATALOG.md](docs/CATALOG.md).

## How language and market work

The language selector changes GT's language and Shopify's shopping country together: English → US, French → France, Indonesian → Indonesia, Japanese → Japan, Korean → South Korea. Shopify determines each country's prices and currency; GT only formats them.

The selector posts to `/market`. Before saving either preference, the server checks that the country is available and that any items in the cart can be bought there, then updates the cart's buyer identity. If an item is unavailable, the switch is blocked with a message and the cart is kept. After a successful switch, the current URL reloads. URLs are not locale-prefixed.

Server rendering reads the GT locale cookie, then `Accept-Language`, then falls back to English. New visitors shop in the US market until they use the selector; browser language alone does not change the country. Catalog queries to Shopify stay in English because product text comes from the bundled catalog translations.

## Run locally

Use a current Node.js 22 or 24 release (Node 24 recommended) and npm.

```bash
npm ci
test -f .env || cp .env.example .env
npm run dev -- --port 3100
```

Open [http://localhost:3100](http://localhost:3100).

For a new checkout, `.env.example` connects to Shopify's public `hydrogen-preview.myshopify.com` demo catalog using the public Storefront token published in [Shopify's demo-store repository](https://github.com/Shopify/hydrogen-demo-store/blob/main/.env). The command above preserves an existing `.env`. Products, images, variants, prices, search, and cart operations come from Shopify's Storefront API. Internet access is required; the included session secret is for local development.

Browse the catalog, switch languages, select a product variant, search, and add, update, or remove cart items. **Checkout is disabled for the shared public sample store.** The bundled catalog translations belong to the linked GT Supply store, so product text on the public sample store appears in English. Customer accounts are outside this demo's scope.

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

The smoke script uses Node built-ins and needs no browser. It checks the storefront and exercises a sample cart without checking out; cart mutations are restricted to Shopify's demo store. Use `SMOKE_BASE_URL=http://localhost:3100 npm run test:smoke` to target the development server instead.

The read-only deployment checker covers English server rendering, assets, catalog, product, search, and cart pages. `CHECK_LOCALIZATION=1` adds translated initial HTML for every configured language, language controls, translated search and cart states, cookie precedence, and isolation between concurrent requests. For protected Oxygen previews, see [docs/OXYGEN.md](docs/OXYGEN.md).

GitHub Actions runs lint, typechecking, regression tests, the production build, and both smoke suites against Shopify's public sample catalog.

## Oxygen deployment

The storefront is deployed to Oxygen from GitHub on every change to `main`. The deployment uses a development store, so it requires a store login and is not a public demo. Product browsing, variants, search, cart changes, reload persistence, and Shopify test-checkout handoff have been verified there; no order was placed. See [docs/OXYGEN.md](docs/OXYGEN.md).

## Locadex workflow

Three Locadex automations run on this repository. **Generate code** internationalizes new copy in pull requests. **Generate translations and push** updates translations after commits to `main`. **Keep locales in sync** runs manually when the language list changes. Auto-merge is disabled, so each generated pull request is reviewed and checked before merging. See [docs/LOCADEX.md](docs/LOCADEX.md).

This is a technical demonstration, not a merchant deployment.
