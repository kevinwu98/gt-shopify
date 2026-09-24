import {initializeGT} from 'gt-react';
import french from '~/translations/fr.json';
import japanese from '~/translations/ja.json';

initializeGT({
  defaultLocale: 'en',
  locales: ['en', 'fr', 'ja'],
  loadTranslations: async (locale) => {
    if (locale === 'fr') return french;
    if (locale === 'ja') return japanese;
    return {};
  },
});
