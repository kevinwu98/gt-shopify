import {useOptimisticCart} from '@shopify/hydrogen';
import {Link, useFetchers} from 'react-router';
import type {action} from '~/routes/cart';
import type {CartApiQueryFragment} from 'storefrontapi.generated';
import {useAside} from '~/components/Aside';
import {CartLineItem, type CartLine} from '~/components/CartLineItem';
import {CartSummary} from './CartSummary';
import {T, useGT} from 'gt-react';

export type CartLayout = 'page' | 'aside';

export type CartMainProps = {
  cart: CartApiQueryFragment | null;
  layout: CartLayout;
};

export type LineItemChildrenMap = {[parentId: string]: CartLine[]};
/** Returns a map of all line items and their children. */
function getLineItemChildrenMap(lines: CartLine[]): LineItemChildrenMap {
  const children: LineItemChildrenMap = {};
  for (const line of lines) {
    if ('parentRelationship' in line && line.parentRelationship?.parent) {
      const parentId = line.parentRelationship.parent.id;
      if (!children[parentId]) children[parentId] = [];
      children[parentId].push(line);
    }
    if ('lineComponents' in line) {
      const lineChildren = getLineItemChildrenMap(line.lineComponents);
      for (const [parentId, childIds] of Object.entries(lineChildren)) {
        if (!children[parentId]) children[parentId] = [];
        children[parentId].push(...childIds);
      }
    }
  }
  return children;
}
/**
 * The main cart component that displays the cart items and summary.
 * It is used by both the /cart route and the cart aside dialog.
 */
export function CartMain({layout, cart: originalCart}: CartMainProps) {
  const gt = useGT();

  const fetchers = useFetchers();
  const failedActions = fetchers.flatMap((fetcher) => {
    const result: Awaited<ReturnType<typeof action>>['data'] | undefined = fetcher.data;
    if (fetcher.state !== 'idle' || !result?.cartAction ||
      !(result.userErrors?.length || result.errors?.length)) return [];
    return [{key: fetcher.key, userErrors: result.userErrors}];
  });
  // The useOptimisticCart hook applies pending actions to the cart
  // so the user immediately sees feedback when they modify the cart.
  const cart = useOptimisticCart(originalCart);

  const linesCount = Boolean(cart?.lines?.nodes?.length || 0);
  const withDiscount =
    cart &&
    Boolean(cart?.discountCodes?.filter((code) => code.applicable)?.length);
  const className = `cart-main ${withDiscount ? 'with-discount' : ''}`;
  const cartHasItems = cart?.totalQuantity ? cart.totalQuantity > 0 : false;
  const childrenMap = getLineItemChildrenMap(cart?.lines?.nodes ?? []);

  return (
    <section
      className={className}
      aria-label={layout === 'page' ? gt('Cart page') : gt('Cart drawer')}
    >
      {failedActions.map((fetcher) => (
        <div key={fetcher.key} role="alert" className="cart-error">
          <T>
            <p>We could not update your cart.</p>
          </T>
          {fetcher.userErrors?.map((error, index) => (
            <p key={index}>{error.message}</p>
          ))}
        </div>
      ))}
      <CartEmpty hidden={linesCount} layout={layout} />
      <div className="cart-details">
        <T>
          <p id="cart-lines" className="sr-only">
            Line items
          </p>
        </T>
        <div>
          <ul aria-labelledby="cart-lines">
            {(cart?.lines?.nodes ?? []).map((line) => {
              // we do not render non-parent lines at the root of the cart
              if (
                'parentRelationship' in line &&
                line.parentRelationship?.parent
              ) {
                return null;
              }
              return (
                <CartLineItem
                  key={line.id}
                  line={line}
                  layout={layout}
                  childrenMap={childrenMap}
                />
              );
            })}
          </ul>
        </div>
        {cartHasItems && <CartSummary cart={cart} layout={layout} />}
      </div>
    </section>
  );
}

function CartEmpty({
  hidden = false,
}: {
  hidden: boolean;
  layout?: CartMainProps['layout'];
}) {

  const {close} = useAside();
  return (
    <div hidden={hidden}>
      <T>
        <br />
        <p>Your cart is empty. Find something you love.</p>
        <br />
        <Link to={'/collections'} onClick={close} prefetch="viewport">
          Continue shopping →
        </Link>
      </T>
    </div>
  );
}
