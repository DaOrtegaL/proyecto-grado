import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import { Button, Card, ErrorBox, inputClass } from '../components/ui';

export function LoginPage() {
  const { t } = useTranslation();
  const { signIn } = useAuth();
  const { errorMessage } = useFormat();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <h1 className="text-xl font-bold text-sky-700 dark:text-sky-400">{t('app.name')}</h1>
        <p className="mb-4 text-sm text-slate-500">{t('app.subtitle')}</p>
        <form onSubmit={onSubmit} className="space-y-3">
          <h2 className="font-semibold">{t('auth.title')}</h2>
          {error && <ErrorBox message={error} />}
          <label className="block text-sm">
            {t('auth.email')}
            <input className={`${inputClass} mt-1 w-full`} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block text-sm">
            {t('auth.password')}
            <input className={`${inputClass} mt-1 w-full`} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <Button type="submit" className="w-full" disabled={busy}>
            {t('auth.submit')}
          </Button>
          <p className="text-xs text-slate-500">{t('auth.labHint')}</p>
        </form>
      </Card>
    </div>
  );
}
