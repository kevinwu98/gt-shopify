import {type FetcherWithComponents} from 'react-router';
import type {action} from '~/routes/cart';
import {CartForm, type OptimisticCartLineInput} from '@shopify/hydrogen';
import {T, useGT} from 'gt-react';

export function AddToCartButton({
  analytics,
  children,
  disabled,
  lines,
  onClick,
}: {
  analytics?: unknown;
  children: React.ReactNode;
  disabled?: boolean;
  lines: Array<OptimisticCartLineInput>;
  onClick?: () => void;
}) {
  const gt = useGT();

  return (
    <CartForm route={'/cart'} inputs={{lines}} action={CartForm.ACTIONS.LinesAdd}>
      {(fetcher: FetcherWithComponents<Awaited<ReturnType<typeof action>>['data']>) => (
        <>
          <input
            name="analytics"
            type="hidden"
            value={JSON.stringify(analytics)}
          />
          <button
            type="submit"
            onClick={onClick}
            disabled={disabled || fetcher.state !== 'idle'}
          >
            {fetcher.state !== 'idle' ? gt('Adding…') : children}
          </button>
          {fetcher.state === 'idle' &&
            (fetcher.data?.userErrors?.length || fetcher.data?.errors?.length) ? (
              <div role="alert" className="cart-error">
                <T>
                  <p>Unable to add this item to your cart.</p>
                </T>
                {fetcher.data?.userErrors?.map((error, index) => (
                  <p key={index}>{error.message}</p>
                ))}
              </div>
            ) : null}
        </>
      )}
    </CartForm>
  );
}
