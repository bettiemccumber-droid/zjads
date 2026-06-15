import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import AppLayout from './layouts/AppLayout';
import DashboardPage from './pages/DashboardPage';
import ChannelAccountsPage from './pages/ChannelAccountsPage';
import SettlementPage from './pages/SettlementPage';
import AdSourcesPage from './pages/AdSourcesPage';
import AdminRoute from './components/AdminRoute';
import AdminHomePage from './pages/admin/AdminHomePage';
import AdminStatsPage from './pages/admin/AdminStatsPage';
import AdminUsersPage from './pages/admin/AdminUsersPage';
import AdminUserDetailPage from './pages/admin/AdminUserDetailPage';
import AdminUserManagePage from './pages/admin/AdminUserManagePage';
import AdminSyncPage from './pages/admin/AdminSyncPage';
import { useAuth } from './hooks/useAuth';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** 登录后默认首页：管理员进后台，员工进工作台 */
function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user?.role === 'ADMIN') return <Navigate to="/admin" replace />;
  return <Navigate to="/dashboard" replace />;
}

/** 管理员访问员工专属页时引导到采集中心 */
function EmployeeOnlyRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user?.role === 'ADMIN') return <Navigate to="/admin/sync" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <AppLayout />
            </PrivateRoute>
          }
        >
          <Route index element={<HomeRedirect />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route
            path="channel-accounts"
            element={
              <EmployeeOnlyRoute>
                <ChannelAccountsPage />
              </EmployeeOnlyRoute>
            }
          />
          <Route path="settlement" element={<SettlementPage />} />
          <Route
            path="ad-sources"
            element={
              <EmployeeOnlyRoute>
                <AdSourcesPage />
              </EmployeeOnlyRoute>
            }
          />
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
          <Route path="admin/dashboard" element={<Navigate to="/admin/stats" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
