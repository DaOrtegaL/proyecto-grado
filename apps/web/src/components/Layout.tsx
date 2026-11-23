import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bell, FlaskConical, KeyRound, LayoutDashboard, LineChart, LogOut, Moon, PackageCheck, ScrollText, Settings, ShieldAlert, ShieldCheck, Store, Sun, ClipboardCheck, FileCheck2 } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/utils';
import { Button } from './ui';

const NAV = [
  { to: '/', key: 'nav.dashboard', icon: LayoutDashboard, permission: 'dashboard:read', end: true },
  { to: '/certificados', key: 'nav.certificates', icon: ShieldCheck, permission: 'certificates:read' },
  { to: '/terminales', key: 'nav.terminals', icon: Store, permission: 'geo:read' },
  { to: '/renovaciones', key: 'navOps.renewals', icon: KeyRound, permission: 'renewals:read' },
  { to: '/aprobaciones', key: 'navOps.approvals', icon: ClipboardCheck, permission: 'approvals:read' },
  { to: '/instalaciones', key: 'navOps.deployments', icon: PackageCheck, permission: 'deployments:read' },
  { to: '/alertas', key: 'nav.alerts', icon: Bell, permission: 'alerts:read' },
  { to: '/seguridad', key: 'navOps.security', icon: ShieldAlert, permission: 'security:read' },
  { to: '/indicadores', key: 'navOps.metrics', icon: LineChart, permission: 'metrics:read' },
  { to: '/auditoria', key: 'nav.audit', icon: ScrollText, permission: 'audit:read' },
  { to: '/evidencia', key: 'navOps.research', icon: FileCheck2, permission: 'research:read' },
  { to: '/simulador', key: 'navOps.simulator', icon: FlaskConical, permission: 'simulator:manage' },
  { to: '/administracion', key: 'navOps.admin', icon: Settings, permission: 'admin:read' },
];

export function Layout() {
  const { t } = useTranslation();
  const { user, signOut, can } = useAuth();
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 p-4 dark:border-slate-800">
          <div className="text-lg font-bold text-sky-700 dark:text-sky-400">{t('app.name')}</div>
          <div className="text-xs text-slate-500">{t('app.subtitle')}</div>
        </div>
        <nav className="flex-1 space-y-1 p-2" aria-label="Navegación principal">
          {NAV.filter((n) => can(n.permission)).map(({ to, key, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm',
                  isActive
                    ? 'bg-sky-100 font-medium text-sky-900 dark:bg-sky-900/40 dark:text-sky-200'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800',
                )
              }
            >
              <Icon className="h-4 w-4" aria-hidden /> {t(key)}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
          <nav className="flex gap-3 text-sm md:hidden" aria-label="Navegación móvil">
            {NAV.filter((n) => can(n.permission)).map(({ to, key }) => (
              <NavLink key={to} to={to} end={to === '/'} className="underline-offset-4 aria-[current=page]:underline">
                {t(key)}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <div className="text-right text-xs">
              <div className="font-medium">{user?.displayName}</div>
              <div className="text-slate-500">{user?.roles.map((r) => t(`roles.${r}`)).join(', ')}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setDark((d) => !d)} aria-label={t('common.theme')}>
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void signOut()}>
              <LogOut className="h-4 w-4" aria-hidden /> {t('common.logout')}
            </Button>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
