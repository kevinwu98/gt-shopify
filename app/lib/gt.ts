import {initializeGT} from 'gt-react';
import gtConfig from '../../gt.config.json';
import loadTranslations from '../loadTranslations';

// Both the Hydrogen context and React tree resolve locales from this config.
initializeGT({
  defaultLocale: gtConfig.defaultLocale,
  locales: gtConfig.locales,
  loadTranslations,
});
