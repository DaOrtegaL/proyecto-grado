import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, downloadFile } from '../lib/api';
import { useFormat } from '../lib/format';
import { Badge, Button, Card, ErrorBox, PageHeader, Spinner } from '../components/ui';

export function ResearchPage() {
  const { t } = useTranslation();
  const { dateTime, errorMessage } = useFormat();
  const runs = useQuery({ queryKey: ['runs'], queryFn: () => api<any[]>('/research/runs') });
  const trace = useQuery({ queryKey: ['trace'], queryFn: () => api<any[]>('/traceability') });
  const trl = useQuery({ queryKey: ['trl'], queryFn: () => api<any>('/research/trl') });

  if (runs.isLoading || trace.isLoading) return <Spinner />;
  const error = runs.error ?? trace.error ?? trl.error;

  return (
    <>
      <PageHeader title={t('research.title')} />
      {error && <ErrorBox message={errorMessage(error)} />}

      {trl.data && (
        <Card className="mb-4">
          <h2 className="mb-1 font-semibold">{t('research.trl')}</h2>
          <p className="mb-2 text-sm text-slate-500">{t('research.trlStatement')}</p>
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500"><tr><th>{t('research.level')}</th><th>Criterio</th><th>{t('research.passed')}</th><th>{t('research.sufficient')}</th></tr></thead>
            <tbody>
              {trl.data.criteria.map((c: any) => (
                <tr key={c.level} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1">TRL {c.level}</td><td>{c.title}</td><td>{c.passedRuns} / {c.runs}</td>
                  <td>{c.level === 2 ? <Badge>{t('research.notDeclared')}</Badge> : <Badge tone={c.evidenceSufficient ? 'amber' : 'slate'}>{c.evidenceSufficient ? t('research.yes') : t('research.no')}</Badge>} {c.note && <span className="text-xs text-slate-500">{c.note}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card className="mb-4 overflow-x-auto p-0">
        <h2 className="p-3 font-semibold">{t('research.traceability')}</h2>
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><tr>{['requirement', 'objective', 'module', 'component', 'testCase', 'status'].map((k) => <th key={k} className="px-3 py-2 font-medium">{k === 'requirement' ? t('research.requirement') : t(`research.${k}`)}</th>)}</tr></thead>
          <tbody>
            {(trace.data ?? []).map((r) => (
              <tr key={r.id} className="border-t border-slate-100 align-top dark:border-slate-800">
                <td className="px-3 py-1 font-medium">{r.requirementCode}<div className="text-xs font-normal text-slate-500">{r.title}</div></td>
                <td className="px-3">{r.objectiveCode}</td><td className="px-3">{r.module}</td><td className="px-3">{r.component}</td><td className="px-3">{r.testCase ?? '—'}</td>
                <td className="px-3"><Badge tone={r.status === 'VALIDATED' ? 'green' : r.status === 'TESTED' ? 'sky' : r.status === 'NOT_STARTED' ? 'slate' : 'amber'}>{t(`research.statuses.${r.status}`)}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="overflow-x-auto p-0">
        <h2 className="p-3 font-semibold">{t('research.runs')}</h2>
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><tr>{['code', 'requirement', 'scenario', 'date', 'origin', 'status'].map((k) => <th key={k} className="px-3 py-2 font-medium">{t(`research.${k}`)}</th>)}<th /></tr></thead>
          <tbody>
            {(runs.data ?? []).length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-500">{t('common.noData')}</td></tr>}
            {(runs.data ?? []).map((r) => (
              <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-1 font-mono text-xs">{r.code}</td><td className="px-3">{r.requirementCode}</td><td className="px-3">{r.scenario}</td><td className="px-3">{dateTime(r.ranAt)}</td>
                <td className="px-3">{r.isSynthetic ? <Badge tone="sky">{t('metrics.synthetic')}</Badge> : '—'}</td>
                <td className="px-3"><Badge tone={r.status === 'PASSED' ? 'green' : r.status === 'FAILED' ? 'red' : 'slate'}>{t(`research.runStatuses.${r.status}`)}</Badge></td>
                <td className="space-x-1 px-3 text-right">{(['json', 'csv', 'md'] as const).map((f) => <Button key={f} size="sm" variant="outline" onClick={() => void downloadFile(`/research/runs/${r.id}/export?format=${f}`, `experimento.${f}`)}>{f.toUpperCase()}</Button>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
