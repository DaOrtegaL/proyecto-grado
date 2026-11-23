import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import { Badge, Button, Card, ErrorBox, PageHeader, ReasonDialog, Spinner } from '../components/ui';
import { cn } from '../lib/utils';

const TONE: Record<string, 'green' | 'amber' | 'red' | 'slate'> = { APPROVED: 'green', PENDING: 'amber', REJECTED: 'red', INVALIDATED: 'red', EXPIRED: 'slate' };

export function ApprovalsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { dateTime, errorMessage } = useFormat();
  const qc = useQueryClient();
  const [tab, setTab] = useState<string>('PENDING');
  const [deciding, setDeciding] = useState<{ id: string; decision: 'APPROVED' | 'REJECTED' } | null>(null);

  const query = useQuery({ queryKey: ['approvals', tab], queryFn: () => api<any[]>(`/approvals?status=${tab}`) });
  const decide = useMutation({
    mutationFn: (v: { id: string; decision: string; justification: string }) => api(`/approvals/${v.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: v.decision, justification: v.justification }) }),
    onSettled: () => void qc.invalidateQueries(),
  });

  return (
    <>
      <PageHeader title={t('approvals.title')} />
      <p className="mb-3 text-sm text-slate-500">{t('approvals.sodNote')}</p>
      <div className="mb-3 flex gap-2" role="tablist">
        {['PENDING', 'APPROVED', 'REJECTED', 'INVALIDATED', 'EXPIRED'].map((s) => (
          <button key={s} role="tab" aria-selected={tab === s} onClick={() => setTab(s)} className={cn('rounded-md px-3 py-1 text-sm', tab === s ? 'bg-sky-700 text-white' : 'bg-slate-200 dark:bg-slate-800')}>{t(`approvalStatus.${s}`)}</button>
        ))}
      </div>
      {decide.isError && <div className="mb-3"><ErrorBox message={errorMessage(decide.error)} /></div>}
      {query.isLoading ? <Spinner /> : query.isError ? <ErrorBox message={errorMessage(query.error)} /> : (
        <div className="space-y-3">
          {query.data!.length === 0 && <Card><p className="text-sm text-slate-500">{t('common.noData')}</p></Card>}
          {query.data!.map((a) => (
            <Card key={a.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{a.certificate}</div>
                  <div className="text-sm text-slate-500">{t('approvals.terminals')}: {a.terminals.join(', ')} · {t('approvals.window')}: {a.maintenanceWindow?.name} ({dateTime(a.maintenanceWindow?.startsAt)} → {dateTime(a.maintenanceWindow?.endsAt)})</div>
                  <div className="text-sm text-slate-500">{t('approvals.requestedBy')}: {a.requestedBy} · {t('approvals.expires')}: {dateTime(a.expiresAt)}</div>
                  <div className="mt-1 text-sm">{a.justification}</div>
                  {a.invalidatedReason && <div className="text-sm text-red-700 dark:text-red-400">{t('approvals.invalidated')}: {a.invalidatedReason}</div>}
                  {a.decisions.map((d: any, i: number) => <div key={i} className="text-sm">{t('approvals.decisions')}: {d.decider} — {d.decision} — {d.justification}</div>)}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Badge tone={TONE[a.status] ?? 'slate'}>{t(`approvalStatus.${a.status}`)}</Badge>
                  {a.status === 'PENDING' && can('approvals:decide') && (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => setDeciding({ id: a.id, decision: 'APPROVED' })}>{t('approvals.approve')}</Button>
                      <Button size="sm" variant="danger" onClick={() => setDeciding({ id: a.id, decision: 'REJECTED' })}>{t('approvals.reject')}</Button>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {deciding && <ReasonDialog title={deciding.decision === 'APPROVED' ? t('approvals.approve') : t('approvals.reject')} label={t('approvals.justification')} onCancel={() => setDeciding(null)} onConfirm={(justification) => { decide.mutate({ ...deciding, justification }); setDeciding(null); }} />}
    </>
  );
}
