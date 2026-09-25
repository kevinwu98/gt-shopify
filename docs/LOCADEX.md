# Locadex workflow for GT Supply

Use the [GT dashboard project, Demos / gt-shopify](https://dash.generaltranslation.com/en-US/project/prj_l3zra1ucz2hgr1esdfq0tlxi) and the [Locadex quickstart](https://generaltranslation.com/docs/platform/locadex/quickstart) for the customer setup flow.

## Project and implementation

[GitHub is connected](https://dash.generaltranslation.com/en-US/project/prj_l3zra1ucz2hgr1esdfq0tlxi/integrations/edjqo7o28i2ikoheqn79folg) to `kevinwu98/gt-shopify`. [Setup PR #2](https://github.com/kevinwu98/gt-shopify/pull/2) merged as `f91b4d2`, adding the `gt-react` integration. [Code-generation PR #3](https://github.com/kevinwu98/gt-shopify/pull/3) contains internationalized interface copy and French/Japanese catalogs covering 148 entries. Its local runtime passed nine unit tests, 17 smoke checks, and 12 localized deployment-check groups.

The known working English baseline is commit [`f77447c`](https://github.com/kevinwu98/gt-shopify/commit/f77447c). It is already deployed to Oxygen; see [OXYGEN.md](OXYGEN.md) for the deployment, environment variables, and checks.

| Setting | Value |
| --- | --- |
| Repository | `kevinwu98/gt-shopify` |
| Target branch | `main` |
| App root | `.` |
| Framework | React Router |
| Package manager | npm |
| Source locale | English (`en`) |
| Target locales | French (`fr`), Japanese (`ja`) |
| Runtime | Hydrogen 2026.4.5, React Router 7.16.0, React 18, Oxygen |

| Active automation | Trigger | ID |
| --- | --- | --- |
| Generate code | Pull request changes targeting `main` | `lwd_4ee69cbabfe54c082e00f1fe` |
| Generate translations and push | Commits to `main` | `lwd_e2c3b65925c636c6c03c6555` |
| Keep locales in sync | Manual | `lwd_ef6734c24da08160d49def24` |

All three target root `.`, use React Router and branch prefix `codex/locadex/`, preserve local edits, and have auto-merge disabled. Code and translation automations use changed-file filtering; locale synchronization does not.

Locadex handles interface copy authored in this repository: navigation, home-page copy, buttons, cart/search states, and accessibility labels. The separate [local catalog workflow](CATALOG.md) exports product names, plain descriptions, and option labels for GT translation, renders them through `gt-react` dictionaries, and formats Shopify amounts through GT's Currency component. Shopify still owns live commerce data, search indexing, checkout, and market configuration. The baseline uses Shopify's EN/US commerce context; language selection does not change the charged currency.

## Ongoing workflow

1. Add or change English interface copy in a feature PR. **Generate code** internationalizes the changed files; review its GT markup and dynamic-value boundaries.
2. After merging source changes, **Generate translations and push** updates the French and Japanese catalogs. Review the generated PR and run the checks below before merging.
3. If project languages change, run **Keep locales in sync** manually. Update the selector and verification coverage when adding or removing supported locales.
4. Keep the automation-run, generated-PR, and Oxygen-preview links as evidence of the workflow. Verify a fresh English feature through this process after the initial integration.

All three automations run this postprocess command to keep the lockfile compatible with normal `npm ci`, including peer dependencies omitted by a legacy-peer-deps install:

```bash
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
```

The existing project does not need setup repeated. To reproduce it in another project, connect GitHub under **Integrations → Catalog**, create **Generate code** with the settings above, and run **Run setup**. Review and merge its setup PR before running the automations. See the [official quickstart](https://generaltranslation.com/docs/platform/locadex/quickstart).

## Review the Hydrogen integration

Preserve these properties when reviewing generated changes:

- **Correct framework:** This is React Router, not Next.js or an older Remix application. Preserve `hydrogenRoutes`, the Hydrogen React Router preset, and the worker `fetch` entry. The optional internal wrapper's `--framework react-router` adapter name is distinct from an SDK configuration field that may use `"react"`.
- **Server rendering:** French and Japanese interface copy must be present in initial HTML, with the matching `<html lang>`, and hydrate without changing languages on the client.
- **Locale changes:** The selector saves `generaltranslation.locale` and reloads the current URL. The server resolves that cookie before `Accept-Language`, falling back to English. URLs remain unprefixed, preserving product-option and search query parameters. If switching later uses client navigation instead of reload, ensure root-loader revalidation refreshes the locale and translations.
- **CSP and runtime:** Preserve Hydrogen's streaming renderer and nonce providers. Any additional inline scripts must receive the nonce. Verify any translation-network requests against the CSP and Oxygen runtime; keep private credentials out of browser bundles and Git.
- **Commerce state:** Keep the cart/session cookie shared across locale paths. Verify add, quantity changes, removal, reload persistence, and checkout handoff after language switches. Do not translate product handles, variant IDs, GraphQL field names, or cart action values.
- **Translation delivery:** `public/_gt/[locale].json` UI translations are bundled through `app/loadTranslations.ts`. Product dictionaries under `catalog/` are separate and passed through the provider's `dictionaries` prop. Keep server and client locale configuration aligned, and verify actual translated copy rather than only locale metadata. Catalog labels must remain literal strings and original Shopify option values must remain in purchase requests.

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

The suite has nine regression tests and 17 commerce/locale smoke checks. Run `npm run test:smoke` against a preview configured with `.env.example`'s public Shopify sample catalog. Its cart mutations deliberately refuse other stores. GitHub CI uses that sample configuration; preserve any existing `.env` containing linked-store credentials.

The deployment checker makes only GET requests. Its seven default groups cover English SSR/CSP, assets, catalog, product, search, empty search, and empty cart. `CHECK_LOCALIZATION=1` expands these checks to translated en/fr/ja HTML and selector state, translated UI copy, expected catalog titles, cookie precedence, and repeated-request isolation. Use `CHECK_CATALOG=1` after the catalog translation step to require translated catalog coverage for the tested product.

On the Oxygen preview, verify initial HTML in all three languages, language switching, product options, predictive/full search, and cart persistence. The current development-store deployment requires Shopify login in a browser. The read-only deployment checker also supports a private authentication bypass token for its exact deployment URL; see [OXYGEN.md](OXYGEN.md). Run the final browser check in a normal tab as well as an automated tab, because browser automation can modify the document before hydration.

A successful run covers this React Router Hydrogen version; it does not establish compatibility with every Hydrogen or Remix release.

## Optional internal local wrapper

The dashboard flow does not require `scripts/locadex.mjs`. The optional wrapper needs an internal `gt-cloud/packages/locadex-core` checkout with workspace dependencies installed.

Copy `.env.locadex.example` to the ignored `.env.locadex`, then configure `LOCADEX_CORE_DIR`, `LOCADEX_AGENT=openai`, and `OPENAI_API_KEY`. For Anthropic, use `LOCADEX_AGENT=anthropic` and `ANTHROPIC_API_KEY`. A desktop Codex sign-in does not replace the wrapper's provider credential. Provider credentials are separate from GT translation-service credentials.

```bash
npm run locadex:check
npm run locadex:setup
npm run locadex:i18n
```

`locadex:check` reports availability without authenticating and can exit successfully with incomplete configuration; read its status lines. Setup invokes the internal `auto` command; `i18n` marks user-facing source. Both use React Router, npm, local translations, and concurrency 1. These internal commands are separate from the public dashboard flow. The wrapper was not used for this integration.
