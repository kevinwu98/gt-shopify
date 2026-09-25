# Sample apparel

`shopify-apparel.csv` imports eight fictional products (91 variants) from Shopify's default [mock.shop catalog](https://shopify.dev/docs/storefronts/headless/mock-shop) into the existing GT Supply Demo development store. Source: `https://mock.shop/api`, retrieved September 25, 2026.

Products: Ocean and Clay hoodies, men's and women's T-shirts, sweatpants, slides, men's crewneck, and half zip. Photography, descriptions, option values and numeric sample prices come from Shopify's sample data. The CSV prices are demonstration amounts in the destination store's base currency (USD); they are not a CAD-to-USD conversion. Shopify Markets determines presentment prices after import.

Import through Shopify Admin → Products → Import. Keep overwrite disabled and publish the imported products to Hydrogen. Inventory is untracked for this fictional demo; products still require shipping. Existing snowboards are preserved. The homepage features the Ocean hoodie when available and otherwise falls back to a store collection; newest products appear first in the catalog.

After importing into a different store, run `npm run catalog:sync`, `npm run catalog:translate`, and `npm run catalog:check`. Shopify assigns new product IDs, so the source store's translation keys cannot be reused unchanged.

## Visual system

Based on the [Proto brand canon](https://www.prototemplate.com/docs/brand) and [Glyphfield](https://www.glyphfield.com/): Inter, ink `#070707`, white, titanium hairlines, blue `#2f5ce0`, square geometry, a monochrome GT monogram, and restrained heading weights. Inter is self-hosted under the adjacent SIL Open Font License. The monogram is GT's existing asset, not a redrawn logo.
