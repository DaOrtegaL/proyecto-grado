import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { CertificatesPage } from './pages/CertificatesPage';
import { CertificateDetailPage } from './pages/CertificateDetailPage';
import { TerminalsPage } from './pages/TerminalsPage';
import { AlertsPage } from './pages/AlertsPage';
import { AuditPage } from './pages/AuditPage';
import { RenewalsPage } from './pages/RenewalsPage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { DeploymentsPage } from './pages/DeploymentsPage';
import { SecurityPage } from './pages/SecurityPage';
import { MetricsPage } from './pages/MetricsPage';
import { ResearchPage } from './pages/ResearchPage';
import { SimulatorPage } from './pages/SimulatorPage';
import { AdminPage } from './pages/AdminPage';

export function App() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <LoginPage />;

  // La visibilidad es solo ergonomía: el servidor valida los permisos en cada solicitud.
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="certificados" element={<CertificatesPage />} />
        <Route path="certificados/:id" element={<CertificateDetailPage />} />
        <Route path="terminales" element={<TerminalsPage />} />
        <Route path="alertas" element={<AlertsPage />} />
        <Route path="auditoria" element={<AuditPage />} />
        <Route path="renovaciones" element={<RenewalsPage />} />
        <Route path="aprobaciones" element={<ApprovalsPage />} />
        <Route path="instalaciones" element={<DeploymentsPage />} />
        <Route path="seguridad" element={<SecurityPage />} />
        <Route path="indicadores" element={<MetricsPage />} />
        <Route path="evidencia" element={<ResearchPage />} />
        <Route path="simulador" element={<SimulatorPage />} />
        <Route path="administracion" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
