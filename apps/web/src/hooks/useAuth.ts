import { useCallback, useEffect, useState } from 'react';
import { api, clearToken, getToken, type ApiResult } from '../api/client';

export interface TeamMemberBrief {
  id: number;
  username: string;
}

export interface AuthUser {
  id: number;
  email: string;
  username: string;
  role: 'ADMIN' | 'OPERATOR' | 'VIEWER';
  /** 作为组长时的直属组员（可为空数组） */
  teamMembers?: TeamMemberBrief[];
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get<ApiResult<AuthUser>>('/auth/me');
      if (data.success) setUser(data.data);
      else {
        clearToken();
        setUser(null);
      }
    } catch {
      clearToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const logout = () => {
    clearToken();
    setUser(null);
  };

  const isAdmin = user?.role === 'ADMIN';
  const isTeamLead = (user?.teamMembers?.length ?? 0) > 0;
  return { user, loading, refresh, logout, isAdmin, isTeamLead };
}
