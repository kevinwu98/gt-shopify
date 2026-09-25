import {LocalizedMoney} from '~/components/LocalizedMoney';
import type {MoneyV2} from '@shopify/hydrogen/storefront-api-types';
import {useGT} from 'gt-react';

export function ProductPrice({
  price,
  compareAtPrice,
}: {
  price?: MoneyV2;
  compareAtPrice?: MoneyV2 | null;
}) {
  const gt = useGT();

  return (
    <div aria-label={gt('Price')} className="product-price" role="group">
      {compareAtPrice ? (
        <div className="product-price-on-sale">
          {price ? <LocalizedMoney data={price} /> : null}
          <s>
            <LocalizedMoney data={compareAtPrice} />
          </s>
        </div>
      ) : price ? (
        <LocalizedMoney data={price} />
      ) : (
        <span>&nbsp;</span>
      )}
    </div>
  );
}
