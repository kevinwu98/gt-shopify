import {NavLink} from 'react-router';

import type {FooterQuery, HeaderQuery} from 'storefrontapi.generated';

type FooterProps = {
  footer: Promise<FooterQuery | null>;
  header: HeaderQuery;
  publicStoreDomain: string;
};

export function Footer(_props: FooterProps) {

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
        <p>A sample storefront, open to everyone.</p>
        <p>Sample storefront. Checkout is disabled.</p>
      </div>
    </footer>
  );
}
