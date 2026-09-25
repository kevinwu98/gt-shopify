/**
 * Loads translations that are shipped with the application bundle.
 *
 * The files live in `public/_gt/[locale].json`, matching the `files.gt.output`
 * setting in `gt.config.json`.
 */
export default async function loadTranslations(locale: string) {
  const translations = await import(`../public/_gt/${locale}.json`);
  return translations.default;
}
