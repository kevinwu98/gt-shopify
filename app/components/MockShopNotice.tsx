import {T} from 'gt-react';

export function MockShopNotice() {
  return (
    <T>
      <div className="mock-shop-notice">
        <span className="sample-store-dot" aria-hidden="true" />
        <p>Sample store</p>
        <span className="sample-store-divider" aria-hidden="true">/</span>
        <p>Find your next favorite.</p>
      </div>
    </T>
  );
}
