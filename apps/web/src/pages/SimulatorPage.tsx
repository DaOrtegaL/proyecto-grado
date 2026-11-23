import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Play } from 'lucide-react';
import { api } from '../lib/api';
import { useFormat } from '../lib/format';
import { Badge, Button, Card, ErrorBox, PageHeader, Spinner } from '../components/ui';

export function SimulatorPage() {
  const { t } = useTranslation();
  const { dateTime, errorMessage } = useFormat();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['scenarios'], queryFn: () => api<any[]>('/simulator/scenarios') });
  const done = () => void qc.invalidateQueries();
  const runOne = useMutation({ mutationFn: (code: string) => api('/simulator/scenarios/run', { method: 'POST', body: JSON.stringify({ code }) }), onSettled: done });
  const runAll = useMutation({ mutationFn: () => api<any[]>('/simulator/scenarios/run-all', { method: 'POST' }), onSettled: done });

  if (query.isLoading) return <Spinner />;
  if (query.isError) return <ErrorBox message={errorMessage(query.error)} />;
  const busy = runOne.isPending || runAll.isPending;

  return (
    <>
      <PageHeader title={t('simulator.title')} actions={<Button disabled={busy} onClick={() => runAll.mutate()}><Play className="h-4 w-4" aria-hidden /> {runAll.isPending ? t('simulator.running') : t('simulator.runAll')}</Button>} />
      <p className="mb-3 text-sm text-slate-500">{t('simulator.intro')}</p>
      {(runOne.isError || runAll.isError) && <div className="mb-3"><ErrorBox message={errorMessage(runOne.error ?? runAll.error)} /></div>}
      {runAll.data && <div role="status" className="mb-3 text-sm">{t('simulator.summary', { passed: runAll.data.filter((r) => r.status === 'PASSED').length, total: runAll.data.length })}</div>}
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><tr><th className="px-3 py-2">{t('simulator.code')}</th><th>{t('simulator.requirement')}</th><th>{t('simulator.last')}</th><th /></tr></thead>
          <tbody>
            {query.data!.map((s) => (
              <tr key={s.code} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2"><span className="font-mono text-xs">{s.code}</span> {s.name}</td>
                <td>{s.requirement}</td>
                <td>{s.lastRun ? <><Badge tone={s.lastRun.status === 'PASSED' ? 'green' : 'red'}>{t(`research.runStatuses.${s.lastRun.status}`)}</Badge> <span className="text-xs text-slate-500">{dateTime(s.lastRun.ranAt)} — {s.lastRun.obtainedResult}</span></> : <span className="text-slate-500">{t('simulator.never')}</span>}</td>
                <td className="px-3 text-right"><Button size="sm" variant="outline" disabled={busy} onClick={() => runOne.mutate(s.code)}>{t('simulator.run')}</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
