import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import es from './locales/es/common.json';
import esOps from './locales/es/ops.json';
import ptBR from './locales/pt-BR/common.json';

// Español es el idioma predeterminado; pt-BR queda registrado y cae a español hasta traducirse.
void i18n.use(initReactI18next).init({
  resources: { es: { translation: { ...es, ...esOps } }, 'pt-BR': { translation: ptBR } },
  lng: 'es',
  fallbackLng: 'es',
  supportedLngs: ['es', 'pt-BR'],
  interpolation: { escapeValue: false },
});

export default i18n;
