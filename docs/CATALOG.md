# Translate the Shopify catalog locally with GT

This workflow belongs to the original `kevinwu98/gt-shopify` POC. The separate
`gt-shopify-public` starter is unchanged.

Shopify supplies the English catalog and live commerce data. A local script
exports product titles, plain-text descriptions, and option labels; GT translates
that text into French and Japanese. The storefront renders the resulting
dictionaries through `gt-react` during server rendering and in the browser.

Prices use `gt-react`'s `Currency` component. It preserves Shopify's amount and
currency code while formatting separators, decimal places, and currency labels
for the active language. For example, USD 1234.56 appears as `$1,234.56` in
English and `1 234,56 $US` in French. Selecting Japanese does not convert USD
to yen. Shopify Markets must supply a different currency if conversion is wanted.

## 1. Open the original POC

```sh
cd /Users/kevinwu/Documents/gt-shopify
git switch codex/catalog-localization
npm ci
```

Keep the existing `.env`: it links this checkout to GT Supply Demo. Do not replace
it with `.env.example`, which points at Shopify's separate public sample store.

## 2. Create your GT API key

Open the [GT API Keys page](https://dash.generaltranslation.com/api-keys) and
create a key with access to the existing
[Demos / gt-shopify project](https://dash.generaltranslation.com/en-US/project/prj_l3zra1ucz2hgr1esdfq0tlxi).

Create the local credentials file without overwriting an existing one:

```sh
test -f .env.catalog || cp .env.catalog.example .env.catalog
```

Open `.env.catalog` in your editor and fill in `GT_API_KEY`. The project ID is
already in the example. This file is ignored by Git. Keep the key in this file,
not in application code, the browser, a commit, or a chat message.

## 3. Export the English product content

```sh
npm run catalog:sync
npm run catalog:status
```

Sync uses the Storefront credentials in `.env` to read products published to this
storefront. It does not change Shopify. The command exports `catalog/en.json`
and records the source store in `catalog/manifest.json`.

Keys are based on Shopify product IDs and canonical option names/values. Prices,
inventory, handles, variant IDs, and cart payloads are not translation input.

When English content changes, sync removes its outdated target entries. If the
storefront encounters a new or changed source string before a new translation
is available, it displays Shopify's current English text.

## 4. Generate the French and Japanese catalog translations

```sh
npm run catalog:translate
npm run catalog:check
```

The translation command reads `.env.catalog` and sends the exported product text
to the GT translation service using `generaltranslation`'s `GT.translateMany`.
This is the step that uses your GT translation quota. It writes successful
results to `catalog/fr.json` and `catalog/ja.json`; it does not translate content
on shoppers' page requests. Re-running processes missing entries.

Review the generated JSON, particularly product/model names and option labels.
An unchanged brand name can be correct. The coverage check verifies that entries
exist; it does not judge linguistic quality. Resolve any missing entries before
presenting the fully translated catalog.

## 5. Preview the storefront

```sh
npm run dev -- --port 3130
```

Open [the original POC preview](http://localhost:3130/) and use the English,
Français, and 日本語 selector. Restart an already-running dev server if it does
not pick up the generated JSON.

Check the same product on the home/collection page, product detail, search
results, and cart. Compare names, description, option labels, price, compare-at
price, and subtotal. Choose a variant, switch language, and confirm the same
variant and cart quantities remain selected.

English descriptions keep their original HTML. When a translated description
is present, the demo displays its plain text safely. This version does not
preserve rich description formatting in translated languages.

## 6. Validate and publish when ready

```sh
npm run catalog:check
npm run lint
npm run typecheck
npm test
npm run build
npm run preview:built
```

In another terminal, validate the built preview's initial HTML:

```sh
CHECK_LOCALIZATION=1 CHECK_CATALOG=1 npm run test:deployment -- http://localhost:3101
```

Review `git diff`, then commit the application changes and generated catalog files.
Keep `.env` and `.env.catalog` out of Git. Pushing this repository invokes its
existing Oxygen deployment workflow. Review the preview before merging to `main`.
Only public product translations ship with the storefront; the GT API key is
not required in Oxygen for this workflow.

For subsequent product edits, repeat sync → translate → check → review → deploy.
This is a manual refresh workflow, not a Shopify webhook connector.

## Scope and implementation

- `scripts/catalog.mjs`: catalog export, batch GT translation, coverage checks.
- `catalog/{en,fr,ja}.json`: plain-text source and translated product dictionaries.
- `app/lib/catalog.server.ts`: dictionaries in the server response and localized
  product-page metadata. These dictionaries are separate from GT's hash-keyed UI
  translation files under `public/_gt`.
- `app/lib/useCatalog.ts`: guarded `gt-react` dictionary lookups by product ID.
- `app/components/LocalizedMoney.tsx`: GT formatting of Shopify currency amounts.

The existing Locadex automations continue handling UI copy. This local catalog
script is the added integration; it does not require repeating Locadex setup.

The workflow translates displayed search-result labels, not Shopify's search
index. It does not write translations into Shopify Admin or localize Shopify's
hosted checkout. Those require a separate GT-to-Shopify translation sync and
Shopify language/market configuration.

References: [GT batch translation](https://generaltranslation.com/docs/platform/core/reference/gt-class-methods/translation/translate-many),
[GT dictionaries](https://generaltranslation.com/docs/react/guides/translating-with-dictionaries),
[GT currency formatting](https://generaltranslation.com/docs/react/reference/components/currency).
