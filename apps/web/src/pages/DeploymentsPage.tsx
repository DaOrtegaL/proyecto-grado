import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import { Badge, Button, Card, ErrorBox, PageHeader, ReasonDialog, Spinner, inputClass } from '../components/ui';

const JOB_TONE: Record<string, 'green' | 'amber' | 'red' | 'slate' | 'sky'> = { COMPLETED: 'green', FAILED: 'red', PARTIAL: 'amber', ROLLED_BACK: 'amber', CANCELLED: 'slate', RUNNING: 'sky' };
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function DeploymentsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { dateTime, errorMessage } = useFormat();
  const qc = useQueryClient();
  const [rollback, setRollback] = useState<{ jobId: string; targetId: string } | null>(null);
  const [approvalId, setApprovalId] = useState('');
  const [scheduledAt, setScheduledAt] = useState(localInput(new Date()));
  const [failure, setFailure] = useState('NONE');
  const [win, setWin] = useState({ name: '', startsAt: localInput(new Date()), endsAt: localInput(new Date(Date.now() + 4 * 3_600_000)) });

  const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => api<any[]>('/deployments') });
  const windows = useQuery({ queryKey: ['windows'], queryFn: () => api<any[]>('/maintenance-windows') });
  const approved = useQuery({ queryKey: ['approvals', 'APPROVED'], queryFn: () => api<any[]>('/approvals?status=APPROVED'), enabled: can('approvals:read') });

  const refresh = () => void qc.invalidateQueries();
  const createWindow = useMutation({ mutationFn: () => api('/maintenance-windows', { method: 'POST', body: JSON.stringify({ name: win.name, startsAt: new Date(win.startsAt).toISOString(), endsAt: new Date(win.endsAt).toISOString() }) }), onSuccess: refresh });
  const schedule = useMutation({ mutationFn: () => api('/deployments', { method: 'POST', body: JSON.stringify({ approvalId, scheduledAt: new Date(scheduledAt).toISOString(), idempotencyKey: crypto.randomUUID(), simulateFailure: failure }) }), onSuccess: refresh });
  const execute = useMutation({ mutationFn: (id: string) => api(`/deployments/${id}/execute`, { method: 'POST' }), onSettled: refresh });
  const doRollback = useMutation({ mutationFn: (v: { jobId: string; targetId: string; reason: string }) => api(`/deployments/${v.jobId}/rollback`, { method: 'POST', body: JSON.stringify({ targetId: v.targetId, reason: v.reason }) }), onSettled: refresh });
  const reconcile = useMutation({ mutationFn: () => api<{ reconciled: number }>('/deployments/reconcile', { method: 'POST' }), onSettled: refresh });

  const error = [createWindow, schedule, execute, doRollback, reconcile].find((m) => m.isError)?.error;
  const schedulable = (approved.data ?? []).filter((a) => a.renewalStatus === 'APPROVED');

  return (
    <>
      <PageHeader title={t('deployments.title')} actions={can('deployments:execute') && <Button variant="outline" onClick={() => reconcile.mutate()}>{t('deployments.reconcile')}</Button>} />
      <p className="mb-3 text-sm text-slate-500">{t('deployments.mode')}: {t('deployments.simulation')}. {t('deployments.labDisabled')}</p>
      {error && <div className="mb-3"><ErrorBox message={errorMessage(error)} /></div>}
      {reconcile.data && <div role="status" className="mb-3 text-sm">{t('deployments.reconciled', { count: reconcile.data.reconciled })}</div>}

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-semibold">{t('deployments.windows')}</h2>
          <ul className="mb-3 space-y-1 text-sm">
            {(windows.data ?? []).slice(0, 6).map((w) => <li key={w.id}>{w.name}: {dateTime(w.startsAt)} → {dateTime(w.endsAt)}</li>)}
          </ul>
          {can('maintenance:manage') && (
            <form className="grid gap-2 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); createWindow.mutate(); }}>
              <input className={inputClass} placeholder={t('deployments.name')} value={win.name} onChange={(e) => setWin({ ...win, name: e.target.value })} required minLength={3} aria-label={t('deployments.name')} />
              <input className={inputClass} type="datetime-local" value={win.startsAt} onChange={(e) => setWin({ ...win, startsAt: e.target.value })} aria-label={t('deployments.starts')} />
              <input className={inputClass} type="datetime-local" value={win.endsAt} onChange={(e) => setWin({ ...win, endsAt: e.target.value })} aria-label={t('deployments.ends')} />
              <Button type="submit" className="sm:col-span-3">{t('deployments.newWindow')}</Button>
            </form>
          )}
        </Card>
        {can('deployments:schedule') && (
          <Card>
            <h2 className="mb-2 font-semibold">{t('deployments.schedule')}</h2>
            {schedulable.length === 0 ? <p className="text-sm text-slate-500">{t('deployments.noApproved')}</p> : (
              <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); schedule.mutate(); }}>
                <select className={inputClass} value={approvalId} onChange={(e) => setApprovalId(e.target.value)} required aria-label={t('deployments.approval')}>
                  <option value="">{t('deployments.approval')}</option>
                  {schedulable.map((a) => <option key={a.id} value={a.id}>{a.certificate} — {a.terminals.join(', ')}</option>)}
                </select>
                <input className={inputClass} type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} aria-label={t('deployments.scheduledAt')} />
                {can('simulator:manage') && (
                  <select className={inputClass} value={failure} onChange={(e) => setFailure(e.target.value)} aria-label={t('deployments.simulateFailure')}>
                    {['NONE', 'INSTALL_FAILURE', 'VERIFICATION_FAILURE', 'ROLLBACK_FAILURE'].map((f) => <option key={f} value={f}>{t(`failureMode.${f}`)}</option>)}
                  </select>
                )}
                <Button type="submit" disabled={!approvalId}>{t('deployments.schedule')}</Button>
              </form>
            )}
          </Card>
        )}
      </div>

      <h2 className="mb-2 font-semibold">{t('deployments.jobs')}</h2>
      {jobs.isLoading ? <Spinner /> : jobs.isError ? <ErrorBox message={errorMessage(jobs.error)} /> : (
        <div className="space-y-3">
          {jobs.data!.length === 0 && <Card><p className="text-sm text-slate-500">{t('common.noData')}</p></Card>}
          {jobs.data!.map((j) => (
            <Card key={j.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium">{j.certificate}</div>
                  <div className="text-sm text-slate-500">{dateTime(j.scheduledAt)} · {j.maintenanceWindow?.name} · {t('deployments.mode')}: {t('deployments.simulation')}{j.simulateFailure !== 'NONE' ? ` · ${t(`failureMode.${j.simulateFailure}`)}` : ''}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={JOB_TONE[j.status] ?? 'slate'}>{t(`jobStatus.${j.status}`)}</Badge>
                  {j.status === 'SCHEDULED' && can('deployments:execute') && <Button size="sm" disabled={execute.isPending} onClick={() => execute.mutate(j.id)}>{t('deployments.execute')}</Button>}
                </div>
              </div>
              <table className="mt-2 w-full text-left text-sm">
                <thead className="text-slate-500"><tr><th>{t('deployments.targets')}</th><th>{t('deployments.status')}</th><th>{t('deployments.attempts')}</th><th>{t('deployments.verification')}</th><th /></tr></thead>
                <tbody>
                  {j.targets.map((tg: any) => (
                    <tr key={tg.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="py-1">{tg.hostname}</td>
                      <td>{t(`targetStatus.${tg.status}`)}</td>
                      <td>{tg.attempts.map((a: any) => `#${a.attemptNo} ${a.outcome}`).join(', ') || '—'}</td>
                      <td>{tg.verifications.map((v: any) => (v.passed ? t('deployments.passed') : t('deployments.notPassed'))).join(', ') || '—'}</td>
                      <td className="text-right">
                        {['FAILED', 'INSTALLED', 'ROLLBACK_FAILED'].includes(tg.status) && can('deployments:rollback') && (
                          <Button size="sm" variant="outline" onClick={() => setRollback({ jobId: j.id, targetId: tg.id })}>{t('deployments.rollback')}</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}
        </div>
      )}
      {rollback && <ReasonDialog title={t('deployments.rollback')} label={t('deployments.rollbackReason')} onCancel={() => setRollback(null)} onConfirm={(reason) => { doRollback.mutate({ ...rollback, reason }); setRollback(null); }} />}
    </>
  );
}
