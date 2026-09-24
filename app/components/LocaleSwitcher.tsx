import {useLocation, useNavigate, Link} from 'react-router';
import {useGT} from 'gt-react';
import {LOCALES, localePath, useStoreLocale} from '~/lib/i18n';

export function LocaleSwitcher() {
  const {pathname, search} = useLocation();
  const selected = useStoreLocale();
  const navigate = useNavigate();
  const gt = useGT();
  return (
    <nav className="locale-switcher" aria-label={gt('Language')} data-testid="locale-switcher">
      {LOCALES.map(({locale, label}) => (
        <Link
          key={locale}
          to={localePath(pathname + search, locale)}
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            const current = window.location;
            void navigate(localePath(current.pathname + current.search + current.hash, locale));
          }}
          lang={locale}
          hrefLang={locale}
          aria-current={selected.locale === locale ? 'true' : undefined}
          data-testid={`locale-${locale}`}
          prefetch="intent"
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
