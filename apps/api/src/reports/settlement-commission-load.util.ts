import type { SettlementActualCommissionHalf } from './settlement-actual-commission.service';
import type { SettlementReceivableCommissionHalf } from './settlement-receivable-commission.service';
import { roundMoney } from './settlement-monthly.util';

type HalfRow = {
  scopeKey: string;
  affiliateKey: string;
  amountUsd: unknown;
  amountUsdH1: unknown;
  amountUsdH2: unknown;
};

function parseHalfRow(row: HalfRow): { usdH1: number; usdH2: number } {
  let h1 = roundMoney(Number(row.amountUsdH1 ?? 0));
  let h2 = roundMoney(Number(row.amountUsdH2 ?? 0));
  const legacy = roundMoney(Number(row.amountUsd ?? 0));
  if (h1 === 0 && h2 === 0 && legacy > 0) {
    h2 = legacy;
  }
  return { usdH1: h1, usdH2: h2 };
}

/**
 * 按列（渠道账号 id）解析应收/实收：优先账号所属员工 scope，其次当前报表 scope、全公司
 */
export function pickCommissionHalfForAccount<
  T extends SettlementReceivableCommissionHalf | SettlementActualCommissionHalf,
>(
  rows: HalfRow[],
  accountId: number,
  ownerUserId: number,
  reportScopeKey: string,
): T {
  const key = String(accountId).toLowerCase();
  const scopes = [`user:${ownerUserId}`, reportScopeKey, 'company'];
  for (const scopeKey of scopes) {
    const row = rows.find(
      (r) => r.scopeKey === scopeKey && r.affiliateKey.toLowerCase() === key,
    );
    if (row) {
      return parseHalfRow(row) as T;
    }
  }
  return { usdH1: 0, usdH2: 0 } as T;
}

export function buildScopeKeysForCommissionLoad(
  reportScopeKey: string,
  ownerUserIds: number[],
): string[] {
  const set = new Set<string>([reportScopeKey, 'company']);
  for (const id of ownerUserIds) {
    set.add(`user:${id}`);
  }
  return [...set];
}
