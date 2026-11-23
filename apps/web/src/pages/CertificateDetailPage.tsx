import { Link, useNavigate, useParams } from 'react-router-dom';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import type { CertificateDetail } from '../lib/types';
import { Badge, Button, Card, ErrorBox, PageHeader, PriorityBadge, Spinner, StatusBadge, inputClass } from '../components/ui';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="break-all text-sm">{children}</dd>
    </div>
  );
}

export function CertificateDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { can } = useAuth();
  const navigate = useNavigate();
  const { dateTime, errorMessage } = useFormat();
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const renew = useMutation({
    mutationFn: () => api('/renewals', { method: 'POST', body: JSON.stringify({ certificateId: id, terminalIds: selected, reason: reason || undefined }) }),
    onSuccess: () => navigate('/renovaciones'),
  });
  const query = useQuery({ queryKey: ['certificate', id], queryFn: () => api<CertificateDetail>(`/certificates/${id}`) });

  if (query.isLoading) return <Spinner />;
  if (query.isError) return <ErrorBox message={errorMessage(query.error)} />;
  const c = query.data!;

  return (
    <>
      <PageHeader
        title={t('certificates.detailTitle')}
        actions={<Link className="text-sm text-sky-700 hover:underline dark:text-sky-400" to="/certificados">← {t('common.back')}</Link>}
      />
      <Card className="mb-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{c.subject}</h2>
          <StatusBadge status={c.status} />
          {c.isSynthetic && <Badge tone="sky">{t('dataOrigin.badgeSynthetic')}</Badge>}
        </div>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t('certificates.thumbprint')}>{c.thumbprintSha256}</Field>
          <Field label={t('certificates.serial')}>{c.serialNumber}</Field>
          <Field label={t('certificates.issuer')}>{c.issuer?.name ?? c.issuerDn}</Field>
          <Field label={t('certificates.validFrom')}>{dateTime(c.notBefore)}</Field>
          <Field label={t('certificates.validTo')}>{dateTime(c.notAfter)} ({t('common.days', { count: c.daysRemaining ?? 0 })})</Field>
          <Field label={t('certificates.keyAlgorithm')}>{c.publicKeyAlgorithm}</Field>
          <Field label={t('certificates.keySize')}>{c.keySizeBits ?? '—'}</Field>
          <Field label={t('certificates.signatureAlgorithm')}>{c.signatureAlgorithm}</Field>
          <Field label={t('certificates.keyUsage')}>{c.keyUsage.join(', ') || '—'}</Field>
          <Field label={t('certificates.extendedKeyUsage')}>{c.extendedKeyUsage.join(', ') || '—'}</Field>
          <Field label={t('certificates.discoveredAt')}>{dateTime(c.discoveredAt)}</Field>
          <Field label={t('certificates.lastVerifiedAt')}>{dateTime(c.lastVerifiedAt)}</Field>
          <Field label={t('certificates.effectiveOwner')}>
            {c.effectiveOwner ? `${c.effectiveOwner.name} (${c.effectiveOwner.email}) — ${t(`certificates.ownerSource.${c.ownerSource}`)}` : t('common.unassigned')}
          </Field>
        </dl>
      </Card>

      <Card className="mb-4 overflow-x-auto">
        <h3 className="mb-2 font-semibold">{t('certificates.installations')}</h3>
        <table className="w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr><th>{t('terminals.hostname')}</th><th>{t('alerts.store')}</th><th>{t('certificates.country')}</th><th>{t('certificates.store')}</th><th>{t('certificates.privateKey')}</th><th>{t('terminals.state')}</th></tr>
          </thead>
          <tbody>
            {c.installations.map((i) => (
              <tr key={i.id} className="border-t border-slate-100 dark:border-slate-800">
                <td>{i.terminal.hostname}</td>
                <td>{i.terminal.store.code}</td>
                <td>{i.terminal.store.country.name}</td>
                <td>{i.storeLocation}\{i.storeName}</td>
                <td>{i.hasPrivateKey ? t('common.yes') : t('common.no')}</td>
                <td>{t(`certificates.installationStatus.${i.status}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {can('renewals:create') && (
          <Card className="lg:col-span-2">
            <h3 className="mb-2 font-semibold">{t('renewals.request')}</h3>
            {renew.isError && <ErrorBox message={errorMessage(renew.error)} />}
            <fieldset className="mb-2 text-sm">
              <legend className="text-slate-500">{t('renewals.selectTerminals')}</legend>
              {c.installations.filter((i) => i.status === 'PRESENT').map((i) => (
                <label key={i.id} className="mr-4 inline-flex items-center gap-1">
                  <input type="checkbox" checked={selected.includes(i.terminal.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, i.terminal.id] : selected.filter((x) => x !== i.terminal.id))} />
                  {i.terminal.hostname}
                </label>
              ))}
            </fieldset>
            <div className="flex flex-wrap gap-2">
              <input className={`${inputClass} w-80`} placeholder={t('renewals.reason')} value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t('renewals.reason')} />
              <Button disabled={selected.length === 0 || renew.isPending} onClick={() => renew.mutate()}>{t('renewals.submit')}</Button>
            </div>
          </Card>
        )}
        <Card>
          <h3 className="mb-2 font-semibold">{t('certificates.alerts')}</h3>
          {c.alerts.length === 0 ? <p className="text-sm text-slate-500">{t('common.noData')}</p> : (
            <ul className="space-y-1 text-sm">
              {c.alerts.map((a) => (
                <li key={a.id} className="flex items-center gap-2">
                  <PriorityBadge priority={a.priority} />
                  <span>{a.thresholdDays === 0 ? t('alerts.expiredThreshold') : t('alerts.thresholdValue', { count: a.thresholdDays })}</span>
                  <span className="text-slate-500">{t(`alertStatus.${a.status}`)} · {dateTime(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h3 className="mb-2 font-semibold">{t('certificates.history')}</h3>
          <ul className="space-y-1 text-sm">
            {c.history.map((h) => (
              <li key={h.id}>{dateTime(h.createdAt)} — {t(`certificates.changes.${h.change}`, { defaultValue: h.change })}</li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
