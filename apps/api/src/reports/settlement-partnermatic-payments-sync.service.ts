import { ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  aggregatePartnermaticPaymentDetailsForSettlement,
  fetchPartnermaticPaymentDetailsForSettlement,
} from '../collectors/partnermatic-payment-details.util';
import { fetchPartnermaticPaymentSummary } from '../collectors/partnermatic-payments.util';
import { resolveV2SummaryOrDetailSettlement } from '../collectors/network-v2-payment-summary.util';
import { AuthUser, isCompanyWideScope, resolveOwnerUserId } from '../common/ownership.util';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { monthToDateRange } from './settlement-monthly.util';
import { SettlementActualCommissionService } from './settlement-actual-commission.service';
import { SettlementReceivableCommissionService } from './settlement-receivable-commission.service';
import { canEditSettlementActualCommission } from './settlement-report-scope.util';

export interface PartnermaticPaymentsSyncLineResult {
  channelAccountId: number;
  displayName: string;
  affiliateAlias: string;
  receivable: { usdH1: number; usdH2: number };
  actual: { usdH1: number; usdH2: number };
  detailRowCount: number;
  error?: string;
}

export interface PartnermaticPaymentsSyncResult {
  month: string;
  synced: PartnermaticPaymentsSyncLineResult[];
}

@Injectable()
export class SettlementPartnermaticPaymentsSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly receivable: SettlementReceivableCommissionService,
    private readonly actual: SettlementActualCommissionService,
  ) {}

  /**
   * 从 Partnermatic Payment Summary + Detail 同步 PM 渠道账号应收/实收
   * @see https://app.partnermatic.com/tools/apis/payment_summary_api/5
   */
  async syncForMonth(
    user: AuthUser,
    month: string,
    queryUserId?: number,
  ): Promise<PartnermaticPaymentsSyncResult> {
    if (!canEditSettlementActualCommission(user, queryUserId)) {
      throw new ForbiddenException('无权同步该范围的 Partnermatic 打款');
    }

    const { startDate, endDate } = monthToDateRange(month);
    const ownerIds = await this.resolveOwnerUserIds(user, queryUserId);

    const accounts = await this.prisma.channelAccount.findMany({
      where: {
        ownerUserId: { in: ownerIds },
        isActive: true,
        platform: { code: 'partnermatic' },
      },
      orderBy: { id: 'asc' },
    });

    const receivableBatch: Record<string, { usdH1: number; usdH2: number }> = {};
    const actualBatch: Record<string, { usdH1: number; usdH2: number }> = {};
    const synced: PartnermaticPaymentsSyncLineResult[] = [];

    for (const account of accounts) {
      const key = String(account.id);
      try {
        const cred = this.crypto.decrypt<{ apiToken: string }>(account.credentialsEnc);
        const token = cred.apiToken?.trim();
        if (!token) {
          synced.push(this.errorLine(account, 'Token 为空'));
          continue;
        }

        let summaryRows: Awaited<ReturnType<typeof fetchPartnermaticPaymentSummary>> = [];
        let summaryError: string | undefined;
        try {
          summaryRows = await fetchPartnermaticPaymentSummary(token, startDate, endDate);
        } catch (err) {
          summaryError = err instanceof Error ? err.message : String(err);
        }

        const { paidRows, validationRows } = await fetchPartnermaticPaymentDetailsForSettlement(
          token,
          startDate,
          endDate,
        );
        const fromDetail = aggregatePartnermaticPaymentDetailsForSettlement(
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
        synced.push({
          channelAccountId: account.id,
          displayName: account.displayName,
          affiliateAlias: account.affiliateAlias,
          receivable,
          actual,
          detailRowCount: summaryRows.length + paidRows.length + validationRows.length,
          error: summaryError && !hasSummary ? summaryError : undefined,
        });
      } catch (err) {
        synced.push({
          ...this.errorLine(account, err instanceof Error ? err.message : String(err)),
          detailRowCount: 0,
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
  ): PartnermaticPaymentsSyncLineResult {
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
