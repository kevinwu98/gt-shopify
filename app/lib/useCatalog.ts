import {useTranslations} from 'gt-react';
import {useRouteLoaderData} from 'react-router';
import type {RootLoader} from '../root';
import {catalogKey} from './catalogKeys';
import {resolveCatalogText} from './catalogText';

/** Translate display text without changing Shopify IDs, options, or cart inputs. */
export function useCatalog() {
  const translate = useTranslations();
  const root = useRouteLoaderData<RootLoader>('root');

  return (
    productId: string,
    field: Parameters<typeof catalogKey>[1],
    source: string,
    optionName?: string,
    optionValue?: string,
  ) => {
    // Native delivery already contains localized values from Shopify. Do not
    // translate it again or send the full catalog to the browser.
    if (root?.catalogDelivery === 'shopify') return source;
    const key = catalogKey(productId, field, optionName, optionValue);
    return resolveCatalogText(source, root?.dictionaries.en?.[key]?.[0], () =>
      translate(key),
    );
  };
}
