# Validation scope

This record distinguishes checks against the actual application from the Shopify AI Toolkit's isolated snippet validator. No application source was changed during this review.

## Checks against the current project

- `./node_modules/.bin/tsc --noEmit --incremental false` passed after the final locale URL and locale-switcher changes. This checks the real project imports, generated route types, and TypeScript configuration.
- `npm test` passed both existing tests: HTML/React Router `.data` URL locale detection, and locale-path preservation of variant/search parameters and fragments.
- `./node_modules/.bin/gt validate` passed all 79 marked translation entries.
- Read-only review confirmed that server locale resolution uses each request URL, `getTranslationsSnapshot(locale)` is awaited in the root loader, and `GTProvider` receives that request's locale and snapshot. Module-scope GT initialization uses bundled locale files, while the package side-effect allowlist preserves the initializer in production builds.
- The locale switcher's ordinary click handler reads `window.location` when clicked, preserving variant parameters inserted by Hydrogen through `history.replaceState` before navigating to the other locale.

These checks cover source types, extraction syntax, and the targeted language boundary. They are not an Oxygen deployment, a translation quality certification, or proof of a GT API/Locadex-generated translation workflow. Production preview/browser checks are separate evidence.

## Shopify AI Toolkit limitation

The bundled official `shopify-hydrogen` skill is version 1.16.0. Its documentation search returned the Hydrogen Money component documentation for API version `2026-04`:

[Shopify Hydrogen Money documentation](https://shopify.dev/docs/api/hydrogen/2026-04/components/money)

The first two isolated validator attempts against `app/root.tsx` were reported as failing with:

> Function expression, which lacks return-type annotation, implicitly has an any return type.

Adding an explicit boolean return type to `shouldRevalidate` did not resolve that isolated-validator diagnostic. The actual application TypeScript check passes. The helper constructs its own virtual TypeScript environment under the skill package, uses NodeJs module resolution, and does not load this application's tsconfig, path aliases, or generated route configuration. Its diagnostic was therefore not treated as evidence that the application fails its own typecheck.

For the third and final toolkit invocation, the validator received the actual unmodified `app/components/ProductPrice.tsx` rather than the root route. The invocation used API version `2026-04`, artifact `gt-shopify-product-price-20260924`, revision 1; this is a distinct component artifact from the root-route attempts.

The helper returned `success: true`, but its result explicitly said:

> No components found to validate by TypeScript.

It returned `validatedComponents: []` and listed `Money` among `unvalidatedComponents`. This was **not a meaningful Hydrogen component validation pass**. No further toolkit attempts were made. The passing project TypeScript check is the meaningful type-safety result for the real Money component and the rest of the application.

`OPT_OUT_INSTRUMENTATION=true` was set for the toolkit documentation search, validator invocation, and feedback helper. Toolkit instrumentation was disabled; no code, user prompt, or feedback telemetry was submitted through that instrumentation. The documentation search still requested the specified public Shopify documentation.

## Production and browser verification

The final application passes `npm run typecheck`, `npm test` (2 tests), `npm run i18n:validate` (79 entries), and `npm run build`. The production build was served by Shopify MiniOxygen at port 3101 using the worker runtime.

The HTTP smoke suite passes 17 checks. It verifies translated English/French/Japanese markup before any script, `.data` language consistency, invalid locales, redirect guards, and an isolated real Shopify sample cart's add/update/remove flow. Run `npm run test:smoke` against the production preview to reproduce these checks.

Browser checks confirmed hydrated language switching, preservation of product variant query parameters, cart persistence and quantity updates across languages, predictive and full search, and Japanese layout at a 360-pixel viewport without horizontal overflow. The production tab reported no console warnings or errors during this check.

`npm run lint` finishes with zero errors and two React array-index-key warnings in the cart error lists. The official starter's Vite/Rolldown bundle-analysis plugin cannot produce its optional analysis report; client and server builds complete and the resulting app runs in MiniOxygen. These warnings are not counted as test failures or silently claimed to be fixed.

No remote Oxygen deployment, merchant-specific Markets configuration, live GT translation request, or credentialed Locadex run was performed.
