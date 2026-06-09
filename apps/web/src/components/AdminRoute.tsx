import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

/** 仅管理员可访问的路由守卫 */
export default function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user || user.role !== 'ADMIN') {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}
