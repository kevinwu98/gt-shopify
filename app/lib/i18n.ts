import {useLocation} from 'react-router';
import type {I18nBase} from '@shopify/hydrogen';

export const LOCALES = [
  {locale: 'en', language: 'EN', country: 'US', label: 'English', pathPrefix: ''},
  {locale: 'fr', language: 'FR', country: 'US', label: 'Français', pathPrefix: '/fr'},
  {locale: 'ja', language: 'JA', country: 'US', label: '日本語', pathPrefix: '/ja'},
] as const satisfies ReadonlyArray<I18nBase & {
  locale: string;
  label: string;
  pathPrefix: string;
}>;

export type StoreLocale = (typeof LOCALES)[number];

export function getStoreLocale(pathname: string): StoreLocale {
  const segment = pathname.replace(/\.data$/, '').split('/')[1];
  return LOCALES.find(({locale}) => locale === segment) ?? LOCALES[0];
}

export function localePath(path: string, locale: StoreLocale['locale']): string {
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  const prefix = LOCALES.find((entry) => entry.locale === locale)?.pathPrefix ?? '';
  const withoutLocale = path.replace(/^\/(en|fr|ja)(?=\/|[?#]|$)/, '') || '/';
  return `${prefix}${withoutLocale.startsWith('/') ? withoutLocale : `/${withoutLocale}`}`;
}

export function useStoreLocale(): StoreLocale {
  return getStoreLocale(useLocation().pathname);
}

export function useLocalePath() {
  const {locale} = useStoreLocale();
  return (path: string) => localePath(path, locale);
}
