import {useFetcher, useLocation, useRouteLoaderData} from 'react-router';
import {useGT, useLocale, useMessages} from 'gt-react';
import type {RootLoader} from '~/root';

/** Country determines Shopify pricing; the separate GT selector controls language. */
export function MarketSwitcher() {
  const data = useRouteLoaderData<RootLoader>('root');
  const fetcher = useFetcher<{error?: string}>();
  const location = useLocation();
  const locale = useLocale();
  const gt = useGT();
  const m = useMessages();
  if (!data?.markets) return null;
  const {country, availableCountries} = data.markets;
  const names = new Intl.DisplayNames([locale], {type: 'region'});

  return (
    <fetcher.Form method="post" action="/market" className="market-switcher">
      <input type="hidden" name="returnTo" value={location.pathname + location.search} />
      <select
        key={country.isoCode}
        name="country"
        aria-label={gt('Country')}
        defaultValue={country.isoCode}
        disabled={fetcher.state !== 'idle'}
      >
        {availableCountries.map((market) => (
          <option key={market.isoCode} value={market.isoCode}>
            {market.currency.isoCode} · {names.of(market.isoCode) ?? market.name}
          </option>
        ))}
      </select>
      <button type="submit" disabled={fetcher.state !== 'idle'}>
        {gt('Update')}
      </button>
      {fetcher.data?.error && (
        <span role="alert">{m(fetcher.data.error)}</span>
      )}
    </fetcher.Form>
  );
}
