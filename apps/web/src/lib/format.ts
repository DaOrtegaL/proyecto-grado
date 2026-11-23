import { useTranslation } from 'react-i18next';
import { useAuth } from './auth';
import { ApiError } from './api';

/** Fechas almacenadas en UTC; se presentan según la zona horaria y la región del usuario. */
export function useFormat() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const timeZone = user?.timezone ?? 'America/Bogota';
  const locale = user?.locale === 'es' || !user?.locale ? 'es-CO' : user.locale;

  return {
    dateTime: (iso: string | Date | null | undefined) =>
      iso
        ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(iso))
        : '—',
    date: (iso: string | Date | null | undefined) =>
      iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(new Date(iso)) : '—',
    number: (n: number) => new Intl.NumberFormat(locale).format(n),
    timeZone,
    errorMessage: (error: unknown): string => {
      if (error instanceof ApiError) {
        for (const key of [`errors.${error.code}`, `errorsOps.${error.code}`]) {
          const translated = t(key);
          if (translated !== key) return translated;
        }
        return error.message;
      }
      return t('errors.NETWORK');
    },
  };
}
