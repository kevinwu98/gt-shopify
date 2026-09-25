/** Stable, flat dictionary keys; Shopify's IDs and option values stay canonical. */
export function catalogKey(
  productId: string,
  field: 'title' | 'description' | 'optionName' | 'optionValue',
  optionName?: string,
  optionValue?: string,
): string {
  const id = /^gid:\/\/shopify\/Product\/([1-9]\d*)$/.exec(productId)?.[1];
  if (!id) throw new Error('Expected a Shopify Product GID for catalog content.');
  const prefix = `product_${id}`;
  if (field === 'title' || field === 'description') return `${prefix}_${field}`;
  if (optionName === undefined) throw new Error('An option name is required.');
  const option = `${prefix}_option_${encodeKeyPart(optionName)}`;
  if (field === 'optionName') return `${option}_name`;
  if (optionValue === undefined) throw new Error('An option value is required.');
  return `${option}_value_${encodeKeyPart(optionValue)}`;
}

function encodeKeyPart(value: string): string {
  return Array.from(new TextEncoder().encode(value), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
