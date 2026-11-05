import { ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  aggregateUltrainfluencePaymentDetailsForSettlement,
  fetchUltrainfluencePaymentDetailsForSettlement,
} from '../collectors/ultrainfluence-payment-details.util';
import { fetchUltrainfluencePaymentSummary } from '../collectors/ultrainfluence-payments.util';
import { resolveV2SummaryOrDetailSettlement } from '../collectors/network-v2-payment-summary.util';
import { AuthUser, isCompanyWideScope, resolveOwnerUserId } from '../common/ownership.util';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { monthToDateRange } from './settlement-monthly.util';
import { SettlementActualCommissionService } from './settlement-actual-commission.service';
import { SettlementReceivableCommissionService } from './settlement-receivable-commission.service';
import { persistPaymentHalvesByAccountOwner } from './settlement-commission-persist.util';
import { canEditSettlementActualCommission } from './settlement-report-scope.util';

export interface UltrainfluencePaymentsSyncLineResult {
  channelAccountId: number;
  displayName: string;
  affiliateAlias: string;
  receivable: { usdH1: number; usdH2: number };
  actual: { usdH1: number; usdH2: number };
  detailRowCount: number;
  error?: string;
}

export interface UltrainfluencePaymentsSyncResult {
  month: string;
  synced: UltrainfluencePaymentsSyncLineResult[];
}

@Injectable()
export class SettlementUltrainfluencePaymentsSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly receivable: SettlementReceivableCommissionService,
    private readonly actual: SettlementActualCommissionService,
  ) {}

  /**
   * 从 UltraInfluence Payment Detail API 同步 UI 渠道账号应收/实收到结算报表
   * @see https://app.ultrainfluence.com/tools/apis/payment_detail_api/54
   */
  async syncForMonth(
    user: AuthUser,
    month: string,
    queryUserId?: number,
  ): Promise<UltrainfluencePaymentsSyncResult> {
    if (!canEditSettlementActualCommission(user, queryUserId)) {
      throw new ForbiddenException('无权同步该范围的 UltraInfluence 打款');
    }

    const { startDate, endDate } = monthToDateRange(month);
    const ownerIds = await this.resolveOwnerUserIds(user, queryUserId);

    const accounts = await this.prisma.channelAccount.findMany({
      where: {
        ownerUserId: { in: ownerIds },
        isActive: true,
        platform: { code: 'ultrainfluence' },
      },
      orderBy: { id: 'asc' },
    });

    const receivableBatch: Record<string, { usdH1: number; usdH2: number }> = {};
    const actualBatch: Record<string, { usdH1: number; usdH2: number }> = {};
    const synced: UltrainfluencePaymentsSyncLineResult[] = [];

    for (const account of accounts) {
      const key = String(account.id);
      try {
        const cred = this.crypto.decrypt<{ apiToken: string }>(account.credentialsEnc);
        const token = cred.apiToken?.trim();
        if (!token) {
          synced.push(this.errorLine(account, 'Token 为空'));
          continue;
        }

        let summaryRows: Awaited<ReturnType<typeof fetchUltrainfluencePaymentSummary>> = [];
        let summaryError: string | undefined;
        try {
          summaryRows = await fetchUltrainfluencePaymentSummary(token, startDate, endDate);
        } catch (err) {
          summaryError = err instanceof Error ? err.message : String(err);
        }

        let paidRows: Awaited<
          ReturnType<typeof fetchUltrainfluencePaymentDetailsForSettlement>
        >['paidRows'] = [];
        let validationRows: Awaited<
          ReturnType<typeof fetchUltrainfluencePaymentDetailsForSettlement>
        >['validationRows'] = [];
        let detailError: string | undefined;
        try {
          const detail = await fetchUltrainfluencePaymentDetailsForSettlement(
            token,
            startDate,
            endDate,
          );
          paidRows = detail.paidRows;
          validationRows = detail.validationRows;
        } catch (err) {
          detailError = err instanceof Error ? err.message : String(err);
        }
        const fromDetail = aggregateUltrainfluencePaymentDetailsForSettlement(
          paidRows,
          validationRows,
          month,
        );
        const { receivable, actual, hasSummary } = resolveV2SummaryOrDetailSettlement(
          summaryRows,
          fromDetail,
          month,
        );

        receivableBatch[key] = receivable;
        actualBatch[key] = actual;
        const lineError =
          summaryError && !hasSummary
            ? summaryError
            : detailError && !hasSummary && receivable.usdH1 + receivable.usdH2 + actual.usdH1 + actual.usdH2 <= 0
              ? detailError
              : undefined;
        synced.push({
          channelAccountId: account.id,
          displayName: account.displayName,
          affiliateAlias: account.affiliateAlias,
          receivable,
          actual,
          detailRowCount: summaryRows.length + paidRows.length + validationRows.length,
          error: lineError,
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
  ): UltrainfluencePaymentsSyncLineResult {
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
