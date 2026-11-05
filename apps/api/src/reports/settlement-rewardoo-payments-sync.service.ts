import { ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  aggregateRewardooPaymentsForSettlement,
  fetchRewardooPayments,
} from '../collectors/rewardoo-payments.util';
import { AuthUser, isAdmin, isCompanyWideScope, resolveOwnerUserId } from '../common/ownership.util';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { monthToDateRange } from './settlement-monthly.util';
import { SettlementActualCommissionService } from './settlement-actual-commission.service';
import { SettlementReceivableCommissionService } from './settlement-receivable-commission.service';
import { persistPaymentHalvesByAccountOwner } from './settlement-commission-persist.util';
import {
  shouldPersistPaymentSyncLine,
  zeroAggregateHint,
} from './settlement-payment-sync-feedback.util';
import { canEditSettlementActualCommission } from './settlement-report-scope.util';

export interface RewardooPaymentsSyncLineResult {
  channelAccountId: number;
  displayName: string;
  affiliateAlias: string;
  receivable: { usdH1: number; usdH2: number };
  actual: { usdH1: number; usdH2: number };
  paymentRowCount: number;
  error?: string;
}

export interface RewardooPaymentsSyncResult {
  month: string;
  synced: RewardooPaymentsSyncLineResult[];
}

@Injectable()
export class SettlementRewardooPaymentsSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly receivable: SettlementReceivableCommissionService,
    private readonly actual: SettlementActualCommissionService,
  ) {}

  /**
   * 从 Rewardoo Payments API 同步 RW 渠道账号的应收/实收到结算报表
   */
  async syncForMonth(
    user: AuthUser,
    month: string,
    queryUserId?: number,
  ): Promise<RewardooPaymentsSyncResult> {
    if (!canEditSettlementActualCommission(user, queryUserId)) {
      throw new ForbiddenException('无权同步该范围的 Rewardoo 打款');
    }

    const { startDate, endDate } = monthToDateRange(month);
    const ownerIds = await this.resolveOwnerUserIds(user, queryUserId);

    const accounts = await this.prisma.channelAccount.findMany({
      where: {
        ownerUserId: { in: ownerIds },
        isActive: true,
        platform: { code: 'rewardoo' },
      },
      include: { platform: true },
      orderBy: { id: 'asc' },
    });

    const receivableBatch: Record<string, { usdH1: number; usdH2: number }> = {};
    const actualBatch: Record<string, { usdH1: number; usdH2: number }> = {};
    const synced: RewardooPaymentsSyncLineResult[] = [];

    for (const account of accounts) {
      const key = String(account.id);
      try {
        const cred = this.crypto.decrypt<{ apiToken: string }>(account.credentialsEnc);
        const token = cred.apiToken?.trim();
        if (!token) {
          synced.push({
            channelAccountId: account.id,
            displayName: account.displayName,
            affiliateAlias: account.affiliateAlias,
            receivable: { usdH1: 0, usdH2: 0 },
            actual: { usdH1: 0, usdH2: 0 },
            paymentRowCount: 0,
            error: 'Token 为空',
          });
          continue;
        }

        const rows = await fetchRewardooPayments(token, startDate, endDate);
        const agg = aggregateRewardooPaymentsForSettlement(rows, month);
        const receivable = { usdH1: agg.receivableH1, usdH2: agg.receivableH2 };
        const actual = { usdH1: agg.actualH1, usdH2: agg.actualH2 };
        const aggSum =
          receivable.usdH1 + receivable.usdH2 + actual.usdH1 + actual.usdH2;
        let lineError: string | undefined;
        if (!shouldPersistPaymentSyncLine(receivable, actual, rows.length)) {
          lineError = zeroAggregateHint(month, rows.length);
        } else if (aggSum <= 0 && rows.length > 0) {
          lineError = zeroAggregateHint(month, rows.length);
        } else {
          receivableBatch[key] = receivable;
          actualBatch[key] = actual;
        }
        synced.push({
          channelAccountId: account.id,
          displayName: account.displayName,
          affiliateAlias: account.affiliateAlias,
          receivable,
          actual,
          paymentRowCount: rows.length,
          error: lineError,
        });
      } catch (err) {
        synced.push({
          channelAccountId: account.id,
          displayName: account.displayName,
          affiliateAlias: account.affiliateAlias,
          receivable: { usdH1: 0, usdH2: 0 },
          actual: { usdH1: 0, usdH2: 0 },
          paymentRowCount: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (Object.keys(receivableBatch).length || Object.keys(actualBatch).length) {
      await persistPaymentHalvesByAccountOwner(
        this.receivable,
        this.actual,
        user,
        month,
        accounts.map((a) => ({ id: a.id, ownerUserId: a.ownerUserId })),
        receivableBatch,
        actualBatch,
      );
    }

    return { month, synced };
  }

  private async resolveOwnerUserIds(user: AuthUser, queryUserId?: number): Promise<number[]> {
    if (isCompanyWideScope(user, queryUserId)) {
      const employees = await this.prisma.user.findMany({
        where: { isActive: true, role: { not: UserRole.ADMIN } },
        select: { id: true },
      });
      return employees.map((e) => e.id);
    }
    return [resolveOwnerUserId(user, queryUserId)];
  }
}
