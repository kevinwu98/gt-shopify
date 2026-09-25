import english from '../../catalog/en.json';
import french from '../../catalog/fr.json';
import japanese from '../../catalog/ja.json';

type Catalog = Record<string, string>;
type CatalogDictionary = Record<string, [string, {$format: 'STRING'}]>;

const source: Catalog = english;
const targets: Record<string, Catalog> = {fr: french, ja: japanese};

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
    const target = targets[locale] ?? {};
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
  return targets[locale]?.[key] || liveEnglish;
}
