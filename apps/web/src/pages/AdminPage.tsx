import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import { Badge, Button, Card, ErrorBox, PageHeader, ReasonDialog, Spinner, inputClass } from '../components/ui';
import { cn } from '../lib/utils';

const TABS = ['users', 'roles', 'owners', 'policies'] as const;

function OwnersTab() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { errorMessage } = useFormat();
  const qc = useQueryClient();
  const [newOwner, setNewOwner] = useState({ name: '', email: '' });
  const overview = useQuery({ queryKey: ['owners'], queryFn: () => api<any>('/owners') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['owners'] });
  const assign = useMutation({ mutationFn: (v: { scope: string; targetId: string; ownerId: string | null }) => api('/owners/assign', { method: 'POST', body: JSON.stringify(v) }), onSuccess: refresh });
  const create = useMutation({ mutationFn: () => api('/owners', { method: 'POST', body: JSON.stringify(newOwner) }), onSuccess: () => { setNewOwner({ name: '', email: '' }); refresh(); } });
  if (overview.isLoading) return <Spinner />;
  if (overview.isError) return <ErrorBox message={errorMessage(overview.error)} />;
  const o = overview.data;
  const row = (scope: string, item: any) => (
    <tr key={item.id} className="border-t border-slate-100 dark:border-slate-800">
      <td className="py-1">{item.name}</td>
      <td>
        <select className={inputClass} disabled={!can('owners:manage')} value={item.ownerId ?? ''} aria-label={`${t('admin.owner')} ${item.name}`} onChange={(e) => assign.mutate({ scope, targetId: item.id, ownerId: e.target.value || null })}>
          <option value="">{t('admin.none')}</option>
          {o.owners.map((ow: any) => <option key={ow.id} value={ow.id}>{ow.name}</option>)}
        </select>
      </td>
    </tr>
  );
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">{t('admin.precedence')}</p>
      {(assign.isError || create.isError) && <ErrorBox message={errorMessage(assign.error ?? create.error)} />}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><h3 className="mb-2 font-semibold">{t('admin.issuer')}</h3><table className="w-full text-left text-sm"><tbody>{o.issuers.map((i: any) => row('ISSUER', i))}</tbody></table></Card>
        <Card><h3 className="mb-2 font-semibold">{t('admin.policy')}</h3><table className="w-full text-left text-sm"><tbody>{o.policies.map((p: any) => row('POLICY', p))}</tbody></table></Card>
      </div>
      {can('owners:manage') && (
        <Card>
          <h3 className="mb-2 font-semibold">{t('admin.newOwner')}</h3>
          <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <input className={inputClass} placeholder={t('admin.name')} value={newOwner.name} onChange={(e) => setNewOwner({ ...newOwner, name: e.target.value })} required minLength={3} aria-label={t('admin.name')} />
            <input className={inputClass} type="email" placeholder={t('admin.email')} value={newOwner.email} onChange={(e) => setNewOwner({ ...newOwner, email: e.target.value })} required aria-label={t('admin.email')} />
            <Button type="submit">{t('admin.create')}</Button>
          </form>
        </Card>
      )}
    </div>
  );
}

