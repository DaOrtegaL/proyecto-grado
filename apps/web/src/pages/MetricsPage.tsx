import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import { Badge, Button, Card, ErrorBox, PageHeader, Spinner, inputClass } from '../components/ui';

const fmt = (v: number | null | undefined, n: (x: number) => string) => (v === null || v === undefined ? '—' : n(Math.round(v * 100) / 100));
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

function SusForm() {
  const { t } = useTranslation();
  const { errorMessage } = useFormat();
  const qc = useQueryClient();
  const [answers, setAnswers] = useState<number[]>(Array(10).fill(0));
  const [role, setRole] = useState('Consulta');
  const questions = useQuery({ queryKey: ['sus-q'], queryFn: () => api<{ questions: string[] }>('/sus/questions') });
  const submit = useMutation({ mutationFn: () => api<{ score: number }>('/sus', { method: 'POST', body: JSON.stringify({ respondentRole: role, answers }) }), onSuccess: () => { setAnswers(Array(10).fill(0)); void qc.invalidateQueries(); } });
  return (
    <Card>
      <h2 className="mb-1 font-semibold">{t('metrics.sus')}</h2>
      <p className="mb-2 text-xs text-slate-500">{t('metrics.scale')}</p>
      {submit.isError && <ErrorBox message={errorMessage(submit.error)} />}
      {submit.data && <div role="status" className="mb-2 text-sm">SUS: {submit.data.score}</div>}
      <form onSubmit={(e) => { e.preventDefault(); submit.mutate(); }} className="space-y-2">
        {(questions.data?.questions ?? []).map((q, i) => (
          <fieldset key={i} className="text-sm">
            <legend>{i + 1}. {q}</legend>
            <div className="flex gap-3">
              {[1, 2, 3, 4, 5].map((v) => (
                <label key={v} className="flex items-center gap-1"><input type="radio" name={`q${i}`} checked={answers[i] === v} onChange={() => setAnswers(answers.map((a, j) => (j === i ? v : a)))} />{v}</label>
              ))}
            </div>
          </fieldset>
        ))}
        <input className={inputClass} value={role} onChange={(e) => setRole(e.target.value)} aria-label="Rol" />
        <Button type="submit" disabled={answers.includes(0) || submit.isPending}>{t('metrics.susSubmit')}</Button>
      </form>
    </Card>
  );
}

