import {Currency} from 'gt-react';

/** Format Shopify's price in the active GT locale without converting currency. */
export function LocalizedMoney({
  data,
  className,
}: {
  data: {amount?: string; currencyCode?: string};
  className?: string;
}) {
  // Optimistic cart responses can temporarily omit their cost fields.
  if (data.amount == null || !data.currencyCode) return null;
  return (
    <span className={className}>
      <Currency
        currency={data.currencyCode}
        // Pin whole rupiah across server/browser versions of CLDR.
        options={data.currencyCode === 'IDR'
          ? {minimumFractionDigits: 0, maximumFractionDigits: 0}
          : undefined}
      >
        {data.amount}
      </Currency>
    </span>
  );
}
