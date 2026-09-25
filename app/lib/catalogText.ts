/** Only use a translation while its exported English text still matches Shopify. */
export function resolveCatalogText(
  source: string,
  exportedSource: string | undefined,
  translate: () => string,
): string {
  if (!source || exportedSource !== source) return source;

  try {
    return translate() || source;
  } catch {
    // An unavailable dictionary or invalid message must not break commerce.
    return source;
  }
}
