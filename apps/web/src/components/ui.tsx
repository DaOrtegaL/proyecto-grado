import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, FlaskConical, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import type { DataOrigin } from '../lib/types';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-sky-700 text-white hover:bg-sky-800',
        outline: 'border border-slate-300 bg-white hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800',
        ghost: 'hover:bg-slate-200 dark:hover:bg-slate-800',
        danger: 'bg-red-700 text-white hover:bg-red-800',
      },
      size: { default: '', sm: 'px-2 py-1 text-xs' },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn('rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900', className)}>
      {children}
    </section>
  );
}

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="flex gap-2">{actions}</div>
    </div>
  );
}

const TONES = {
  green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  red: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  slate: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  sky: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
};

export function Badge({ tone = 'slate', children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', TONES[tone])}>{children}</span>;
}

const STATUS_TONE = { VALID: 'green', EXPIRING_SOON: 'amber', EXPIRED: 'red', UNKNOWN: 'slate' } as const;
export function StatusBadge({ status }: { status: keyof typeof STATUS_TONE }) {
  const { t } = useTranslation();
  return <Badge tone={STATUS_TONE[status]}>{t(`status.${status}`)}</Badge>;
}

const PRIORITY_TONE: Record<string, keyof typeof TONES> = { CRITICAL: 'red', HIGH: 'orange', MEDIUM: 'amber', LOW: 'sky' };
export function PriorityBadge({ priority }: { priority: string }) {
  const { t } = useTranslation();
  return <Badge tone={PRIORITY_TONE[priority] ?? 'slate'}>{t(`priority.${priority}`)}</Badge>;
}

export function Spinner() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 p-6 text-slate-500" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t('common.loading')}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {message}
    </div>
  );
}

/** Distingue siempre si los datos son sintéticos, experimentales o de una integración autorizada. */
export function DataOriginBanner({ origin }: { origin: DataOrigin }) {
  const { t } = useTranslation();
  return (
    <div className="mb-4 flex items-center gap-2 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200">
      <FlaskConical className="h-4 w-4 shrink-0" aria-hidden /> {t(`dataOrigin.${origin}`)}
    </div>
  );
}

export const inputClass =
  'rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900';

/** Diálogo para capturar el motivo o la justificación de una operación (queda registrado en auditoría). */
export function ReasonDialog({
  title, label, minLength = 5, onConfirm, onCancel,
}: { title: string; label: string; minLength?: number; onConfirm: (reason: string) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-lg dark:bg-slate-900">
        <h2 className="mb-2 font-semibold">{title}</h2>
        <label className="block text-sm">
          {label}
          <textarea className={`${inputClass} mt-1 w-full`} rows={3} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        </label>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>{t('common.cancel')}</Button>
          <Button disabled={value.trim().length < minLength} onClick={() => onConfirm(value.trim())}>{t('common.confirm')}</Button>
        </div>
      </div>
    </div>
  );
}