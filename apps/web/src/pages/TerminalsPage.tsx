import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Play } from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import type { InventoryRunResult, TerminalListItem } from '../lib/types';
import { Badge, Button, Card, ErrorBox, PageHeader, Spinner } from '../components/ui';

export function TerminalsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { dateTime, errorMessage } = useFormat();
  const queryClient = useQueryClient();
  const [result, setResult] = useState<InventoryRunResult | null>(null);

  const query = useQuery({ queryKey: ['terminals'], queryFn: () => api<TerminalListItem[]>('/terminals') });
  const run = useMutation({
    mutationFn: (id: string) => api<InventoryRunResult>(`/terminals/${id}/inventory`, { method: 'POST' }),
    onSuccess: (data) => {
      setResult(data);
      void queryClient.invalidateQueries();
    },
  });

  // Jerarquía regional: País → Tienda → Terminal POS.
  const tree = useMemo(() => {
    const countries = new Map<string, { name: string; stores: Map<string, { id: string; name: string; terminals: TerminalListItem[] }> }>();
    for (const term of query.data ?? []) {
      if (!countries.has(term.country.code)) countries.set(term.country.code, { name: term.country.name, stores: new Map() });
      const stores = countries.get(term.country.code)!.stores;
      if (!stores.has(term.store.code)) stores.set(term.store.code, { id: term.store.id, name: term.store.name, terminals: [] });
      stores.get(term.store.code)!.terminals.push(term);
    }
    return countries;
  }, [query.data]);

  if (query.isLoading) return <Spinner />;
  if (query.isError) return <ErrorBox message={errorMessage(query.error)} />;

  return (
    <>
      <PageHeader title={t('terminals.title')} />
      {run.isError && <div className="mb-4"><ErrorBox message={errorMessage(run.error)} /></div>}
      {result && (
        <Card className="mb-4">
          <h2 className="mb-2 font-semibold">{t('terminals.result.title')} — {result.hostname}</h2>
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-6">
            <div><dt className="text-slate-500">{t('terminals.state')}</dt><dd>{t(`terminals.result.status.${result.status}`)}</dd></div>
            <div><dt className="text-slate-500">{t('terminals.result.found')}</dt><dd>{result.certificatesFound}</dd></div>
            <div><dt className="text-slate-500">{t('terminals.result.new')}</dt><dd>{result.newCertificates}</dd></div>
            <div><dt className="text-slate-500">{t('terminals.result.changed')}</dt><dd>{result.changedCertificates}</dd></div>
            <div><dt className="text-slate-500">{t('terminals.result.missing')}</dt><dd>{result.missingCertificates}</dd></div>
            <div><dt className="text-slate-500">{t('terminals.result.alerts')}</dt><dd>{result.alertsCreated}</dd></div>
          </dl>
          {result.errors.length > 0 && (
            <ul className="mt-2 text-sm text-amber-700 dark:text-amber-400">
              {result.errors.map((e, i) => <li key={i}>{t('terminals.result.errors')}: {e.store} — {e.message}</li>)}
            </ul>
          )}
          {can('evidence:export') && (
            <div className="mt-3 flex items-center gap-2 text-sm">
              {t('terminals.result.download')}:
              {(['json', 'csv', 'md'] as const).map((f) => (
                <Button key={f} size="sm" variant="outline" onClick={() => void downloadFile(`/inventory/scans/${result.scanId}/evidence?format=${f}`, `evidencia.${f}`)}>
                  {f.toUpperCase()}
                </Button>
              ))}
            </div>
          )}
        </Card>
      )}

      {[...tree.entries()].map(([code, country]) => (
        <Card key={code} className="mb-4">
          <h2 className="mb-2 text-lg font-semibold">{country.name} ({code})</h2>
          {[...country.stores.entries()].map(([storeCode, store]) => (
            <div key={storeCode} className="mb-3 overflow-x-auto">
              <div className="mb-1 flex items-center gap-3 text-sm font-medium">
                {storeCode} — {store.name}
                <Link className="text-xs text-sky-700 hover:underline dark:text-sky-400" to={`/certificados?storeId=${store.id}`}>{t('terminals.viewCertificates')}</Link>
              </div>
              <table className="w-full text-left text-sm">
                <thead className="text-slate-500">
                  <tr><th>{t('terminals.hostname')}</th><th>{t('terminals.model')}</th><th>{t('terminals.state')}</th><th>{t('terminals.certs')}</th><th>{t('terminals.lastInventory')}</th><th /></tr>
                </thead>
                <tbody>
                  {store.terminals.map((term) => (
                    <tr key={term.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="py-1">{term.hostname} {term.isSynthetic && <Badge tone="sky">{t('dataOrigin.badgeSynthetic')}</Badge>}</td>
                      <td>{term.model.vendor} {term.model.name}</td>
                      <td><Badge tone={term.status === 'ONLINE' ? 'green' : term.status === 'OFFLINE' ? 'red' : 'slate'}>{t(`terminals.states.${term.status}`)}</Badge></td>
                      <td>
                        {term.certificates.total}
                        {term.certificates.expired > 0 && <span className="ml-1 text-red-700 dark:text-red-400">({term.certificates.expired} {t('status.EXPIRED').toLowerCase()})</span>}
                        {term.certificates.expiringSoon > 0 && <span className="ml-1 text-amber-700 dark:text-amber-400">({term.certificates.expiringSoon} {t('status.EXPIRING_SOON').toLowerCase()})</span>}
                      </td>
                      <td>{term.lastInventoryAt ? dateTime(term.lastInventoryAt) : t('terminals.never')}</td>
                      <td className="text-right">
                        {can('inventory:run') && (
                          <Button size="sm" disabled={run.isPending} onClick={() => run.mutate(term.id)}>
                            <Play className="h-3 w-3" aria-hidden /> {run.isPending && run.variables === term.id ? t('terminals.running') : t('terminals.runInventory')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </Card>
      ))}
    </>
  );
}
