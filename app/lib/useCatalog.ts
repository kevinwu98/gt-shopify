import {useTranslations} from 'gt-react';
import sourceCatalog from '../../catalog/en.json';
import {catalogKey} from './catalogKeys';
import {resolveCatalogText} from './catalogText';

/** Translate display text without changing Shopify IDs, options, or cart inputs. */
export function useCatalog() {
  const translate = useTranslations();
  const sourceDictionary: Record<string, string> = sourceCatalog;

  return (
    productId: string,
    field: Parameters<typeof catalogKey>[1],
    source: string,
    optionName?: string,
    optionValue?: string,
  ) => {
    const key = catalogKey(productId, field, optionName, optionValue);
    return resolveCatalogText(source, sourceDictionary[key], () =>
      translate(key),
    );
  };
}
