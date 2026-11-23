import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, downloadFile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import type { DashboardSummary } from '../lib/types';
import { Badge, Button, Card, DataOriginBanner, ErrorBox, PageHeader, Spinner } from '../components/ui';

const BUCKET_COLORS: Record<string, string> = {
  expired: '#b91c1c',
  d0_7: '#dc2626',
  d8_15: '#ea580c',
  d16_30: '#d97706',
  d31_60: '#ca8a04',
  d61_90: '#0284c7',
  d90_plus: '#059669',
};

function Kpi({ label, value, tone }: { label: string; value: number; tone?: 'red' | 'amber' | 'green' }) {
  const color = tone === 'red' ? 'text-red-700 dark:text-red-400' : tone === 'amber' ? 'text-amber-700 dark:text-amber-400' : tone === 'green' ? 'text-emerald-700 dark:text-emerald-400' : '';
  return (
    <Card>
      <div className="text-sm text-slate-500">{label}</div>
      <div className={`text-3xl font-semibold ${color}`}>{value}</div>
    </Card>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { dateTime, number, errorMessage } = useFormat();
  const query = useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardSummary>('/dashboard') });

  if (query.isLoading) return <Spinner />;
  if (query.isError) return <ErrorBox message={errorMessage(query.error)} />;
  const d = query.data!;

  return (
    <>
      <PageHeader title={t('dashboard.title')} />
      <DataOriginBanner origin={d.dataOrigin} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label={t('dashboard.countries')} value={d.totals.countries} />
        <Kpi label={t('dashboard.stores')} value={d.totals.stores} />
        <Kpi label={t('dashboard.terminals')} value={d.totals.terminals} />
        <Kpi label={t('dashboard.certificates')} value={d.totals.certificates} />
        <Kpi label={t('dashboard.activeAlerts')} value={d.totals.activeAlerts} tone={d.totals.activeAlerts ? 'amber' : undefined} />
        <Kpi label={t('dashboard.valid')} value={d.totals.valid} tone="green" />
        <Kpi label={t('dashboard.expiringSoon')} value={d.totals.expiringSoon} tone="amber" />
        <Kpi label={t('dashboard.expired')} value={d.totals.expired} tone="red" />
        <Kpi label={t('dashboard.unknown')} value={d.totals.unknown} />
        <Kpi label={t('dashboard.withoutOwner')} value={d.totals.withoutOwner} tone={d.totals.withoutOwner ? 'amber' : undefined} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-semibold">{t('dashboard.expiryDistribution')}</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={d.expiryBuckets.map((b) => ({ ...b, label: t(`dashboard.buckets.${b.bucket}`) }))}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" fontSize={11} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" name={t('dashboard.certificates')}>
                {d.expiryBuckets.map((b) => (
                  <Cell key={b.bucket} fill={BUCKET_COLORS[b.bucket]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">{t('dashboard.byCountry')}</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={d.certificatesByCountry}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#0369a1" name={t('dashboard.certificates')} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">{t('dashboard.byIssuer')}</h2>
          <ul className="space-y-1 text-sm">
            {d.certificatesByIssuer.map((i) => (
              <li key={i.name} className="flex justify-between">
                <span>{i.name}</span>
                <span className="font-medium">{number(i.count)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">{t('dashboard.alertsByPriority')}</h2>
          <ul className="space-y-1 text-sm">
            {d.alertsByPriority.map((a) => (
              <li key={a.priority} className="flex justify-between">
                <Badge tone={a.priority === 'CRITICAL' ? 'red' : a.priority === 'HIGH' ? 'orange' : a.priority === 'MEDIUM' ? 'amber' : 'sky'}>{t(`priority.${a.priority}`)}</Badge>
                <span className="font-medium">{a.count}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mt-4 overflow-x-auto">
        <h2 className="mb-2 font-semibold">{t('dashboard.recentScans')}</h2>
        {d.recentScans.length === 0 ? (
          <p className="text-sm text-slate-500">{t('common.noData')}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="py-1">{t('dashboard.terminal')}</th>
                <th>{t('dashboard.date')}</th>
                <th>{t('terminals.state')}</th>
                <th>{t('dashboard.found')}</th>
                <th>{t('dashboard.alertsCreated')}</th>
                {can('evidence:export') && <th>{t('dashboard.evidence')}</th>}
              </tr>
            </thead>
            <tbody>
              {d.recentScans.map((s) => (
                <tr key={s.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1">{s.hostname}</td>
                  <td>{dateTime(s.startedAt)}</td>
                  <td>{t(`terminals.result.status.${s.status}`)}</td>
                  <td>{s.certificatesFound}</td>
                  <td>{s.alertsCreated}</td>
                  {can('evidence:export') && (
                    <td className="space-x-1">
                      {(['json', 'csv', 'md'] as const).map((f) => (
                        <Button key={f} size="sm" variant="outline" onClick={() => void downloadFile(`/inventory/scans/${s.id}/evidence?format=${f}`, `evidencia.${f}`)}>
                          {f.toUpperCase()}
                        </Button>
                      ))}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
