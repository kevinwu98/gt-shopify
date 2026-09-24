import {T} from 'gt-react';

export function MockShopNotice() {
  return (
    <div className="mock-shop-notice">
      <span className="sample-store-dot" aria-hidden="true" />
      <p><T>Sample store</T></p>
      <span className="sample-store-divider" aria-hidden="true">/</span>
      <p><T>Explore in your language.</T></p>
    </div>
  );
}
