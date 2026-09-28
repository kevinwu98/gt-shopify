# Locadex workflow for GT Supply

Locadex is set up through the GT dashboard. See the [Locadex quickstart](https://generaltranslation.com/docs/platform/locadex/quickstart) for the setup flow.

## Project and implementation

The GT project is connected to `kevinwu98/gt-shopify` on GitHub. [Setup PR #2](https://github.com/kevinwu98/gt-shopify/pull/2) merged as `f91b4d2`, adding the `gt-react` integration. [Code-generation PR #3](https://github.com/kevinwu98/gt-shopify/pull/3) internationalized the interface copy and added French and Japanese translations. [PR #6](https://github.com/kevinwu98/gt-shopify/pull/6) added Korean and Indonesian.

The known working English baseline is commit [`f77447c`](https://github.com/kevinwu98/gt-shopify/commit/f77447c). See [OXYGEN.md](OXYGEN.md) for the deployment, environment variables, and checks.

| Setting | Value |
| --- | --- |
| Repository | `kevinwu98/gt-shopify` |
| Target branch | `main` |
| App root | `.` |
| Framework | React Router |
| Package manager | npm |
| Source locale | English (`en`) |
| Target locales | French (`fr`), Japanese (`ja`), Korean (`ko`), Indonesian (`id`) |
| Runtime | Hydrogen 2026.4.5, React Router 7.16.0, React 18, Oxygen |

| Automation | Trigger |
| --- | --- |
| Generate code | Pull request changes targeting `main` |
| Generate translations and push | Commits to `main` |
| Keep locales in sync | Manual |

All three target root `.`, use React Router and branch prefix `codex/locadex/`, preserve local edits, and have auto-merge disabled. Code and translation automations use changed-file filtering; locale synchronization does not.

Locadex handles interface copy authored in this repository: navigation, home-page copy, buttons, cart/search states, and accessibility labels. The separate [catalog workflow](CATALOG.md) exports product names, plain descriptions, and option labels for GT translation, and renders them through `gt-react` dictionaries. GT's `Currency` component formats Shopify's amounts. Shopify owns live commerce data, search indexing, checkout, and market configuration. Each language is paired with one Shopify market, so changing language also changes the shopping country and its currency; see the [README](../README.md#how-language-and-market-work).

## Ongoing workflow

1. Add or change English interface copy in a feature PR. **Generate code** internationalizes the changed files; review its GT markup and dynamic-value boundaries.
2. After merging source changes, **Generate translations and push** updates the translation files for every target language. Review the generated PR and run the checks below before merging.
3. If project languages change, run **Keep locales in sync** manually. Update the language-to-market pairing in `app/lib/locale-market.ts` and the verification coverage when adding or removing supported locales.

All three automations run this postprocess command to keep the lockfile compatible with normal `npm ci`, including peer dependencies omitted by a legacy-peer-deps install:

```bash
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
```

To reproduce the setup in another project, connect GitHub under **Integrations → Catalog**, create **Generate code** with the settings above, and run **Run setup**. Review and merge its setup PR before running the automations.

## Review the Hydrogen integration

Preserve these properties when reviewing generated changes:

- **Correct framework:** This is React Router, not Next.js or an older Remix application. Preserve `hydrogenRoutes`, the Hydrogen React Router preset, and the worker `fetch` entry.
- **Server rendering:** Translated interface copy must be present in the initial HTML, with the matching `<html lang>`, and hydrate without changing languages on the client.
- **Locale changes:** The selector posts to `/market`, which changes the Shopify market and the existing cart before saving the `generaltranslation.locale` cookie, then reloads the current URL. The server resolves that cookie before `Accept-Language`, falling back to English. URLs remain unprefixed, preserving product-option and search query parameters. If switching later uses client navigation instead of a reload, make sure root-loader revalidation refreshes the locale and translations.
- **CSP and runtime:** Preserve Hydrogen's streaming renderer and nonce providers. Any additional inline scripts must receive the nonce. Check any translation-network requests against the CSP and Oxygen runtime; keep private credentials out of browser bundles and Git.
- **Commerce state:** Keep the cart and session cookies shared across languages. Verify adding, changing quantities, removing, reload persistence, and checkout handoff after language switches. Do not translate product handles, variant IDs, GraphQL field names, or cart action values.
- **Translation delivery:** `public/_gt/[locale].json` UI translations are bundled through `app/loadTranslations.ts`. Product dictionaries under `catalog/` are separate and passed through the provider's `dictionaries` prop. Keep server and client locale configuration aligned, and verify actual translated copy rather than only locale metadata. Catalog labels must remain literal strings, and original Shopify option values must remain in purchase requests.

## Validate locally and on Oxygen

After reviewing generated changes, run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run preview:built
```

In another terminal, run the deployment checks against the preview:

```bash
npm run test:deployment -- http://localhost:3101
CHECK_LOCALIZATION=1 npm run test:deployment -- http://localhost:3101
```

Run `npm run test:smoke` against a preview configured with `.env.example`'s public Shopify sample catalog. Its cart mutations deliberately refuse other stores. GitHub CI uses that sample configuration; preserve any existing `.env` containing linked-store credentials.

The deployment checker makes only GET requests. Its default groups cover English server rendering and CSP, assets, catalog, product, search, empty search, and empty cart. `CHECK_LOCALIZATION=1` expands these checks to translated HTML and selector state for every configured language, translated UI copy, expected catalog titles, cookie precedence, and isolation between repeated requests. Use `CHECK_CATALOG=1` after the catalog translation step to require translated catalog coverage for the tested product.

On the Oxygen preview, verify initial HTML in every language, language switching, product options, predictive and full search, and cart persistence. The development-store deployment requires a Shopify login in the browser. The read-only deployment checker also supports a private authentication bypass token for its exact deployment URL; see [OXYGEN.md](OXYGEN.md).

A successful run covers this React Router Hydrogen version; it does not establish compatibility with every Hydrogen or Remix release.
