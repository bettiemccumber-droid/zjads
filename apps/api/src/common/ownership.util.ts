import { UserRole } from '@prisma/client';

export interface AuthUser {
  id: number;
  role: UserRole;
  organizationId: number;
}

/**
 * 解析数据归属用户 ID（员工只能看自己，管理员可指定 userId）
 */
export function resolveOwnerUserId(user: AuthUser, queryUserId?: number): number {
  if (user.role === UserRole.ADMIN && queryUserId) {
    return queryUserId;
  }
  return user.id;
}

export function isAdmin(user: AuthUser): boolean {
  return user.role === UserRole.ADMIN;
}

/**
 * 管理员未指定 userId 时，查询全公司活跃员工数据
 */
export function isCompanyWideScope(user: AuthUser, queryUserId?: number): boolean {
  return user.role === UserRole.ADMIN && queryUserId == null;
}
