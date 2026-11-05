import { ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  aggregateLinkhaitaoPaymentDetailsForSettlement,
  fetchLinkhaitaoPaymentDetailsForSettlement,
} from '../collectors/linkhaitao-payment-details.util';
import { AuthUser, isCompanyWideScope, resolveOwnerUserId } from '../common/ownership.util';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { monthToDateRange } from './settlement-monthly.util';
import { SettlementActualCommissionService } from './settlement-actual-commission.service';
import { SettlementReceivableCommissionService } from './settlement-receivable-commission.service';
import { persistPaymentHalvesByAccountOwner } from './settlement-commission-persist.util';
import { canEditSettlementActualCommission } from './settlement-report-scope.util';

export interface LinkhaitaoPaymentsSyncLineResult {
  channelAccountId: number;
  displayName: string;
  affiliateAlias: string;
  receivable: { usdH1: number; usdH2: number };
  actual: { usdH1: number; usdH2: number };
  detailRowCount: number;
  error?: string;
}

export interface LinkhaitaoPaymentsSyncResult {
  month: string;
  synced: LinkhaitaoPaymentsSyncLineResult[];
}

@Injectable()
export class SettlementLinkhaitaoPaymentsSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly receivable: SettlementReceivableCommissionService,
    private readonly actual: SettlementActualCommissionService,
  ) {}

  /**
   * 从 LinkHaitao Payment Detail API (V2) 同步 LH 渠道账号应收/实收到结算报表
   * @see https://www.linkhaitao.com/apis-v2/payment_detail_api/84
   */
  async syncForMonth(
    user: AuthUser,
    month: string,
    queryUserId?: number,
  ): Promise<LinkhaitaoPaymentsSyncResult> {
    if (!canEditSettlementActualCommission(user, queryUserId)) {
      throw new ForbiddenException('无权同步该范围的 LinkHaitao 打款');
    }

    const { startDate, endDate } = monthToDateRange(month);
    const ownerIds = await this.resolveOwnerUserIds(user, queryUserId);

    const accounts = await this.prisma.channelAccount.findMany({
      where: {
        ownerUserId: { in: ownerIds },
        isActive: true,
        platform: { code: 'linkhaitao' },
      },
      orderBy: { id: 'asc' },
    });

    const receivableBatch: Record<string, { usdH1: number; usdH2: number }> = {};
    const actualBatch: Record<string, { usdH1: number; usdH2: number }> = {};
    const synced: LinkhaitaoPaymentsSyncLineResult[] = [];

    for (const account of accounts) {
      const key = String(account.id);
      try {
        const cred = this.crypto.decrypt<{ apiToken: string }>(account.credentialsEnc);
        const token = cred.apiToken?.trim();
        if (!token) {
          synced.push(this.errorLine(account, 'Token 为空'));
          continue;
        }

        let paidRows: Awaited<
          ReturnType<typeof fetchLinkhaitaoPaymentDetailsForSettlement>
        >['paidRows'] = [];
        let validationRows: Awaited<
          ReturnType<typeof fetchLinkhaitaoPaymentDetailsForSettlement>
        >['validationRows'] = [];
        let lineError: string | undefined;
        try {
          const detail = await fetchLinkhaitaoPaymentDetailsForSettlement(
            token,
            startDate,
            endDate,
          );
          paidRows = detail.paidRows;
          validationRows = detail.validationRows;
        } catch (err) {
          lineError = err instanceof Error ? err.message : String(err);
        }
        const agg = aggregateLinkhaitaoPaymentDetailsForSettlement(
          paidRows,
          validationRows,
          month,
        );
        const receivable = { usdH1: agg.receivableH1, usdH2: agg.receivableH2 };
        const actual = { usdH1: agg.actualH1, usdH2: agg.actualH2 };
        const sum = receivable.usdH1 + receivable.usdH2 + actual.usdH1 + actual.usdH2;
        if (sum > 0) {
          receivableBatch[key] = receivable;
          actualBatch[key] = actual;
        }
        synced.push({
          channelAccountId: account.id,
          displayName: account.displayName,
          affiliateAlias: account.affiliateAlias,
          receivable,
          actual,
          detailRowCount: paidRows.length + validationRows.length,
          error: lineError && sum <= 0 ? lineError : undefined,
        });
      } catch (err) {
        synced.push({
          ...this.errorLine(account, err instanceof Error ? err.message : String(err)),
          detailRowCount: 0,
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

  private errorLine(
    account: { id: number; displayName: string; affiliateAlias: string },
    error: string,
  ): LinkhaitaoPaymentsSyncLineResult {
    return {
      channelAccountId: account.id,
      displayName: account.displayName,
      affiliateAlias: account.affiliateAlias,
      receivable: { usdH1: 0, usdH2: 0 },
      actual: { usdH1: 0, usdH2: 0 },
      detailRowCount: 0,
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
