import {useGT, useLocaleSelector} from 'gt-react';

const nativeNames: Record<string, string> = {
  en: 'English',
  fr: 'Français',
  ja: '日本語',
};

export function LocaleSwitcher() {
  const gt = useGT();
  const {locale, locales, setLocale, getLocaleProperties} = useLocaleSelector();

  return (
    <select
      aria-label={gt('Language')}
      className="locale-switcher"
      value={locale}
      onChange={(event) => setLocale(event.currentTarget.value)}
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
  );
}
