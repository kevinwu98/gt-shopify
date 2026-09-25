import english from '../../catalog/en.json';

type Catalog = Record<string, string>;
type CatalogDictionary = Record<string, [string, {$format: 'STRING'}]>;

const source: Catalog = english;
// Vite includes generated catalog files at build time, including newly added
// languages. Adding a GT locale no longer requires another import or map entry.
const catalogs = import.meta.glob<Catalog>(
  ['../../catalog/*.json', '!../../catalog/manifest.json'],
  {eager: true, import: 'default'},
);

function targetCatalog(locale: string): Catalog {
  return catalogs[`../../catalog/${locale}.json`] ?? {};
}

function dictionary(entries: Catalog): CatalogDictionary {
  // Merchant text is literal content, never an ICU template. This preserves
  // apostrophes and braces in product names and descriptions.
  return Object.fromEntries(
    Object.entries(entries).map(([key, value]) => [key, [value, {$format: 'STRING'}]]),
  );
}

/** Include English fallback and only the active language in the SSR payload. */
export function getCatalogDictionaries(locale: string) {
  const dictionaries: Record<string, CatalogDictionary> = {en: dictionary(source)};
  if (locale !== 'en') {
    const target = targetCatalog(locale);
    const entries = Object.fromEntries(
      Object.entries(source).map(([key, value]) => [key, target[key] || value]),
    );
    dictionaries[locale] = dictionary(entries);
  }
  return dictionaries;
}

/** Server-side metadata uses the same source guard as the React lookup. */
export function getCatalogText(locale: string, key: string, liveEnglish: string) {
  if (source[key] !== liveEnglish) return liveEnglish;
  return targetCatalog(locale)[key] || liveEnglish;
}