export function MetricsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { dateTime, number, errorMessage } = useFormat();
  const qc = useQueryClient();
  const [form, setForm] = useState({ kind: 'BASELINE', label: '', periodStart: localInput(new Date(Date.now() - 30 * 86_400_000)), periodEnd: localInput(new Date()) });
  const [pair, setPair] = useState({ baselineId: '', pilotId: '' });

  const current = useQuery({ queryKey: ['metrics-current'], queryFn: () => api<any>('/metrics/current') });
  const targets = useQuery({ queryKey: ['metrics-targets'], queryFn: () => api<any[]>('/metrics/targets') });
  const snapshots = useQuery({ queryKey: ['snapshots'], queryFn: () => api<any[]>('/metrics/snapshots') });
  const comparison = useQuery({ queryKey: ['comparison', pair], queryFn: () => api<any>(`/metrics/comparison?baselineId=${pair.baselineId}&pilotId=${pair.pilotId}`), enabled: !!pair.baselineId && !!pair.pilotId });
  const sus = useQuery({ queryKey: ['sus-results'], queryFn: () => api<any>('/sus/results') });
  const incidents = useQuery({ queryKey: ['incidents'], queryFn: () => api<any[]>('/incidents') });
  const save = useMutation({
    mutationFn: () => api('/metrics/snapshots', { method: 'POST', body: JSON.stringify({ ...form, periodStart: new Date(form.periodStart).toISOString(), periodEnd: new Date(form.periodEnd).toISOString() }) }),
    onSuccess: () => void qc.invalidateQueries(),
  });

  if (current.isLoading) return <Spinner />;
  if (current.isError) return <ErrorBox message={errorMessage(current.error)} />;
  const targetFor = (code: string) => targets.data?.find((x) => x.metricCode === code);
  const baselines = (snapshots.data ?? []).filter((s) => s.kind === 'BASELINE');
  const pilots = (snapshots.data ?? []).filter((s) => s.kind === 'PILOT');

  return (
    <>
      <PageHeader title={t('metrics.title')} />
      <Card className="mb-4 overflow-x-auto p-0">
        <h2 className="p-3 font-semibold">{t('metrics.current')}</h2>
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><tr>{['indicator', 'value', 'sample', 'target'].map((k) => <th key={k} className="px-3 py-2 font-medium">{t(`metrics.${k}`)}</th>)}</tr></thead>
          <tbody>
            {current.data.metrics.map((m: any) => {
              const tg = targetFor(m.code);
              const met = tg && m.value !== null ? (tg.comparator === 'GTE' ? m.value >= tg.targetValue : m.value <= tg.targetValue) : null;
              return (
                <tr key={m.code} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2">{t(`metrics.names.${m.code}`)}</td>
                  <td className="px-3 font-medium">{fmt(m.value, number)}</td>
                  <td className="px-3">{m.sampleSize}{m.denominator ? ` (${m.numerator}/${m.denominator})` : ''}</td>
                  <td className="px-3">{tg ? <>{tg.comparator === 'GTE' ? '≥' : '≤'} {tg.targetValue} {met === null ? <Badge>{t('metrics.noData')}</Badge> : <Badge tone={met ? 'green' : 'amber'}>{met ? t('metrics.targetMet') : t('metrics.targetNotMet')}</Badge>} <span className="text-xs text-slate-500">({tg.approvalStatus})</span></> : t('metrics.noTarget')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-semibold">{t('metrics.snapshots')}</h2>
          <ul className="mb-3 space-y-1 text-sm">
            {(snapshots.data ?? []).map((s) => <li key={s.id}><Badge tone={s.kind === 'BASELINE' ? 'sky' : 'green'}>{t(`metrics.${s.kind}`)}</Badge> {s.label} — {dateTime(s.periodStart)} → {dateTime(s.periodEnd)} {s.isSynthetic && <Badge>{t('metrics.synthetic')}</Badge>}</li>)}
          </ul>
          {can('metrics:manage') && (
            <form className="grid gap-2 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
              <select className={inputClass} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} aria-label={t('metrics.kind')}><option value="BASELINE">{t('metrics.BASELINE')}</option><option value="PILOT">{t('metrics.PILOT')}</option></select>
              <input className={inputClass} placeholder={t('metrics.label')} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} required minLength={3} aria-label={t('metrics.label')} />
              <input className={inputClass} type="datetime-local" value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} aria-label={t('metrics.periodStart')} />
              <input className={inputClass} type="datetime-local" value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} aria-label={t('metrics.periodEnd')} />
              <Button type="submit" className="sm:col-span-2" disabled={save.isPending}>{t('metrics.save')}</Button>
              {save.isError && <div className="sm:col-span-2"><ErrorBox message={errorMessage(save.error)} /></div>}
            </form>
          )}
        </Card>
        <SusForm />
      </div>

      <Card className="mb-4 overflow-x-auto">
        <h2 className="mb-2 font-semibold">{t('metrics.compare')}</h2>
        <div className="mb-3 flex flex-wrap gap-2">
          <select className={inputClass} value={pair.baselineId} onChange={(e) => setPair({ ...pair, baselineId: e.target.value })} aria-label={t('metrics.baseline')}><option value="">{t('metrics.baseline')}</option>{baselines.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
          <select className={inputClass} value={pair.pilotId} onChange={(e) => setPair({ ...pair, pilotId: e.target.value })} aria-label={t('metrics.pilot')}><option value="">{t('metrics.pilot')}</option>{pilots.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
          {comparison.data && <Button variant="outline" onClick={() => void downloadFile(`/metrics/comparison/export?baselineId=${pair.baselineId}&pilotId=${pair.pilotId}`, 'observaciones-pareadas.csv')}><Download className="h-4 w-4" aria-hidden /> {t('metrics.export')}</Button>}
        </div>
        {comparison.isError && <ErrorBox message={errorMessage(comparison.error)} />}
        {comparison.data && (
          <>
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500"><tr>{['indicator', 'baseline', 'pilot', 'absolute', 'relative', 'sample', 'interpretation'].map((k) => <th key={k} className="py-1 pr-3 font-medium">{t(`metrics.${k}`)}</th>)}</tr></thead>
              <tbody>
                {comparison.data.rows.map((r: any) => (
                  <tr key={r.metricCode} className="border-t border-slate-100 align-top dark:border-slate-800">
                    <td className="py-1 pr-3">{t(`metrics.names.${r.metricCode}`)}</td>
                    <td className="pr-3">{fmt(r.baseline, number)}</td><td className="pr-3">{fmt(r.pilot, number)}</td>
                    <td className="pr-3">{fmt(r.absoluteChange, number)}</td><td className="pr-3">{r.relativeChange === null ? '—' : `${fmt(r.relativeChange, number)} %`}</td>
                    <td className="pr-3">{r.baselineSample} / {r.pilotSample}</td>
                    <td className="pr-3">{r.interpretation}<div className="text-xs text-slate-500">{r.limitations.join(' ')}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-slate-500">{comparison.data.statisticalNote}</p>
          </>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-semibold">{t('metrics.susResults')}</h2>
          <p className="text-sm">{sus.data ? t('metrics.susMean', { value: fmt(sus.data.mean, number), count: sus.data.count }) : ''}</p>
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">{t('metrics.incidents')}</h2>
          <ul className="space-y-1 text-sm">{(incidents.data ?? []).map((i) => <li key={i.id}><Badge tone={i.severity === 'P1' ? 'red' : 'orange'}>{i.severity}</Badge> {i.title} — {dateTime(i.occurredAt)} ({t(`metrics.${i.period}`)}){i.isSynthetic ? ` · ${t('metrics.synthetic')}` : ''}</li>)}</ul>
        </Card>
      </div>
    </>
  );
}
