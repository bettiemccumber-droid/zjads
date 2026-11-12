import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import LandingPage from './pages/LandingPage';
import PrivacyPage from './pages/PrivacyPage';
import TermsPage from './pages/TermsPage';
import AppLayout from './layouts/AppLayout';
import DashboardPage from './pages/DashboardPage';
import ChannelAccountsPage from './pages/ChannelAccountsPage';
import SettlementPage from './pages/SettlementPage';
import SettlementReportPage from './pages/SettlementReportPage';
import AdSourcesPage from './pages/AdSourcesPage';
import MerchantStatusPage from './pages/MerchantStatusPage';
import MerchantHubLayout from './pages/merchant-hub/MerchantHubLayout';
import ChargebackMerchantsPage from './pages/merchant-hub/ChargebackMerchantsPage';
import { merchantHubDefaultPath } from './pages/merchant-hub/merchant-hub.routes';
import AdminRoute from './components/AdminRoute';
import AdminHomePage from './pages/admin/AdminHomePage';
import AdminStatsPage from './pages/admin/AdminStatsPage';
import AdminUsersPage from './pages/admin/AdminUsersPage';
import AdminUserDetailPage from './pages/admin/AdminUserDetailPage';
import AdminUserManagePage from './pages/admin/AdminUserManagePage';
import AdminSyncPage from './pages/admin/AdminSyncPage';
import AdminPublishSitesPage from './pages/admin/AdminPublishSitesPage';
import MyMerchantsPage from './pages/ads/MyMerchantsPage';
import AccountStatusPage from './pages/ads/AccountStatusPage';
import ArticlesPage from './pages/ads/ArticlesPage';
import ArticlePublishPage from './pages/ads/ArticlePublishPage';
import { useAuth } from './hooks/useAuth';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** 管理员访问员工专属页时引导到采集中心 */
function EmployeeOnlyRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user?.role === 'ADMIN') return <Navigate to="/admin/sync" replace />;
  return <>{children}</>;
}

/** 旧投放预览地址改到我的商家；管理员仍去内容站 */
function AdsAutomationRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user?.role === 'ADMIN') return <Navigate to="/admin/publish-sites" replace />;
  return <Navigate to="/ads/merchants" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route
          element={
            <PrivateRoute>
              <AppLayout />
            </PrivateRoute>
          }
        >
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="merchants" element={<MerchantHubLayout />}>
            <Route index element={<Navigate to={merchantHubDefaultPath()} replace />} />
            <Route path="status" element={<MerchantStatusPage />} />
            <Route path="chargebacks" element={<ChargebackMerchantsPage />} />
          </Route>
          <Route
            path="chargeback-analysis"
            element={<Navigate to="/merchants/chargebacks" replace />}
          />
          <Route
            path="chargeback-analysis/merchants"
            element={<Navigate to="/merchants/chargebacks" replace />}
          />
          <Route
            path="chargeback-merchants"
            element={<Navigate to="/merchants/chargebacks" replace />}
          />
          <Route
            path="channel-accounts"
            element={
              <EmployeeOnlyRoute>
                <ChannelAccountsPage />
              </EmployeeOnlyRoute>
            }
          />
          <Route path="settlement" element={<SettlementPage />} />
          <Route path="settlement-report" element={<SettlementReportPage />} />
          <Route
            path="ad-sources"
            element={
              <EmployeeOnlyRoute>
                <AdSourcesPage />
              </EmployeeOnlyRoute>
            }
          />
          <Route path="ads-automation" element={<AdsAutomationRoute />} />
          <Route path="ads/merchants" element={<MyMerchantsPage />} />
          <Route path="ads/accounts" element={<EmployeeOnlyRoute><AccountStatusPage /></EmployeeOnlyRoute>} />
          <Route path="ads/articles/publish" element={<EmployeeOnlyRoute><ArticlePublishPage /></EmployeeOnlyRoute>} />
          <Route path="ads/articles" element={<EmployeeOnlyRoute><ArticlesPage /></EmployeeOnlyRoute>} />
          <Route path="admin" element={<AdminRoute><AdminHomePage /></AdminRoute>} />
          <Route path="admin/stats" element={<AdminRoute><AdminStatsPage /></AdminRoute>} />
          <Route path="admin/users" element={<AdminRoute><AdminUsersPage /></AdminRoute>} />
          <Route path="admin/users/manage" element={<AdminRoute><AdminUserManagePage /></AdminRoute>} />
          <Route path="admin/users/:id" element={<AdminRoute><AdminUserDetailPage /></AdminRoute>} />
          <Route path="admin/sync" element={<AdminRoute><AdminSyncPage /></AdminRoute>} />
          <Route
            path="admin/ad-sources"
            element={
              <AdminRoute>
                <AdSourcesPage adminMode />
              </AdminRoute>
            }
          />
          <Route
            path="admin/publish-sites"
            element={
              <AdminRoute>
                <AdminPublishSitesPage />
              </AdminRoute>
            }
          />
          <Route path="admin/dashboard" element={<Navigate to="/admin/stats" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
