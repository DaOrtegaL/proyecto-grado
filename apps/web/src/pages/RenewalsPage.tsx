import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import { Badge, Button, Card, ErrorBox, PageHeader, ReasonDialog, Spinner, inputClass } from '../components/ui';

const TONE: Record<string, 'green' | 'amber' | 'red' | 'slate' | 'sky'> = {
  COMPLETED: 'green', VERIFIED: 'green', APPROVED: 'green', REJECTED: 'red', FAILED: 'red', CANCELLED: 'slate', ROLLED_BACK: 'amber',
};

export function RenewalStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return <Badge tone={TONE[status] ?? 'sky'}>{t(`renewalStatus.${status}`)}</Badge>;
}

function RenewalDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { dateTime, errorMessage } = useFormat();
  const qc = useQueryClient();
  const [windowId, setWindowId] = useState('');
  const [justification, setJustification] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const query = useQuery({ queryKey: ['renewal', id], queryFn: () => api<any>(`/renewals/${id}`) });
  const windows = useQuery({ queryKey: ['windows'], queryFn: () => api<any[]>('/maintenance-windows'), enabled: can('deployments:read') });
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api(`/renewals/${id}/${path}`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
    onSuccess: () => void qc.invalidateQueries(),
  });

  if (query.isLoading) return <Spinner />;
  if (query.isError) return <ErrorBox message={errorMessage(query.error)} />;
  const r = query.data;
  const activeWindows = (windows.data ?? []).filter((w) => w.isActive && new Date(w.endsAt) > new Date());

  return (
    <Card className="mb-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">{r.certificate.subject} <RenewalStatusBadge status={r.status} /></h2>
        <Button variant="ghost" size="sm" onClick={onClose}>{t('renewals.close')}</Button>
      </div>
      {act.isError && <div className="mb-2"><ErrorBox message={errorMessage(act.error)} /></div>}
      <div className="mb-3 flex flex-wrap gap-2">
        {r.status === 'REQUESTED' && can('renewals:create') && <Button onClick={() => act.mutate({ path: 'request-issuance' })}>{t('renewals.requestIssuance')}</Button>}
        {r.status === 'PENDING_ISSUANCE' && can('renewals:issue') && <Button onClick={() => act.mutate({ path: 'issue' })}>{t('renewals.issue')}</Button>}
        {r.allowedTransitions.includes('CANCELLED') && can('renewals:create') && <Button variant="outline" onClick={() => setCancelling(true)}>{t('renewals.cancel')}</Button>}
      </div>
      {r.status === 'ISSUED' && can('renewals:create') && (
        <div className="mb-3 grid gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-3 dark:border-slate-800">
          <label className="text-sm">{t('renewals.window')}
            <select className={`${inputClass} mt-1 w-full`} value={windowId} onChange={(e) => setWindowId(e.target.value)}>
              <option value="">—</option>
              {activeWindows.map((w) => <option key={w.id} value={w.id}>{w.name} ({dateTime(w.startsAt)} → {dateTime(w.endsAt)})</option>)}
            </select>
            {activeWindows.length === 0 && <span className="text-xs text-amber-700">{t('renewals.noWindows')}</span>}
          </label>
          <label className="text-sm sm:col-span-2">{t('renewals.justification')}
            <input className={`${inputClass} mt-1 w-full`} value={justification} onChange={(e) => setJustification(e.target.value)} />
          </label>
          <Button disabled={!windowId || justification.length < 10} onClick={() => act.mutate({ path: 'request-approval', body: { maintenanceWindowId: windowId, justification } })}>{t('renewals.requestApproval')}</Button>
        </div>
      )}
      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        <div><dt className="text-slate-500">{t('renewals.requestedBy')}</dt><dd>{r.requestedBy}</dd></div>
        <div><dt className="text-slate-500">{t('renewals.created')}</dt><dd>{dateTime(r.createdAt)}</dd></div>
        <div><dt className="text-slate-500">{t('renewals.targets')}</dt><dd>{r.targets.map((x: any) => x.terminal.hostname).join(', ')}</dd></div>
        <div className="sm:col-span-3"><dt className="text-slate-500">{t('renewals.allowed')}</dt><dd>{r.allowedTransitions.map((s: string) => t(`renewalStatus.${s}`)).join(', ') || '—'}</dd></div>
      </dl>
      {r.issuanceEvidence && (
        <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium">{t('renewals.evidence')}</summary>
          <pre className="mt-1 overflow-x-auto rounded bg-slate-100 p-2 text-xs dark:bg-slate-800">{JSON.stringify(r.issuanceEvidence, null, 2)}</pre>
        </details>
      )}
      <h3 className="mt-3 font-medium">{t('renewals.timeline')}</h3>
      <ul className="mt-1 space-y-1 text-sm">
        {r.timeline.map((e: any) => <li key={e.sequence}>{dateTime(e.occurredAt)} — {t(`audit.actions.${e.action}`, { defaultValue: e.action })} — {t(`audit.results.${e.result}`)}{e.actor ? ` — ${e.actor}` : ''}{e.reason ? ` (${e.reason})` : ''}</li>)}
      </ul>
      {cancelling && <ReasonDialog title={t('renewals.cancel')} label={t('common.reason')} onCancel={() => setCancelling(false)} onConfirm={(reason) => { setCancelling(false); act.mutate({ path: 'cancel', body: { reason } }); }} />}
    </Card>
  );
}

export function RenewalsPage() {
  const { t } = useTranslation();
  const { dateTime, errorMessage } = useFormat();
  const [selected, setSelected] = useState<string | null>(null);
  const query = useQuery({ queryKey: ['renewals'], queryFn: () => api<{ items: any[]; total: number }>('/renewals?pageSize=100') });

  return (
    <>
      <PageHeader title={t('renewals.title')} />
      {selected && <RenewalDetail id={selected} onClose={() => setSelected(null)} />}
      {query.isLoading ? <Spinner /> : query.isError ? <ErrorBox message={errorMessage(query.error)} /> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <tr>{['certificate', 'status', 'requestedBy', 'targets', 'created'].map((k) => <th key={k} className="px-3 py-2 font-medium">{t(`renewals.${k}`)}</th>)}<th /></tr>
            </thead>
            <tbody>
              {query.data!.items.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-500">{t('common.noData')}</td></tr>}
              {query.data!.items.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2">{r.certificate.subject}</td>
                  <td className="px-3"><RenewalStatusBadge status={r.status} /></td>
                  <td className="px-3">{r.requestedBy}</td>
                  <td className="px-3">{r.targets.map((x: any) => x.hostname).join(', ')}</td>
                  <td className="px-3">{dateTime(r.createdAt)}</td>
                  <td className="px-3 text-right"><Button size="sm" variant="outline" onClick={() => setSelected(r.id)}>{t('renewals.view')}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
