import {useGT, useLocaleSelector} from 'gt-react';
import {useFetcher, useLocation} from 'react-router';

const nativeNames: Record<string, string> = {
  en: 'English',
  fr: 'Français',
  ja: '日本語',
};

export function LocaleSwitcher() {
  const gt = useGT();
  const {locale, locales, getLocaleProperties} = useLocaleSelector();
  const fetcher = useFetcher<{error?: string; code?: string}>();
  const location = useLocation();
  const pending = fetcher.state !== 'idle';
  const hasError = !pending && Boolean(fetcher.data?.error);

  return (
    <fetcher.Form method="post" action="/market" className="locale-switcher-form">
      <input
        type="hidden"
        name="returnTo"
        value={location.pathname + location.search + location.hash}
      />
      <select
        name="locale"
        aria-label={gt('Language')}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? 'locale-switcher-error' : undefined}
        className="locale-switcher"
        value={locale}
        disabled={pending}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        {locales.map((optionLocale) => (
          <option
            key={optionLocale}
            value={optionLocale}
            lang={optionLocale}
            translate="no"
          >
            {nativeNames[optionLocale] ??
              getLocaleProperties(optionLocale).nativeName}
          </option>
        ))}
      </select>
      {hasError && (
        <p id="locale-switcher-error" className="locale-switcher-error" role="alert">
          {fetcher.data?.code === 'CART_MARKET_UNAVAILABLE'
            ? gt('Some items in your cart are not available in this region. Remove them from your cart before switching.')
            : gt('We could not change your language and region. Please try again.')}
        </p>
      )}
    </fetcher.Form>
  );
}
