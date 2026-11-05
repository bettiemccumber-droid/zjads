import type { AuthUser } from '../common/ownership.util';
import type { SettlementActualCommissionService } from './settlement-actual-commission.service';
import type { SettlementReceivableCommissionService } from './settlement-receivable-commission.service';

export type CommissionHalf = { usdH1: number; usdH2: number };

type AccountOwnerPick = { id: number; ownerUserId: number };

/**
 * 打款同步结果按渠道账号所属员工写入 `user:{ownerUserId}`，避免全公司/员工 scope 错位导致报表读不到
 */
export async function persistPaymentHalvesByAccountOwner(
  receivable: SettlementReceivableCommissionService,
  actual: SettlementActualCommissionService,
  user: AuthUser,
  month: string,
  accounts: AccountOwnerPick[],
  receivableBatch: Record<string, CommissionHalf>,
  actualBatch: Record<string, CommissionHalf>,
): Promise<void> {
  const ownerByAccountId = new Map(accounts.map((a) => [String(a.id), a.ownerUserId]));

  const groupByOwner = (batch: Record<string, CommissionHalf>) => {
    const map = new Map<number, Record<string, CommissionHalf>>();
    for (const [accountKey, half] of Object.entries(batch)) {
      const ownerId = ownerByAccountId.get(accountKey) ?? ownerByAccountId.get(accountKey.toLowerCase());
      if (ownerId == null) continue;
      const bucket = map.get(ownerId) ?? {};
      bucket[accountKey] = half;
      map.set(ownerId, bucket);
    }
    return map;
  };

  const recvByOwner = groupByOwner(receivableBatch);
  const actByOwner = groupByOwner(actualBatch);
  const ownerIds = new Set([...recvByOwner.keys(), ...actByOwner.keys()]);

  for (const ownerId of ownerIds) {
    const scopeKey = `user:${ownerId}`;
    const recv = recvByOwner.get(ownerId);
    const act = actByOwner.get(ownerId);
    if (recv && Object.keys(recv).length) {
      await receivable.saveHalvesWithScopeKey(user, month, scopeKey, recv);
    }
    if (act && Object.keys(act).length) {
      await actual.saveHalvesWithScopeKey(user, month, scopeKey, act);
    }
  }
}
