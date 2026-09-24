# GT Supply — Hydrogen localization proof of concept

A working Shopify Hydrogen storefront with `gt-react` for code-authored UI, rendered on the server and hydrated in the browser. This project uses **Hydrogen 2026.4.5, React Router 7.16.0, React 18, and gt-react 11.4.3**. It is a current React Router 7 integration, not a test of an older Remix 2 Hydrogen release.

The original, unlocalized Shopify skeleton is retained in Git as **`40af3da`**. The proof of concept adds a storefront presentation, locale routing, bundled translations, and integration checks.

## Run locally

Use a current Node.js 22 or 24 release (Node 24 recommended) and npm.

```bash
npm ci
cp .env.example .env
npm run dev -- --port 3100
```

Open [English](http://localhost:3100/), [French](http://localhost:3100/fr), or [Japanese](http://localhost:3100/ja). The language links retain the current route and query string, including product selections and search terms.

`.env.example` points to Shopify's public `hydrogen-preview.myshopify.com` demo catalog. Its public Storefront token is published in [Shopify's demo-store repository](https://github.com/Shopify/hydrogen-demo-store/blob/main/.env). Product browsing, images, variants, prices, search, and cart operations use Shopify's Storefront API; internet access to that sample store is required. This is not a merchant's production store. The included session secret is for local development only.

## What this demonstrates

- English, French, and Japanese storefront UI, including navigation, home, product and collection browsing, cart, search, loading/error messages, and accessibility labels.
- Request-specific locale selection, server-loaded translation snapshots, and `GTProvider` hydration using bundled JSON. No GT API key is needed to view this demo.
- Locale-aware product links, search requests, cart actions, and language switching.
- Shopify catalog content stays in Shopify. GT translates the interface authored in this repository, not product titles or descriptions returned by the Storefront API. A French or Japanese UI does not imply that Shopify's sample catalog contains matching product translations.
- All three languages retain the **US market**. Language selection does not switch country, currency, pricing, or inventory; the sample store's US currency is retained.

Checkout is disabled in the sample storefront. Customer accounts and the starter account, order, address, blog, and policy interfaces are outside the localized demo scope. This project has not been deployed to Oxygen or connected to GT's live translation service.

## Demo for Shopify

1. Open `/fr` directly to show translated HTML on the first render.
2. Open a product, choose a variant, then switch to Japanese. The product and selected options stay the same while the interface changes language.
3. Add an item, change its quantity, and switch languages again. The cart persists; Shopify still supplies prices and catalog content.
4. Search for `snowboard` to show localized search controls around Shopify results. Use the new-copy workflow in `docs/LOCADEX.md` for the separate agent demonstration once credentials are configured.

This is a local technical proof of concept. It is not an existing merchant customer reference. See [validation results and limits](docs/VALIDATION.md).

## Build and verify

```bash
npm run typecheck
npm test
npm run i18n:validate
npm run build
npm run preview:built
```

`preview:built` serves the existing production build at [http://localhost:3101](http://localhost:3101). In a second terminal, run:

```bash
npm run test:smoke
```

The smoke script uses Node built-ins, so no browser installation is required. It checks HTTP/server-rendered behavior and exercises an isolated sample cart's add/update/remove flow without checking out. It refuses cart mutations unless both local configuration and runtime data identify Shopify's demo store. To target a different local port, use `SMOKE_BASE_URL=http://localhost:3100 npm run test:smoke`.

`npm run preview` is also available and rebuilds before starting the preview server. The locale unit tests exercise request/data URL detection and locale-preserving links. These checks do not replace browser hydration checks or testing a merchant's own catalog, configuration, and deployment.

## Translation and automation provenance

The GT CLI generates real lookup hashes from `<T>` and `useGT()` content. The checked-in French and Japanese translations were manually seeded for this proof of concept. They are **not** evidence of an automated Locadex run or GT API translation, and have not had professional linguistic review.

```bash
npm run i18n:extract
npm run i18n:validate
```

Extraction preserves existing target translations and inserts source-language values for new entries; review and translate those entries before presenting them as localized. See [translation details](docs/TRANSLATIONS.md).

A local wrapper is prepared for running the actual internal Locadex implementation, but **Locadex has not run because provider credentials are not configured**. See [Locadex setup and a reproducible new-copy demonstration](docs/LOCADEX.md). GT translation service credentials and Locadex model-provider credentials are separate.
