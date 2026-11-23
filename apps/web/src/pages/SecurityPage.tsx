import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import { Badge, Button, Card, ErrorBox, PageHeader, PriorityBadge, ReasonDialog, Spinner } from '../components/ui';
import { cn } from '../lib/utils';

export function SecurityPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { dateTime, errorMessage } = useFormat();
  const qc = useQueryClient();
  const [tab, setTab] = useState('OPEN');
  const [closing, setClosing] = useState<{ id: string; action: 'resolve' | 'dismiss' } | null>(null);

  const query = useQuery({ queryKey: ['findings', tab], queryFn: () => api<any>(`/security/findings?status=${tab}&pageSize=100`) });
  const close = useMutation({
    mutationFn: (v: { id: string; action: string; reason: string }) => api(`/security/findings/${v.id}/${v.action}`, { method: 'POST', body: JSON.stringify({ reason: v.reason }) }),
    onSettled: () => void qc.invalidateQueries(),
  });
  const evaluate = useMutation({ mutationFn: () => api<{ created: number; resolved: number }>('/security/evaluate', { method: 'POST' }), onSettled: () => void qc.invalidateQueries() });
  const error = close.error ?? evaluate.error ?? query.error;

  return (
    <>
      <PageHeader title={t('security.title')} actions={can('security:manage') && <Button variant="outline" disabled={evaluate.isPending} onClick={() => evaluate.mutate()}>{t('security.evaluate')}</Button>} />
      <p className="mb-3 text-sm text-slate-500">{t('security.disclaimer')}</p>
      {evaluate.data && <div role="status" className="mb-3 text-sm">{t('security.evaluated', evaluate.data)}</div>}
      {error && <div className="mb-3"><ErrorBox message={errorMessage(error)} /></div>}

      {query.data && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Card><div className="text-sm text-slate-500">{t('security.open')}</div><div className="text-3xl font-semibold">{query.data.summary.open}</div></Card>
          {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((s) => <Card key={s}><div className="text-sm text-slate-500">{t(`priority.${s}`)}</div><div className="text-3xl font-semibold">{query.data.summary.bySeverity[s] ?? 0}</div></Card>)}
        </div>
      )}
      <div className="mb-3 flex gap-2" role="tablist">
        {['OPEN', 'RESOLVED', 'DISMISSED'].map((s) => (
          <button key={s} role="tab" aria-selected={tab === s} onClick={() => setTab(s)} className={cn('rounded-md px-3 py-1 text-sm', tab === s ? 'bg-sky-700 text-white' : 'bg-slate-200 dark:bg-slate-800')}>{t(`security.statuses.${s}`)}</button>
        ))}
      </div>
      {query.isLoading ? <Spinner /> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <tr>{['severity', 'type', 'terminal', 'detail', 'recommendation'].map((k) => <th key={k} className="px-3 py-2 font-medium">{t(`security.${k}`)}</th>)}<th /></tr>
            </thead>
            <tbody>
              {(query.data?.items ?? []).length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-500">{t('common.noData')}</td></tr>}
              {(query.data?.items ?? []).map((f: any) => (
                <tr key={f.id} className="border-t border-slate-100 align-top dark:border-slate-800">
                  <td className="px-3 py-2"><PriorityBadge priority={f.severity} /></td>
                  <td className="px-3"><Badge>{t(`security.types.${f.type}`)}</Badge></td>
                  <td className="px-3">{f.terminal?.hostname ?? '—'}<div className="text-xs text-slate-500">{dateTime(f.detectedAt)}</div></td>
                  <td className="px-3">{f.detail}</td>
                  <td className="px-3">{f.recommendation}</td>
                  <td className="space-x-1 px-3 text-right whitespace-nowrap">
                    {f.status === 'OPEN' && can('security:manage') && (
                      <>
                        <Button size="sm" onClick={() => setClosing({ id: f.id, action: 'resolve' })}>{t('security.resolve')}</Button>
                        <Button size="sm" variant="outline" onClick={() => setClosing({ id: f.id, action: 'dismiss' })}>{t('security.dismiss')}</Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {closing && <ReasonDialog title={t(`security.${closing.action}`)} label={t('security.reason')} onCancel={() => setClosing(null)} onConfirm={(reason) => { close.mutate({ ...closing, reason }); setClosing(null); }} />}
    </>
  );
}
