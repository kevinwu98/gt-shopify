# GT Supply — English Hydrogen storefront

A Shopify Hydrogen sample storefront prepared as an **English-only starting point for running Locadex**. It uses Hydrogen 2026.4.5, React Router 7.16.0, and React 18. The application has no GT SDK integration, translation wrappers, GT configuration, translation files, or language routing.

The source contains ordinary English interface copy across the home page, navigation, product and collection browsing, search, cart, loading/error states, and accessibility labels. Locadex can configure and internationalize that code when you run it.

## Run locally

Use a current Node.js 22 or 24 release (Node 24 recommended) and npm.

```bash
npm ci
cp .env.example .env
npm run dev -- --port 3100
```

Open [http://localhost:3100](http://localhost:3100).

`.env.example` connects to Shopify's public `hydrogen-preview.myshopify.com` demo catalog using the public Storefront token published in [Shopify's demo-store repository](https://github.com/Shopify/hydrogen-demo-store/blob/main/.env). Products, images, variants, prices, search, and cart operations come from Shopify's Storefront API. The store uses the US market. Internet access is required; the included session secret is for local development.

Browse the catalog, select a product variant, search for products, and add/update/remove cart items. **Checkout is disabled** for this sample store. Customer accounts are outside this demo's scope.

## Build and check

```bash
npm run typecheck
npm run build
npm run preview:built
```

The production preview runs at [http://localhost:3101](http://localhost:3101). In a second terminal:

```bash
npm run test:smoke
```

The smoke script uses Node built-ins and needs no browser installation. It checks the storefront and exercises a sample cart without checking out; cart mutations are restricted to Shopify's demo store. Use `SMOKE_BASE_URL=http://localhost:3100 npm run test:smoke` to target the development server instead. `npm run preview` rebuilds before starting a preview server.

The English-only baseline passes typechecking, the production build, and all 14 smoke checks. During browser automation, Codex-injected overlay elements outside the app document triggered React 18 hydration warnings; the interactive storefront recovered. No browser-tool-specific workaround is included in the application.

## Run Locadex yourself

The optional wrapper uses an existing internal Locadex core checkout and credentials in the ignored `.env.locadex` file. **Provider credentials are not configured and no actual Locadex run has been performed.**

After configuring it as described in [docs/LOCADEX.md](docs/LOCADEX.md):

```bash
npm run locadex:check
npm run locadex:setup
npm run locadex:i18n
```

Run setup first: this baseline has raw English source and no GT integration. Setup prepares the application; the separate i18n step marks its interface copy. Shopify-owned product content remains distinct from strings authored in this codebase.

This is a local storefront baseline for a technical demonstration, not a merchant customer reference or a completed localization proof. It has not been deployed to Oxygen.
