# What would make GT valuable to Shopify?

An i18n library working in Hydrogen demonstrates compatibility. It does not, by
itself, establish a reason for Shopify to buy GT or make GT a preferred partner.
The product hypothesis is **continuous localization across merchant content and
custom storefront code**, with less setup and maintenance work for merchants.
That hypothesis needs evidence from real integrations.

## One merchant experience, multiple components

The proposed GT project would show a GitHub connection, a Shopify connection,
source/target languages, translation coverage, pending reviews, and recent runs.
Locadex can provide this entry point. Underneath it, different components perform
different jobs:

| Component | Responsibility |
| --- | --- |
| Locadex | Internationalize code, open/update PRs, and maintain UI translations |
| `gt-react` | Render UI translations during SSR/in the browser and format money, dates, and numbers |
| GT catalog connector | Translate changed merchant content and save supported translations in Shopify |
| Shopify + Hydrogen + Oxygen | Commerce data and transactions, language/market configuration, localized catalog delivery, and storefront hosting |

“Connect GitHub and Shopify, choose languages, review one integration PR, then
keep both sources translated” is the intended merchant experience. The Shopify
connection and combined coverage view are **proposed product work**, not features
already installed in the GT dashboard by this POC. Native translation storage
also lets the catalog connector serve supported Shopify storefronts beyond
Hydrogen; the `gt-react` integration remains specific to React application code.

## The existing baseline is substantial

Shopify already provides AI catalog translation in Translate & Adapt. Its current
documentation limits automatic translation to two languages and requires the
merchant to rerun it for new or changed content. Third-party apps can use
Shopify's translation storage alongside it. GT should be compared with that
workflow and existing translation apps, not with an untranslated store.
[Source: Shopify Translate & Adapt](https://help.shopify.com/en/manual/international/translate-adapt-app).

Translating product names or offering a third language is therefore an incomplete
differentiator. The stronger hypothesis combines ongoing change detection,
consistent terminology across code and catalog, reviewable results, and reliable
delivery without a developer managing every refresh. Translation quality, lower
cost, and increased sales must be measured before becoming sales claims.

## Three distinct commercial relationships

| Relationship | Who pays GT? | Why it could make sense | Evidence required |
| --- | --- | --- | --- |
| Merchant product | Merchant or agency | Less engineering/operations work keeping a custom storefront localized | Repeatable installation, supported coverage, continuing updates, willingness to pay |
| Technology partnership | Usually the merchant; Shopify may provide ecosystem support | A supported solution helps merchants adopt and maintain international custom storefronts | Merchant demand, a maintained integration, measured support/setup outcomes, clear ownership |
| Embedded platform/API supplier | Shopify | Shopify chooses GT infrastructure to power a Shopify-owned localization capability | A named product owner and unmet need, quality/cost/reliability evidence, integration fit, commercial agreement |

Shopify's Technology Partner program includes public apps and custom integrations;
its listed benefits vary. Joining it is not a purchase commitment, guaranteed
distribution, or evidence that Shopify recommends GT.
[Source: Shopify Technology Partners](https://www.shopify.com/partners/technology-partners).

For a direct sale, determine which Shopify team owns the proposed experience,
what is costly or missing today, and why buying GT is preferable to extending
their existing system. An embedded product could expose Shopify UI while using
GT APIs behind it; merchants would not necessarily see Locadex. That is a separate
product and commercial discussion from a merchant connecting GitHub to GT.

## What this POC establishes, and what remains

| Stage | Status / next evidence |
| --- | --- |
| React storefront integration | This repo has GT UI localization, language selection, SSR integration, and currency formatting; Locadex created reviewable code/translation PRs with manual integration corrections |
| Bundled catalog prototype | Local export/translation/display code exists; French/Japanese dictionaries now contain all 28 exported entries for six demo products; these are separate from native Shopify translations |
| Native catalog connector | Local reference pipeline and opt-in storefront mode; live Admin authorization, translation generation, Shopify writeback, and native delivery must be verified before calling it an end-to-end proof |
| Merchant onboarding | A documented recipe exists; a second untouched storefront has not yet demonstrated repeatable setup |
| Continuous managed service | Shopify OAuth/install flow, hosted synchronization, queues, review/status UI, operational support, and billing remain product work |
| Business outcome | No measured merchant adoption, time savings, quality advantage, conversion lift, or Shopify buying commitment yet |

The local connector removes one architectural limitation: catalog translations
can be refreshed in Shopify independently of an Oxygen code deployment. It does
not create a managed service simply by existing as a script.

## The next credible demonstration

1. Install on a fresh Hydrogen starter using the documented recipe. Record elapsed
   setup time, manual corrections, and required permissions.
2. Show translated initial HTML and a complete browse → variant → cart flow in
   English, French, and Japanese. Confirm money formatting without changing the
   charged currency accidentally.
3. Change one UI feature in GitHub. Show Locadex's PR, review, and resulting Oxygen
   deployment.
4. Change one product in Shopify. Show GT's translation and native Shopify
   writeback, then the updated storefront without a new build. A local rerun is
   the first milestone; a background-triggered run is a later service milestone.
5. Repeat updates, introduce a source change during translation, and edit a
   translation manually. Demonstrate that the system detects stale work and
   preserves merchant decisions.
6. Pilot with merchants/agency developers and compare against their actual current
   workflow. Measure setup effort, ongoing maintenance, missing/stale content,
   translation review acceptance, update latency, and cost per changed field.

The initial Shopify ask should be a design-partner conversation and introductions
to relevant Hydrogen merchants: validate whether this is a meaningful recurring
problem. A successful pilot can support a recommended integration or distribution
discussion. An embedded GT purchase needs its own validated platform-level case.
