import type { AuthUser } from '../hooks/useAuth';

/** 是否可切换查看其他员工（管理员或担任组长） */
export function canScopeTeamMembers(user: AuthUser | null, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  return (user?.teamMembers?.length ?? 0) > 0;
}

/**
 * 从 URL 解析可查看的员工 id（管理员任意；组长仅组内）
 */
export function parseScopedViewUserId(
  user: AuthUser | null,
  isAdmin: boolean,
  rawUserId: string | null,
): number | undefined {
  if (!rawUserId) return undefined;
  const id = parseInt(rawUserId, 10);
  if (Number.isNaN(id)) return undefined;
  if (isAdmin) return id;
  if (!user) return undefined;
  if (id === user.id) return id;
  if (user.teamMembers?.some((m) => m.id === id)) return id;
  return undefined;
}
