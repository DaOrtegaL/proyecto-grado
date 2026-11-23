import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import type { AlertItem, Paged } from '../lib/types';
import { Badge, Button, Card, ErrorBox, PageHeader, PriorityBadge, Spinner } from '../components/ui';
import { cn } from '../lib/utils';

const TABS = ['active', 'RESOLVED', 'SUPERSEDED'] as const;

export function AlertsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { dateTime, errorMessage } = useFormat();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<(typeof TABS)[number]>('active');

  const qs = tab === 'active' ? 'pageSize=100' : `status=${tab}&pageSize=100`;
  const query = useQuery({ queryKey: ['alerts', tab], queryFn: () => api<Paged<AlertItem>>(`/alerts?${qs}`) });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'acknowledge' | 'resolve' }) =>
      api(`/alerts/${id}/${action}`, { method: 'POST', body: JSON.stringify({}) }),
    onSuccess: () => void queryClient.invalidateQueries(),
  });

  return (
    <>
      <PageHeader title={t('alerts.title')} />
      <div className="mb-3 flex gap-2" role="tablist">
        {TABS.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn('rounded-md px-3 py-1 text-sm', tab === k ? 'bg-sky-700 text-white' : 'bg-slate-200 dark:bg-slate-800')}
          >
            {t(`alerts.tabs.${k}`)}
          </button>
        ))}
      </div>
      {act.isError && <div className="mb-3"><ErrorBox message={errorMessage(act.error)} /></div>}
      {query.isLoading ? <Spinner /> : query.isError ? <ErrorBox message={errorMessage(query.error)} /> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <tr>
                {['priority', 'threshold', 'certificate', 'terminal', 'store', 'country', 'owner', 'status', 'created'].map((k) => (
                  <th key={k} className="px-3 py-2 font-medium">{t(`alerts.${k}`)}</th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {query.data!.items.length === 0 && <tr><td colSpan={10} className="p-6 text-center text-slate-500">{t('common.noData')}</td></tr>}
              {query.data!.items.map((a) => (
                <tr key={a.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2"><PriorityBadge priority={a.priority} /></td>
                  <td className="px-3">{a.thresholdDays === 0 ? t('alerts.expiredThreshold') : t('alerts.thresholdValue', { count: a.thresholdDays })}</td>
                  <td className="px-3"><Link className="text-sky-700 hover:underline dark:text-sky-400" to={`/certificados/${a.certificate.id}`}>{a.certificate.subject}</Link></td>
                  <td className="px-3">{a.terminal.hostname}</td>
                  <td className="px-3">{a.terminal.store.code}</td>
                  <td className="px-3">{a.terminal.store.country.name}</td>
                  <td className="px-3">{a.owner ? a.owner.name : <Badge tone="amber">{t('alerts.noOwnerWarning')}</Badge>}</td>
                  <td className="px-3">{t(`alertStatus.${a.status}`)}</td>
                  <td className="px-3">{dateTime(a.createdAt)}</td>
                  <td className="space-x-1 px-3 text-right whitespace-nowrap">
                    {can('alerts:manage') && a.status === 'OPEN' && (
                      <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate({ id: a.id, action: 'acknowledge' })}>{t('alerts.acknowledge')}</Button>
                    )}
                    {can('alerts:manage') && (a.status === 'OPEN' || a.status === 'ACKNOWLEDGED') && (
                      <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ id: a.id, action: 'resolve' })}>{t('alerts.resolve')}</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
