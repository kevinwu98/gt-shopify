import type {SelectedOption} from '@shopify/hydrogen/storefront-api-types';
import {useMemo} from 'react';

export function useVariantUrl(
  handle: string,
  selectedOptions?: SelectedOption[],
) {
  return useMemo(() => {
    return getVariantUrl({
      handle,
      searchParams: new URLSearchParams(),
      selectedOptions,
    });
  }, [handle, selectedOptions]);
}

export function getVariantUrl({
  handle,
  searchParams,
  selectedOptions,
}: {
  handle: string;
  searchParams: URLSearchParams;
  selectedOptions?: SelectedOption[];
}) {
  const path = `/products/${handle}`;

  selectedOptions?.forEach((option) => {
    searchParams.set(option.name, option.value);
  });

  const searchString = searchParams.toString();

  return path + (searchString ? '?' + searchParams.toString() : '');
}
