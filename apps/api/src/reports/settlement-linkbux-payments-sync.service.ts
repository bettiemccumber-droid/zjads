import { ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  aggregateLinkbuxActualCommissionsForSettlement,
  fetchLinkbuxMerchantCommissionsByPaidDate,
} from '../collectors/linkbux-payment-details.util';
import {
  aggregateLinkbuxPaymentsForSettlement,
  fetchLinkbuxPayments,
} from '../collectors/linkbux-payments.util';
import { AuthUser, isCompanyWideScope, resolveOwnerUserId } from '../common/ownership.util';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { monthToDateRange } from './settlement-monthly.util';
import { SettlementActualCommissionService } from './settlement-actual-commission.service';
import { SettlementReceivableCommissionService } from './settlement-receivable-commission.service';
import { persistPaymentHalvesByAccountOwner } from './settlement-commission-persist.util';
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
   * 从 LinkBux 付款历史 + Payment Details 同步 LB 列应收/实收
   * 应收优先对齐后台 Payment in Progress / Pending 提现单金额
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

        let paymentRows: Awaited<ReturnType<typeof fetchLinkbuxPayments>> = [];
        let paymentError: string | undefined;
        try {
          paymentRows = await fetchLinkbuxPayments(token, startDate, endDate);
        } catch (err) {
          paymentError = err instanceof Error ? err.message : String(err);
        }

        const fromPayments = aggregateLinkbuxPaymentsForSettlement(paymentRows, month);
        /** 应收：仅付款历史 Pending/In progress（当月发起提现），不用 merchant_commission 兜底 */
        const receivable = {
          usdH1: fromPayments.receivableH1,
          usdH2: fromPayments.receivableH2,
        };

        let actual = { usdH1: fromPayments.actualH1, usdH2: fromPayments.actualH2 };
        let detailRowCount = 0;
        try {
          const paidDetailRows = await fetchLinkbuxMerchantCommissionsByPaidDate(
            token,
            startDate,
            endDate,
          );
          detailRowCount = paidDetailRows.length;
          const fromDetails = aggregateLinkbuxActualCommissionsForSettlement(paidDetailRows, month);
          if (fromDetails.actualH1 + fromDetails.actualH2 > 0) {
            actual = { usdH1: fromDetails.actualH1, usdH2: fromDetails.actualH2 };
          }
        } catch (detailErr) {
          const msg = detailErr instanceof Error ? detailErr.message : String(detailErr);
          paymentError = paymentError ? `${paymentError}; ${msg}` : msg;
        }

        const recvTotal = receivable.usdH1 + receivable.usdH2;
        const warnNoHistory =
          recvTotal <= 0 &&
          paymentRows.length === 0 &&
          paymentError
            ? paymentError
            : recvTotal <= 0 && paymentRows.length === 0
              ? '未拉到 LB 付款历史：应收应对齐 Payment Summary Pending（需正确 payments 接口）'
              : undefined;

        receivableBatch[key] = receivable;
        actualBatch[key] = actual;
        synced.push({
          channelAccountId: account.id,
          displayName: account.displayName,
          affiliateAlias: account.affiliateAlias,
          receivable,
          actual,
          commissionRowCount: paymentRows.length + detailRowCount,
          error: warnNoHistory,
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
