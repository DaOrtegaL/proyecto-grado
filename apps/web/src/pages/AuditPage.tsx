import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import type { AuditItem, ChainVerification, Paged } from '../lib/types';
import { Button, Card, ErrorBox, PageHeader, Spinner } from '../components/ui';

export function AuditPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { dateTime, errorMessage } = useFormat();
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ['audit', page],
    queryFn: () => api<Paged<AuditItem>>(`/audit?page=${page}&pageSize=50`),
    placeholderData: keepPreviousData,
  });
  const verify = useMutation({ mutationFn: () => api<ChainVerification>('/audit/verify') });
  const pages = query.data ? Math.max(1, Math.ceil(query.data.total / query.data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title={t('audit.title')}
        actions={
          can('audit:verify') && (
            <Button variant="outline" disabled={verify.isPending} onClick={() => verify.mutate()}>
              <ShieldCheck className="h-4 w-4" aria-hidden /> {verify.isPending ? t('audit.verifying') : t('audit.verify')}
            </Button>
          )
        }
      />
      {verify.data && (
        <div role="status" className={`mb-3 rounded-md border p-3 text-sm ${verify.data.valid ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200' : 'border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200'}`}>
          {verify.data.valid
            ? t('audit.chainValid', { count: verify.data.checked })
            : t('audit.chainBroken', { sequence: verify.data.brokenAtSequence, reason: verify.data.reason })}
        </div>
      )}
      {verify.isError && <div className="mb-3"><ErrorBox message={errorMessage(verify.error)} /></div>}

      {query.isLoading ? <Spinner /> : query.isError ? <ErrorBox message={errorMessage(query.error)} /> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <tr>
                {['sequence', 'date', 'action', 'resource', 'result', 'reason', 'correlation'].map((k) => (
                  <th key={k} className="px-3 py-2 font-medium">{t(`audit.${k}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {query.data!.items.map((e) => (
                <tr key={e.sequence} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-1">{e.sequence}</td>
                  <td className="px-3">{dateTime(e.occurredAt)}</td>
                  <td className="px-3">{t(`audit.actions.${e.action}`, { defaultValue: e.action })}</td>
                  <td className="px-3">{e.resourceType}{e.resourceId ? ` / ${e.resourceId.slice(0, 8)}` : ''}</td>
                  <td className="px-3">{t(`audit.results.${e.result}`)}</td>
                  <td className="px-3">{e.reason ?? ''}</td>
                  <td className="px-3 font-mono text-xs">{e.correlationId.slice(0, 8)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-slate-200 p-3 text-sm dark:border-slate-800">
            <span>{t('common.total', { count: query.data!.total })}</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('common.previous')}</Button>
              <span>{t('common.page', { page, pages })}</span>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t('common.next')}</Button>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
