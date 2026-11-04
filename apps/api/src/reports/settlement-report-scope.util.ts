import { UserRole } from '@prisma/client';
import { AuthUser, isCompanyWideScope, resolveOwnerUserId } from '../common/ownership.util';

/**
 * 结算报表数据隔离键：`company` 或 `user:{ownerUserId}`
 */
export function resolveSettlementReportScopeKey(user: AuthUser, queryUserId?: number): string {
  if (isCompanyWideScope(user, queryUserId)) {
    return 'company';
  }
  const ownerId = resolveOwnerUserId(user, queryUserId, 'read');
  return `user:${ownerId}`;
}

/**
 * 是否可保存实收佣金（管理员任意 scope；员工仅本人 scope）
 */
export function canEditSettlementActualCommission(user: AuthUser, queryUserId?: number): boolean {
  if (user.role === UserRole.ADMIN) {
    return true;
  }
  if (queryUserId != null && queryUserId !== user.id) {
    return false;
  }
  return true;
}