function PoliciesTab() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { errorMessage } = useFormat();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ key: string; value: string } | null>(null);
  const [pending, setPending] = useState<{ key: string; value: string } | null>(null);
  const policies = useQuery({ queryKey: ['policies'], queryFn: () => api<any>('/admin/policies') });
  const save = useMutation({
    mutationFn: (v: { key: string; value: string; reason: string }) => api(`/admin/config/${v.key}`, { method: 'PUT', body: JSON.stringify({ value: v.value, reason: v.reason }) }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['policies'] }),
  });
  if (policies.isLoading) return <Spinner />;
  if (policies.isError) return <ErrorBox message={errorMessage(policies.error)} />;
  return (
    <div className="space-y-4">
      {save.isError && <ErrorBox message={errorMessage(save.error)} />}
      <Card>
        <h3 className="mb-2 font-semibold">{t('admin.config')}</h3>
        <table className="w-full text-left text-sm">
          <thead className="text-slate-500"><tr><th>{t('admin.key')}</th><th>{t('admin.value')}</th><th /></tr></thead>
          <tbody>
            {policies.data.config.map((c: any) => {
              const draft = editing?.key === c.key ? editing : null;
              return (
              <tr key={c.key} className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-1">{t(`admin.keys.${c.key}`, { defaultValue: c.key })}<div className="text-xs text-slate-500">{c.description}</div></td>
                <td>{draft ? <input className={inputClass} value={draft.value} onChange={(e) => setEditing({ key: c.key, value: e.target.value })} aria-label={c.key} /> : c.value}</td>
                <td className="text-right">
                  {can('users:manage') ? (draft
                    ? <Button size="sm" onClick={() => setPending({ key: c.key, value: draft.value })}>{t('admin.save')}</Button>
                    : <Button size="sm" variant="outline" onClick={() => setEditing({ key: c.key, value: c.value })}>{t('admin.save')}…</Button>) : <span className="text-xs text-slate-500">{t('admin.readOnly')}</span>}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <Card className="overflow-x-auto">
        <h3 className="mb-2 font-semibold">{t('admin.certPolicies')}</h3>
        <table className="w-full text-left text-sm">
          <thead className="text-slate-500"><tr><th>{t('admin.policy')}</th><th>{t('admin.minKey')}</th><th>{t('admin.thresholds')}</th><th>{t('admin.requiredEku')}</th></tr></thead>
          <tbody>{policies.data.certificatePolicies.map((p: any) => <tr key={p.id} className="border-t border-slate-100 dark:border-slate-800"><td className="py-1">{p.name}</td><td>{p.minKeySizeBits}</td><td>{p.alertThresholds}</td><td>{p.requiredEku}</td></tr>)}</tbody>
        </table>
      </Card>
      {pending && <ReasonDialog title={t('admin.save')} label={t('admin.reason')} onCancel={() => setPending(null)} onConfirm={(reason) => { save.mutate({ ...pending, reason }); setPending(null); setEditing(null); }} />}
    </div>
  );
}

export function AdminPage() {
  const { t } = useTranslation();
  const { errorMessage } = useFormat();
  const [tab, setTab] = useState<(typeof TABS)[number]>('users');
  const users = useQuery({ queryKey: ['admin-users'], queryFn: () => api<any[]>('/admin/users'), enabled: tab === 'users' });
  const roles = useQuery({ queryKey: ['admin-roles'], queryFn: () => api<any[]>('/admin/roles'), enabled: tab === 'roles' });

  return (
    <>
      <PageHeader title={t('admin.title')} />
      <div className="mb-3 flex gap-2" role="tablist">
        {TABS.map((k) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn('rounded-md px-3 py-1 text-sm', tab === k ? 'bg-sky-700 text-white' : 'bg-slate-200 dark:bg-slate-800')}>{t(`admin.${k}`)}</button>)}
      </div>
      {tab === 'users' && (users.isLoading ? <Spinner /> : users.isError ? <ErrorBox message={errorMessage(users.error)} /> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><tr>{['name', 'email', 'role', 'active'].map((k) => <th key={k} className="px-3 py-2 font-medium">{t(`admin.${k}`)}</th>)}</tr></thead>
            <tbody>{users.data!.map((u) => <tr key={u.id} className="border-t border-slate-100 dark:border-slate-800"><td className="px-3 py-1">{u.displayName} {u.isSynthetic && <Badge tone="sky">{t('metrics.synthetic')}</Badge>}</td><td className="px-3">{u.email}</td><td className="px-3">{u.roles.map((r: string) => t(`roles.${r}`)).join(', ')}</td><td className="px-3">{u.isActive ? t('common.yes') : t('common.no')}</td></tr>)}</tbody>
          </table>
        </Card>
      ))}
      {tab === 'roles' && (roles.isLoading ? <Spinner /> : roles.isError ? <ErrorBox message={errorMessage(roles.error)} /> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {roles.data!.map((r) => (
            <Card key={r.code}>
              <h3 className="mb-1 font-semibold">{t(`roles.${r.code}`)}</h3>
              <div className="flex flex-wrap gap-1">{r.permissions.map((p: string) => <Badge key={p}>{p}</Badge>)}</div>
            </Card>
          ))}
        </div>
      ))}
      {tab === 'owners' && <OwnersTab />}
      {tab === 'policies' && <PoliciesTab />}
    </>
  );
}
