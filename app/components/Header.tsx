import {Suspense} from 'react';
import {Await, NavLink, useAsyncValue} from 'react-router';
import {
  type CartViewPayload,
  useAnalytics,
  useOptimisticCart,
} from '@shopify/hydrogen';

import type {HeaderQuery, CartApiQueryFragment} from 'storefrontapi.generated';
import {useAside} from '~/components/Aside';
import {T, useGT} from 'gt-react';
import {LocaleSwitcher} from '~/components/LocaleSwitcher';
import {MarketSwitcher} from '~/components/MarketSwitcher';


type HeaderProps = {
  header: HeaderQuery;
  cart: Promise<CartApiQueryFragment | null>;
  isLoggedIn: Promise<boolean>;
  publicStoreDomain: string;
};

export function Header({cart}: HeaderProps) {

  const gt = useGT();

  return (
    <header className="header">
      <NavLink className="brand" prefetch="intent" to={'/'} end>
        <span translate="no">GT Supply<span className="brand-period">.</span></span>
      </NavLink>
      <nav className="header-shop" aria-label={gt('Main navigation')}>
        <T>
          <NavLink prefetch="intent" to={'/collections/all'}>
            Shop
          </NavLink>
        </T>
      </nav>
      <div className="header-ctas">

        <LocaleSwitcher />
        <MarketSwitcher />
        <SearchToggle />
        <CartToggle cart={cart} />
      </div>
    </header>
  );
}

export function HeaderMenu({viewport}: {
  menu: HeaderProps['header']['menu'];
  primaryDomainUrl: HeaderProps['header']['shop']['primaryDomain']['url'];
  viewport: 'desktop' | 'mobile';
  publicStoreDomain: HeaderProps['publicStoreDomain'];
}) {
  const gt = useGT();
  const {close} = useAside();

  return (
    <nav className={`header-menu-${viewport}`} aria-label={gt('Main navigation')}>
      <T>
        <NavLink onClick={close} prefetch="intent" to={'/'} end>
          Home
        </NavLink>
        <NavLink onClick={close} prefetch="intent" to={'/collections/all'}>
          Shop
        </NavLink>
      </T>
    </nav>
  );
}

function SearchToggle() {
  const gt = useGT();
  const {open} = useAside();

  return (
    <button className="header-search reset" onClick={() => open('search')} aria-label={gt('Search')}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4.5 4.5" />
      </svg>
      <T>
        <span>Search</span>
      </T>
    </button>
  );
}

function CartBadge({count}: {count: number}) {
  const gt = useGT();
  const {open} = useAside();
  const {publish, shop, cart, prevCart} = useAnalytics();

  return (
    <a
      className="header-cart"
      href={'/cart'}
      onClick={(event) => {
        event.preventDefault();
        open('cart');
        publish('cart_viewed', {
          cart,
          prevCart,
          shop,
          url: window.location.href || '',
        } as CartViewPayload);
      }}
    >
      <T>Cart</T>
      <span className="cart-count" aria-label={gt('Items in cart')}>{count}</span>
    </a>
  );
}

function CartToggle({cart}: Pick<HeaderProps, 'cart'>) {
  return (
    <Suspense fallback={<CartBadge count={0} />}>
      <Await resolve={cart}>
        <CartBanner />
      </Await>
    </Suspense>
  );
}

function CartBanner() {
  const originalCart = useAsyncValue() as CartApiQueryFragment | null;
  const cart = useOptimisticCart(originalCart);
  return <CartBadge count={cart?.totalQuantity ?? 0} />;
}
