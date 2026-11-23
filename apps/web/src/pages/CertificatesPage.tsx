import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Download } from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import type { CertificateListItem, Paged } from '../lib/types';
import { Badge, Button, Card, ErrorBox, PageHeader, Spinner, StatusBadge, inputClass } from '../components/ui';

const col = createColumnHelper<CertificateListItem>();
const COUNTRIES = ['AR', 'BR', 'CL', 'CO', 'MX', 'PE'];

export function CertificatesPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { date, errorMessage } = useFormat();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const page = Number(params.get('page') ?? 1);
  const status = params.get('status') ?? '';
  const countryCode = params.get('countryCode') ?? '';
  const storeId = params.get('storeId') ?? '';
  const appliedSearch = params.get('search') ?? '';

  const qs = new URLSearchParams({ page: String(page), pageSize: '25', sortBy: 'notAfter', sortDir });
  if (appliedSearch) qs.set('search', appliedSearch);
  if (status) qs.set('status', status);
  if (countryCode) qs.set('countryCode', countryCode);
  if (storeId) qs.set('storeId', storeId);

  const query = useQuery({
    queryKey: ['certificates', qs.toString()],
    queryFn: () => api<Paged<CertificateListItem>>(`/certificates?${qs}`),
    placeholderData: keepPreviousData,
  });

  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    Object.entries({ page: '1', ...changes }).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next);
  };

  const columns = [
    col.accessor('subject', {
      header: t('certificates.subject'),
      cell: (c) => (
        <Link className="font-medium text-sky-700 hover:underline dark:text-sky-400" to={`/certificados/${c.row.original.id}`}>
          {c.getValue()}
        </Link>
      ),
    }),
    col.display({
      id: 'issuer',
      header: t('certificates.issuer'),
      cell: (c) => c.row.original.issuer?.name ?? <Badge tone="amber">{t('certificates.unregisteredIssuer')}</Badge>,
    }),
    col.display({
      id: 'owner',
      header: t('certificates.owner'),
      cell: (c) => c.row.original.owner?.name ?? <span className="text-slate-500">{t('common.unassigned')}</span>,
    }),
    col.accessor('notAfter', {
      header: () => (
        <button className="inline-flex items-center gap-1" onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}>
          {t('certificates.expires')} {sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
        </button>
      ),
      cell: (c) => date(c.getValue()),
    }),
    col.accessor('daysRemaining', { header: t('certificates.remaining'), cell: (c) => c.getValue() ?? '—' }),
    col.accessor('status', { header: t('certificates.status'), cell: (c) => <StatusBadge status={c.getValue()} /> }),
    col.display({
      id: 'terminals',
      header: t('certificates.terminals'),
      cell: (c) => {
        const inst = c.row.original.installations;
        return `${inst.length}${inst[0] ? ` (${inst[0].hostname}${inst.length > 1 ? '…' : ''})` : ''}`;
      },
    }),
  ];

  const table = useReactTable({ data: query.data?.items ?? [], columns, getCoreRowModel: getCoreRowModel() });
  const pages = query.data ? Math.max(1, Math.ceil(query.data.total / query.data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title={t('certificates.title')}
        actions={
          can('certificates:export') && (
            <Button variant="outline" onClick={() => void downloadFile(`/certificates/export?${qs}`, 'inventario-certificados.csv')}>
              <Download className="h-4 w-4" aria-hidden /> {t('common.export')}
            </Button>
          )
        }
      />
      <Card className="mb-4 flex flex-wrap items-end gap-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            update({ search });
          }}
        >
          <input className={`${inputClass} w-72`} placeholder={t('certificates.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t('common.search')} />
          <Button type="submit" variant="outline">{t('common.search')}</Button>
        </form>
        <select className={inputClass} value={status} onChange={(e) => update({ status: e.target.value })} aria-label={t('certificates.status')}>
          <option value="">{t('certificates.status')}: {t('common.all')}</option>
          {(['VALID', 'EXPIRING_SOON', 'EXPIRED'] as const).map((s) => (
            <option key={s} value={s}>{t(`status.${s}`)}</option>
          ))}
        </select>
        <select className={inputClass} value={countryCode} onChange={(e) => update({ countryCode: e.target.value })} aria-label={t('certificates.country')}>
          <option value="">{t('certificates.country')}: {t('common.all')}</option>
          {COUNTRIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </Card>

      {query.isLoading ? (
        <Spinner />
      ) : query.isError ? (
        <ErrorBox message={errorMessage(query.error)} />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th key={h.id} className="px-3 py-2 font-medium">{flexRender(h.column.columnDef.header, h.getContext())}</th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.length === 0 && (
                <tr><td colSpan={columns.length} className="p-6 text-center text-slate-500">{t('common.noData')}</td></tr>
              )}
              {table.getRowModel().rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                  {r.getVisibleCells().map((c) => (
                    <td key={c.id} className="px-3 py-2">{flexRender(c.column.columnDef.cell, c.getContext())}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-slate-200 p-3 text-sm dark:border-slate-800">
            <span>{t('common.total', { count: query.data!.total })}</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>{t('common.previous')}</Button>
              <span>{t('common.page', { page, pages })}</span>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => update({ page: String(page + 1) })}>{t('common.next')}</Button>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
