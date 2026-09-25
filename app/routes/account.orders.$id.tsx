import {redirect, useLoaderData} from 'react-router';
import type {Route} from './+types/account.orders.$id';
import {Image} from '@shopify/hydrogen';
import {LocalizedMoney} from '~/components/LocalizedMoney';
import type {
  OrderLineItemFullFragment,
  OrderQuery,
} from 'customer-accountapi.generated';
import {CUSTOMER_ORDER_QUERY} from '~/graphql/customer-account/CustomerOrderQuery';
import {T, Var, Num, DateTime} from 'gt-react';

export const meta: Route.MetaFunction = ({data}) => {
  return [{title: `Order ${data?.order?.name}`}];
};

export async function loader({params, context}: Route.LoaderArgs) {
  const {customerAccount} = context;
  if (!params.id) {
    return redirect('/account/orders');
  }

  const orderId = atob(params.id);
  const {data, errors}: {data: OrderQuery; errors?: Array<{message: string}>} =
    await customerAccount.query(CUSTOMER_ORDER_QUERY, {
      variables: {
        orderId,
        language: customerAccount.i18n.language,
      },
    });

  if (errors?.length || !data?.order) {
    throw new Error('Order not found');
  }

  const {order} = data;

  // Extract line items directly from nodes array
  const lineItems = order.lineItems.nodes;

  // Extract discount applications directly from nodes array
  const discountApplications = order.discountApplications.nodes;

  // Get fulfillment status from first fulfillment node
  const fulfillmentStatus = order.fulfillments.nodes[0]?.status ?? 'N/A';

  // Get first discount value with proper type checking
  const firstDiscount = discountApplications[0]?.value;

  // Type guard for MoneyV2 discount
  const discountValue =
    firstDiscount?.__typename === 'MoneyV2'
      ? (firstDiscount as Extract<
          typeof firstDiscount,
          {__typename: 'MoneyV2'}
        >)
      : null;

  // Type guard for percentage discount
  const discountPercentage =
    firstDiscount?.__typename === 'PricingPercentageValue'
      ? (
          firstDiscount as Extract<
            typeof firstDiscount,
            {__typename: 'PricingPercentageValue'}
          >
        ).percentage
      : null;

  return {
    order,
    lineItems,
    discountValue,
    discountPercentage,
    fulfillmentStatus,
  };
}

export default function OrderRoute() {
  const {
    order,
    lineItems,
    discountValue,
    discountPercentage,
    fulfillmentStatus,
  } = useLoaderData<typeof loader>();
  return (
    <div className="account-order">
      <T>
        <h2>
          Order <Var>{order.name}</Var>
        </h2>
        <p>
          Placed on <DateTime>{new Date(order.processedAt!)}</DateTime>
        </p>
      </T>
      {order.confirmationNumber && (
        <T>
          <p>
            Confirmation: <Var>{order.confirmationNumber}</Var>
          </p>
        </T>
      )}
      <br />
      <div>
        <table>
          <thead>
            <tr>
              <th scope="col">
                <T>Product</T>
              </th>
              <th scope="col">
                <T>Price</T>
              </th>
              <th scope="col">
                <T>Quantity</T>
              </th>
              <th scope="col">
                <T>Total</T>
              </th>
            </tr>
          </thead>
          <tbody>
            {lineItems.map((lineItem, lineItemIndex) => (
              // eslint-disable-next-line react/no-array-index-key
              <OrderLineRow key={lineItemIndex} lineItem={lineItem} />
            ))}
          </tbody>
          <tfoot>
            {((discountValue && discountValue.amount) ||
              discountPercentage) && (
              <tr>
                <th scope="row" colSpan={3}>
                  <T>
                    <p>Discounts</p>
                  </T>
                </th>
                <th scope="row">
                  <T>
                    <p>Discounts</p>
                  </T>
                </th>
                <td>
                  {discountPercentage ? (
                    <T>
                      <span>
                        -<Num>{discountPercentage}</Num>% OFF
                      </span>
                    </T>
                  ) : (
                    discountValue && <LocalizedMoney data={discountValue!} />
                  )}
                </td>
              </tr>
            )}
            <tr>
              <th scope="row" colSpan={3}>
                <T>
                  <p>Subtotal</p>
                </T>
              </th>
              <th scope="row">
                <T>
                  <p>Subtotal</p>
                </T>
              </th>
              <td>
                <LocalizedMoney data={order.subtotal!} />
              </td>
            </tr>
            <tr>
              <th scope="row" colSpan={3}>
                <T>Tax</T>
              </th>
              <th scope="row">
                <T>
                  <p>Tax</p>
                </T>
              </th>
              <td>
                <LocalizedMoney data={order.totalTax!} />
              </td>
            </tr>
            <tr>
              <th scope="row" colSpan={3}>
                <T>Total</T>
              </th>
              <th scope="row">
                <T>
                  <p>Total</p>
                </T>
              </th>
              <td>
                <LocalizedMoney data={order.totalPrice!} />
              </td>
            </tr>
          </tfoot>
        </table>
        <div>
          <T>
            <h3>Shipping Address</h3>
          </T>
          {order?.shippingAddress ? (
            <address>
              <p>{order.shippingAddress.name}</p>
              {order.shippingAddress.formatted ? (
                <p>{order.shippingAddress.formatted}</p>
              ) : (
                ''
              )}
              {order.shippingAddress.formattedArea ? (
                <p>{order.shippingAddress.formattedArea}</p>
              ) : (
                ''
              )}
            </address>
          ) : (
            <T>
              <p>No shipping address defined</p>
            </T>
          )}
          <T>
            <h3>Status</h3>
          </T>
          <div>
            <p>{fulfillmentStatus}</p>
          </div>
        </div>
      </div>
      <br />
      <p>
        <T>
          <a target="_blank" href={order.statusPageUrl} rel="noreferrer">
            View Order Status →
          </a>
        </T>
      </p>
    </div>
  );
}

function OrderLineRow({lineItem}: {lineItem: OrderLineItemFullFragment}) {
  return (
    <tr key={lineItem.id}>
      <td>
        <div>
          {lineItem?.image && (
            <div>
              <Image data={lineItem.image} width={96} height={96} />
            </div>
          )}
          <div>
            <p>{lineItem.title}</p>
            <small>{lineItem.variantTitle}</small>
          </div>
        </div>
      </td>
      <td>
        <LocalizedMoney data={lineItem.price!} />
      </td>
      <td>{lineItem.quantity}</td>
      <td>
        <LocalizedMoney data={lineItem.totalDiscount!} />
      </td>
    </tr>
  );
}
