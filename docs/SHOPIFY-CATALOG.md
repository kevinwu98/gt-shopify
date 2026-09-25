# Run the GT → Shopify catalog reference connector

This local connector prepares GT translations and writes reviewed results into
Shopify's native translation storage. Hydrogen can then read the translated
values without bundling the entire catalog or rebuilding for every catalog edit.
GT supplies the translations; Translate & Adapt is not used to generate them.

This is a reference implementation in `kevinwu98/gt-shopify`, not a hosted GT
integration or a completed merchant app. This connector's live GT translation
and Shopify writeback have not yet been run. The separate `gt-shopify-public` starter is
unchanged. See [the integration recipe](HYDROGEN-INTEGRATION.md) and
[the product/partnership proposal](SHOPIFY-PARTNERSHIP.md).

## Supported scope

| Shopify resource | Fields this connector translates |
| --- | --- |
| Product | Title, product type, SEO title and SEO description |
| Product option | Name |
| Product option value | Name |

English must be the store's primary language. French and Japanese are the default
targets. Export reads the resources accessible to the Admin app, including
products that may not be published on the Hydrogen channel. It exports current
translations as well as source values and Shopify's source-content digests.

**Rich product descriptions (`body_html`) are not supported yet.** The installed
GT batch API accepts string/structured message formats, not raw HTML. This
connector reports unsupported nonempty fields instead of flattening or replacing
merchant markup. GT's separate file-job API supports HTML; integrating that
pipeline and verifying markup preservation is a next extension. Handles,
collections, menus, pages, metafields, market overrides,
checkout, and account content are also outside this initial connector's scope.
The earlier [dictionary demo](CATALOG.md) can translate plain-text descriptions,
but that is a different delivery path and does not establish rich HTML support.

## 1. Authorize the local connector

Use Node 24 in this checkout. Create the ignored local configuration file:

```sh
cd /Users/kevinwu/Documents/gt-shopify
test -f .env.shopify-catalog || cp .env.shopify-catalog.example .env.shopify-catalog
```

An installed Shopify app must provide an Admin API access token with
`read_translations`, `write_translations`, and `read_locales`. The existing
Hydrogen Storefront tokens and the prior permission grant to the Hydrogen channel
do not authorize this new connector. Its app does not need customer or order
permissions for these operations.

For an app acting on a store in your own Shopify organization, follow Shopify's
[client credentials grant guide](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant):
create the Dev Dashboard app, configure its access scopes, install it on the
demo store, and exchange its client credentials for an access token. That token
expires, so renew it when needed. This local connector accepts the resulting
token; it does not implement token acquisition or renewal. An app for other
merchants needs Shopify's merchant installation/authentication flow instead.

Fill these values in the ignored file using your editor, never in source code:

```dotenv
SHOPIFY_STORE_DOMAIN=gt-supply-demo.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=YOUR_ADMIN_ACCESS_TOKEN
SHOPIFY_CATALOG_LOCALES=fr,ja
GT_PROJECT_ID=prj_l3zra1ucz2hgr1esdfq0tlxi
GT_API_KEY=YOUR_GT_API_KEY
```

The GT key must have access to this project. Process environment variables take
precedence over the file. The connector does not reuse `.env.catalog`; copy your
GT credentials into this file locally if already configured for the earlier demo.
Keep both Admin and GT credentials out of Oxygen and browser code.

Add the target languages in Shopify's language settings before exporting. The
connector reads settings but never enables/publishes languages or changes markets.

## 2. Export and translate locally

```sh
npm run shopify-catalog:export
npm run shopify-catalog:status
npm run shopify-catalog:translate
npm run shopify-catalog:plan
```

Export reads Shopify without changing it. Translate sends missing supported
source strings to GT and uses translation quota. Plan has no network calls and
writes no Shopify data. Local state, generated translations, and plans live in
the ignored `.shopify-catalog/` directory.

Open `.shopify-catalog/plan.json` in your editor. Review each change's resource,
locale, English source, prior translation, and proposed translation. The summary
also identifies missing translations, existing merchant translations protected
from replacement, and unsupported fields. A plan can contain supported changes
while other fields remain missing; applying it does not mean the catalog is fully
translated.

Translations entered by merchants or another app are protected by default. The
connector updates its own previous translations only while their current values
still match its saved receipts. Keep this local state between runs. Losing it
causes existing Shopify translations to be treated as unowned and protected.

## 3. Apply the reviewed plan

Publish the target languages and configure their intended markets in Shopify.
Apply requires published target languages, but does not itself verify every
market/channel assignment. Copy the exact `planHash` from the reviewed plan:

```sh
npm run shopify-catalog:apply -- --plan-hash PASTE_REVIEWED_PLAN_HASH
```

**Apply writes translations to Shopify.** It checks the store identity, source
digests, and current target translations before the first write, then checks each
resource again immediately before writing. It uses Shopify's
[`translationsRegister`](https://shopify.dev/docs/api/admin-graphql/2026-04/mutations/translationsRegister)
with the source digest and records confirmed results after each resource.

The writes are not one transaction. If a later resource fails, earlier ones may
have succeeded. Re-export and review a new plan. An unconfirmed network outcome
must not be assumed to have failed; inspect Shopify before retrying. Shopify's
source digest protects against source changes, but there is no atomic comparison
of the target translation, so avoid editing the same translations concurrently
with apply.

## 4. Use native catalog delivery in Hydrogen

After Shopify contains the translations, add this non-secret setting to the
storefront's existing `.env`, then restart its dev server:

```dotenv
GT_CATALOG_DELIVERY=shopify
```

```sh
npm run dev -- --port 3130
```

With this setting, the same request locale controls GT's UI and Hydrogen's
Shopify language context. Native catalog text passes through unchanged. The root
response sends no catalog dictionaries, and catalog JSON is not imported by
browser code. GT still renders UI translations and formats Shopify money values.
Country stays `US`: choosing Japanese does not switch to a Japanese market or
convert USD to JPY.

Verify real applied French/Japanese names in the initial HTML, cards, product
page, search results, and cart. Exercise translated option selection and confirm
the purchased variant ID and quantities survive language switches. Check native
description behavior separately; this connector has not translated descriptions.

Run the normal build/typecheck/tests and read-only localized deployment checks.
`CHECK_CATALOG=1` belongs to the earlier bundled dictionaries and is **not** proof
of native delivery. Native validation must compare the actual Shopify values
with the reviewed/applied connector plan. For Oxygen, deploy the code and set the
same non-secret mode variable there; subsequent catalog-only updates should
appear after Shopify/Hydrogen caches refresh without another code deployment.

Omitting the mode variable, or setting it to `dictionary`, restores the prior
demo path. This does not remove translations already saved in Shopify.

## Continuing updates and limits

Repeat export → translate → plan → review → apply for product edits. Export
retains generated translations for unchanged source digests, invalidates changed
ones, and drops deleted resources from local state. It does not delete remote
translations. Missing GT results are retryable; successful batches are retained.

Commands pin Shopify API version `2026-04`. Optional `--directory PATH` separates
state for different stores. `--env-file PATH` selects credentials. Export also
accepts `--locales fr,ja` and `--max-resources 10000`; it fails instead of silently
truncating larger catalogs. Keep custom credential/state paths outside Git.

This local process is sequential and bounded. It has no hosted authorization,
webhook registration, background queues, automatic retry/backoff, review UI,
billing, or multi-merchant operational controls. Those are service/product work,
not features created by running this script. A second fresh storefront and real
catalog-change demonstration remain required before claiming repeatable onboarding.
