import {NavLink} from 'react-router';
import {T, useGT} from 'gt-react';
import type {FooterQuery, HeaderQuery} from 'storefrontapi.generated';
import {useLocalePath} from '~/lib/i18n';

type FooterProps = {
  footer: Promise<FooterQuery | null>;
  header: HeaderQuery;
  publicStoreDomain: string;
};

export function Footer(_props: FooterProps) {
  const localePath = useLocalePath();
  const gt = useGT();
  return (
    <footer className="footer">
      <div className="footer-top">
        <div>
          <NavLink className="brand footer-brand" to={localePath('/')} end>
            <span translate="no">GT Supply.</span>
          </NavLink>
          <p className="footer-tagline"><T>Everyday essentials. A world of possibility.</T></p>
        </div>
        <nav className="footer-menu" aria-label={gt('Footer navigation')}>
          <NavLink to={localePath('/collections/all')}><T>Shop all</T></NavLink>
          <NavLink to={localePath('/cart')}><T>Your cart</T></NavLink>
        </nav>
      </div>
      <div className="footer-bottom">
        <p><T>A sample storefront, open to everyone.</T></p>
        <p><T>Sample storefront. Checkout is disabled.</T></p>
      </div>
    </footer>
  );
}
