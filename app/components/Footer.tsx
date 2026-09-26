import {NavLink, useRouteLoaderData} from 'react-router';
import {T, Var, useGT} from 'gt-react';

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
        <T context="Great Things is the store name. Translate its meaning into the target language rather than leaving it in English.">
          <div>
            <NavLink className="brand footer-brand" to={'/'} end>
              Great Things
            </NavLink>
            <p className="footer-tagline">
              by <Var>General Translation</Var>
            </p>
          </div>
        </T>
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
