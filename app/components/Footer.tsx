import {NavLink, useRouteLoaderData} from 'react-router';

import type {FooterQuery, HeaderQuery} from 'storefrontapi.generated';
import type {RootLoader} from '~/root';

type FooterProps = {
  footer: Promise<FooterQuery | null>;
  header: HeaderQuery;
  publicStoreDomain: string;
};

export function Footer(_props: FooterProps) {
  const root = useRouteLoaderData<RootLoader>('root');

  return (
    <footer className="footer">
      <div className="footer-top">
        <div>
          <NavLink className="brand footer-brand" to={'/'} end>
            <span translate="no">GT Supply.</span>
          </NavLink>
          <p className="footer-tagline">Everyday essentials. A world of possibility.</p>
        </div>
        <nav className="footer-menu" aria-label={'Footer navigation'}>
          <NavLink to={'/collections/all'}>Shop all</NavLink>
          <NavLink to={'/cart'}>Your cart</NavLink>
        </nav>
      </div>
      <div className="footer-bottom">
        <p>Thoughtful essentials for every day.</p>
        <p>
          {root?.isDemoStore
            ? 'Sample storefront. Checkout is disabled.'
            : 'Powered by Shopify.'}
        </p>
      </div>
    </footer>
  );
}
