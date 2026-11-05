import { ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  aggregateLinkbuxActualCommissionsForSettlement,
  aggregateLinkbuxReceivableCommissionsForSettlement,
  dedupeLinkbuxMerchantCommissionRows,
  fetchLinkbuxMerchantCommissions,
  fetchLinkbuxMerchantCommissionsByPaidDate,
  linkbuxValidationBeginDate,
} from '../collectors/linkbux-payment-details.util';
import { AuthUser, isCompanyWideScope, resolveOwnerUserId } from '../common/ownership.util';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { monthToDateRange } from './settlement-monthly.util';
import { SettlementActualCommissionService } from './settlement-actual-commission.service';
import { SettlementReceivableCommissionService } from './settlement-receivable-commission.service';
import { persistPaymentHalvesByAccountOwner } from './settlement-commission-persist.util';
import {
  linkbuxZeroAggregateHint,
  shouldPersistPaymentSyncLine,
} from './settlement-payment-sync-feedback.util';
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
   * LinkBux 仅使用官方 Payment Details API（merchant_commission）
   * @see https://www.linkbux.com/publisher/tools/api/payment_details_api/
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
    const validationBegin = linkbuxValidationBeginDate(endDate);
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

        let validationRows: Awaited<ReturnType<typeof fetchLinkbuxMerchantCommissions>> = [];
        let paidRows: Awaited<ReturnType<typeof fetchLinkbuxMerchantCommissionsByPaidDate>> = [];
        let fetchError: string | undefined;

        try {
          validationRows = await fetchLinkbuxMerchantCommissions(
            token,
            validationBegin,
            endDate,
          );
        } catch (err) {
          fetchError = err instanceof Error ? err.message : String(err);
        }

        try {
          paidRows = await fetchLinkbuxMerchantCommissionsByPaidDate(
            token,
            validationBegin,
            endDate,
            startDate,
            endDate,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          fetchError = fetchError ? `${fetchError}; ${msg}` : msg;
        }

        const receivableAgg = aggregateLinkbuxReceivableCommissionsForSettlement(
          validationRows,
          month,
        );
        const actualAgg = aggregateLinkbuxActualCommissionsForSettlement(paidRows, month);
        const receivable = { usdH1: receivableAgg.receivableH1, usdH2: receivableAgg.receivableH2 };
        const actual = { usdH1: actualAgg.actualH1, usdH2: actualAgg.actualH2 };
        const mergedRows = dedupeLinkbuxMerchantCommissionRows([
          ...validationRows,
          ...paidRows,
        ]);
        const apiRowCount = mergedRows.length;
        const aggSum =
          receivable.usdH1 + receivable.usdH2 + actual.usdH1 + actual.usdH2;

        let lineError = fetchError;
        if (!lineError && aggSum <= 0) {
          lineError = linkbuxZeroAggregateHint(month, apiRowCount);
        }

        if (shouldPersistPaymentSyncLine(receivable, actual, apiRowCount)) {
          receivableBatch[key] = receivable;
          actualBatch[key] = actual;
          if (lineError && aggSum > 0) {
            lineError = undefined;
          }
        } else if (!lineError) {
          lineError = linkbuxZeroAggregateHint(month, apiRowCount);
        }

        synced.push({
          channelAccountId: account.id,
          displayName: account.displayName,
          affiliateAlias: account.affiliateAlias,
          receivable,
          actual,
          commissionRowCount: apiRowCount,
          error: lineError,
        });
      } catch (err) {
        synced.push({
          ...this.errorLine(account, err instanceof Error ? err.message : String(err)),
          commissionRowCount: 0,
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
