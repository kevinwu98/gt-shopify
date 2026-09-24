# Translation workflow and provenance

This proof of concept uses the published `gt-react` runtime and GT CLI. Source JSX is marked with `<T>` and authored string values with `useGT()`. `gt generate` extracts those source strings and computes the real runtime lookup hashes; the application does not inject synthetic hash props.

The bundled French and Japanese values are manually seeded proof-of-concept translations authored by the coding agent. They were not produced by the GT translation API or by an automated Locadex run, and they have not undergone professional linguistic review. This demo proves the extraction and runtime integration separately from those services.

## Regenerating local files

Run `npx gt generate` from the project root. `gt.config.json` scans `app/**/*.{ts,tsx}` and writes `app/translations/en.json`, `fr.json`, and `ja.json`.

The source file contains a flat mapping of generated content hashes to source strings or serialized JSX. Target files preserve existing translated values, add English source values for newly discovered entries, and remove obsolete keys. After changing source copy, translate the newly generated target values. Keep the hash keys and JSX structural identifiers intact; elements and variables may be reordered to suit the language.

After editing locale JSON, restart the development server to clear the GT translation cache, or rebuild the production preview.

Run `npx gt validate` to check the marked source content. This validates extraction syntax, not translation quality.

## Request and runtime integration

`app/lib/gt.ts` calls `initializeGT()` once at module scope and statically imports the French and Japanese JSON. Its translation loader reads those bundled objects; initialization does not perform translation network requests.

The root route resolves the request locale and obtains `getTranslationsSnapshot(locale)`. `GTProvider` receives that locale and snapshot for server rendering and client hydration. The locale remains request-specific; only configuration and immutable bundled translations are shared.

This covers storefront text authored in this application's code. Shopify-owned product data, prices, currencies, inventory, checkout, and merchant policies remain Shopify's responsibility. Merely selecting French or Japanese here does not create translations of product data in the connected store.

## Connecting GT's translation service

For API-generated translations, configure a GT project and provide `GT_PROJECT_ID` and `GT_API_KEY` to the GT CLI in the development/CI environment, then run `npx gt translate`. Keep the API key out of browser code and version control. The application can continue bundling the resulting translation JSON. This proof of concept has not used those credentials or claimed service-generated translations.

## Current local translation check

The completed storefront extraction contains 79 entries. `gt validate` succeeds for all 79. Both target files have exactly the source file's keys and preserve all serialized JSX element and variable identifiers. Japanese search messages reorder the query element to fit Japanese grammar. The French words “Menu”, “Pages”, “Collections”, and “Description” intentionally match their English spelling.

The localized scope is the home page, navigation, product and collection browsing, cart, search, related loading/error states, and accessibility labels. Untouched starter account, order, address, blog, and policy interfaces are not claimed as fully localized.
