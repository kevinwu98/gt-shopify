import {NavLink, useRouteLoaderData} from 'react-router';
import {T, useGT} from 'gt-react';

import type {FooterQuery, HeaderQuery} from 'storefrontapi.generated';
import type {RootLoader} from '~/root';

type FooterProps = {
  footer: Promise<FooterQuery | null>;
  header: HeaderQuery;
  publicStoreDomain: string;
};

export function Footer(_props: FooterProps) {
  const gt = useGT();
  const root = useRouteLoaderData<RootLoader>('root');

  return (
    <footer className="footer">
      <div className="footer-top">
        <div translate="no">
          <NavLink className="brand footer-brand" to={'/'} end>
            Great Things
          </NavLink>
          <p className="footer-tagline">by General Translation</p>
        </div>
        <T>
          <nav className="footer-menu" aria-label={gt('Footer navigation')}>
            <NavLink to={'/collections/all'}>Shop all</NavLink>
            <NavLink to={'/cart'}>Your cart</NavLink>
          </nav>
        </T>
      </div>
      {root?.isDemoStore ? (
        <div className="footer-bottom">
          <T>
            <p>Sample storefront. Checkout is disabled.</p>
          </T>
        </div>
      ) : null}
    </footer>
  );
}
