import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export interface AuthUser {
  id: number;
  role: UserRole;
  organizationId: number;
  /** JWT 校验后注入：当前用户作为组长的直属组员 userId */
  teamMemberIds?: number[];
}

export type DataScopeMode = 'read' | 'write';

/**
 * 是否可查看 targetUserId 的数据（读）
 */
export function canViewUserData(user: AuthUser, targetUserId: number): boolean {
  if (user.role === UserRole.ADMIN) return true;
  if (targetUserId === user.id) return true;
  return user.teamMemberIds?.includes(targetUserId) ?? false;
}

/**
 * 解析数据归属用户 ID。
 * - read：管理员、本人、组长可查直属组员
 * - write：仅管理员可指定他人，否则仅本人
 */
export function resolveOwnerUserId(
  user: AuthUser,
  queryUserId?: number,
  mode: DataScopeMode = 'read',
): number {
  if (queryUserId == null) {
    return user.id;
  }
  if (user.role === UserRole.ADMIN) {
    return queryUserId;
  }
  if (queryUserId === user.id) {
    return queryUserId;
  }
  if (mode === 'read' && user.teamMemberIds?.includes(queryUserId)) {
    return queryUserId;
  }
  if (mode === 'write') {
    throw new ForbiddenException('无权操作该员工的数据');
  }
  throw new ForbiddenException('无权查看该员工的数据');
}

export function isAdmin(user: AuthUser): boolean {
  return user.role === UserRole.ADMIN;
}

/**
 * 是否可代查指定 userId（读场景下的 query 参数）
 */
export function canUseScopedUserId(user: AuthUser, queryUserId?: number): boolean {
  if (queryUserId == null) return false;
  return canViewUserData(user, queryUserId) && queryUserId !== user.id;
}

/**
 * 管理员未指定 userId 时，查询全公司活跃员工数据
 */
export function isCompanyWideScope(user: AuthUser, queryUserId?: number): boolean {
  return user.role === UserRole.ADMIN && queryUserId == null;
}
