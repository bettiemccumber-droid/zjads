import { ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  aggregateLinkbuxCommissionsForSettlement,
  fetchLinkbuxMerchantCommissions,
} from '../collectors/linkbux-payment-details.util';
import { AuthUser, isCompanyWideScope, resolveOwnerUserId } from '../common/ownership.util';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { monthToDateRange } from './settlement-monthly.util';
import { SettlementActualCommissionService } from './settlement-actual-commission.service';
import { SettlementReceivableCommissionService } from './settlement-receivable-commission.service';
import { canEditSettlementActualCommission } from './settlement-report-scope.util';

export interface LinkbuxPaymentsSyncLineResult {
  channelAccountId: number;
  displayName: string;
  affiliateAlias: string;
  receivable: { usdH1: number; usdH2: number };
  actual: { usdH1: number; usdH2: number };
  commissionRowCount: number;
  error?: string;
}

export interface LinkbuxPaymentsSyncResult {
  month: string;
  synced: LinkbuxPaymentsSyncLineResult[];
}

@Injectable()
export class SettlementLinkbuxPaymentsSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly receivable: SettlementReceivableCommissionService,
    private readonly actual: SettlementActualCommissionService,
  ) {}

  /**
   * 从 LinkBux Payment Details API 同步 LB 渠道账号应收/实收到结算报表
   */
  async syncForMonth(
    user: AuthUser,
    month: string,
    queryUserId?: number,
  ): Promise<LinkbuxPaymentsSyncResult> {
    if (!canEditSettlementActualCommission(user, queryUserId)) {
      throw new ForbiddenException('无权同步该范围的 LinkBux 打款');
    }

    const { startDate, endDate } = monthToDateRange(month);
    const ownerIds = await this.resolveOwnerUserIds(user, queryUserId);

    const accounts = await this.prisma.channelAccount.findMany({
      where: {
        ownerUserId: { in: ownerIds },
        isActive: true,
        platform: { code: 'linkbux' },
      },
      orderBy: { id: 'asc' },
    });

    const receivableBatch: Record<string, { usdH1: number; usdH2: number }> = {};
    const actualBatch: Record<string, { usdH1: number; usdH2: number }> = {};
    const synced: LinkbuxPaymentsSyncLineResult[] = [];

    for (const account of accounts) {
      const key = String(account.id);
      try {
        const cred = this.crypto.decrypt<{ apiToken: string }>(account.credentialsEnc);
        const token = cred.apiToken?.trim();
        if (!token) {
          synced.push(this.errorLine(account, 'Token 为空'));
          continue;
        }

        const rows = await fetchLinkbuxMerchantCommissions(token, startDate, endDate);
        const agg = aggregateLinkbuxCommissionsForSettlement(rows, month);
        receivableBatch[key] = { usdH1: agg.receivableH1, usdH2: agg.receivableH2 };
        actualBatch[key] = { usdH1: agg.actualH1, usdH2: agg.actualH2 };
        synced.push({
          channelAccountId: account.id,
          displayName: account.displayName,
          affiliateAlias: account.affiliateAlias,
          receivable: receivableBatch[key],
          actual: actualBatch[key],
          commissionRowCount: rows.length,
        });
      } catch (err) {
        synced.push({
          ...this.errorLine(account, err instanceof Error ? err.message : String(err)),
          commissionRowCount: 0,
        });
      }
    }

    if (Object.keys(receivableBatch).length) {
      await this.receivable.saveHalves(user, month, receivableBatch, queryUserId);
    }
    if (Object.keys(actualBatch).length) {
      await this.actual.saveHalves(user, month, actualBatch, queryUserId);
    }

    return { month, synced };
  }

  private errorLine(
    account: { id: number; displayName: string; affiliateAlias: string },
    error: string,
  ): LinkbuxPaymentsSyncLineResult {
    return {
      channelAccountId: account.id,
      displayName: account.displayName,
      affiliateAlias: account.affiliateAlias,
      receivable: { usdH1: 0, usdH2: 0 },
      actual: { usdH1: 0, usdH2: 0 },
      commissionRowCount: 0,
      error,
    };
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
