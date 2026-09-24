import {T} from 'gt-react';
import {useLocalePath} from '~/lib/i18n';
import {type FetcherWithComponents} from 'react-router';
import type {action} from '~/routes/cart';
import {CartForm, type OptimisticCartLineInput} from '@shopify/hydrogen';

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
  const localize = useLocalePath();
  return (
    <CartForm route={localize('/cart')} inputs={{lines}} action={CartForm.ACTIONS.LinesAdd}>
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
            {fetcher.state !== 'idle' ? <T>Adding…</T> : children}
          </button>
          {fetcher.state === 'idle' &&
            (fetcher.data?.userErrors?.length || fetcher.data?.errors?.length) ? (
              <div role="alert" className="cart-error">
                <p><T>Unable to add this item to your cart.</T></p>
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
