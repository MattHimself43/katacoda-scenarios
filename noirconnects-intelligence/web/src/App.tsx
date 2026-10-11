import { Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Spinner, Card, EmptyState } from './components/ui';
import { LoginPage } from './pages/Login';
import { OverviewPage } from './pages/Overview';
import { ComingSoonPage } from './pages/ComingSoon';
import { SearchPage } from './pages/Search';
import { AuditPage } from './pages/Audit';
import { SettingsPage } from './pages/settings/SettingsPage';
import { NAV } from './lib/nav';
import { BrandDiscoveryPage } from './pages/brands/BrandDiscovery';
import { BrandApprovalsPage } from './pages/brands/BrandApprovals';
import { BrandProfilePage } from './pages/brands/BrandProfile';

export function App() {
  const { me, loading, can } = useAuth();
  if (loading) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  if (!me) return <LoginPage />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<OverviewPage />} />
        {NAV.filter((n) => n.phase).map((n) => (
          <Route key={n.path} path={n.path} element={<ComingSoonPage item={n} />} />
        ))}
        <Route path="/brand-discovery" element={<BrandDiscoveryPage />} />
        <Route path="/brand-approvals" element={<BrandApprovalsPage />} />
        <Route path="/brands/:id" element={<BrandProfilePage />} />
        <Route path="/audit" element={can('audit.view') ? <AuditPage /> : <Forbidden />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="*" element={<Card><EmptyState title="Page not found" /></Card>} />
      </Route>
    </Routes>
  );
}

function Forbidden() {
  return <Card><EmptyState title="You do not have access to this section">Ask an administrator if you need access.</EmptyState></Card>;
}
