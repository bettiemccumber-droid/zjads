import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthUser } from '../common/ownership.util';
import { PrismaService } from '../prisma/prisma.service';
import { roundMoney } from './settlement-monthly.util';
import {
  canEditSettlementActualCommission,
  resolveSettlementReportScopeKey,
} from './settlement-report-scope.util';

export interface SettlementReceivableCommissionHalf {
  usdH1: number;
  usdH2: number;
}

@Injectable()
export class SettlementReceivableCommissionService {
  constructor(private readonly prisma: PrismaService) {}

  private parseRow(row: {
    amountUsd: unknown;
    amountUsdH1: unknown;
    amountUsdH2: unknown;
  }): SettlementReceivableCommissionHalf {
    let h1 = roundMoney(Number(row.amountUsdH1 ?? 0));
    let h2 = roundMoney(Number(row.amountUsdH2 ?? 0));
    const legacy = roundMoney(Number(row.amountUsd ?? 0));
    if (h1 === 0 && h2 === 0 && legacy > 0) {
      h2 = legacy;
    }
    return { usdH1: h1, usdH2: h2 };
  }

  /**
   * 读取某月各渠道账号列的平台口径应收佣金 (USD，上下半月)
   */
  async loadHalvesForMonth(
    scopeKey: string,
    month: string,
  ): Promise<Record<string, SettlementReceivableCommissionHalf>> {
    const rows = await this.prisma.settlementReceivableCommission.findMany({
      where: { scopeKey, month },
    });
    const out: Record<string, SettlementReceivableCommissionHalf> = {};
    for (const r of rows) {
      out[r.affiliateKey] = this.parseRow(r);
    }
    return out;
  }

  /**
   * 批量保存应收佣金（各平台后台体现，如 LinkBux Payment in Progress）
   */
  async saveHalves(
    user: AuthUser,
    month: string,
    values: Record<string, SettlementReceivableCommissionHalf>,
    queryUserId?: number,
  ): Promise<Record<string, SettlementReceivableCommissionHalf>> {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new BadRequestException('month 须为 YYYY-MM');
    }
    if (!canEditSettlementActualCommission(user, queryUserId)) {
      throw new ForbiddenException('无权保存该范围的应收佣金');
    }
    const scopeKey = resolveSettlementReportScopeKey(user, queryUserId);
    const normalized: Record<string, SettlementReceivableCommissionHalf> = {};

    for (const [key, raw] of Object.entries(values)) {
      const affiliateKey = key.trim().toLowerCase();
      if (!affiliateKey) continue;
      const h1 = Number(raw.usdH1);
      const h2 = Number(raw.usdH2);
      if (!Number.isFinite(h1) || !Number.isFinite(h2)) {
        throw new BadRequestException(`应收金额无效: ${key}`);
      }
      if (h1 < 0 || h2 < 0) {
        throw new BadRequestException('应收佣金不能为负数');
      }
      normalized[affiliateKey] = { usdH1: roundMoney(h1), usdH2: roundMoney(h2) };
    }

    await this.prisma.$transaction(async (tx) => {
      for (const [affiliateKey, half] of Object.entries(normalized)) {
        const total = roundMoney(half.usdH1 + half.usdH2);
        await tx.settlementReceivableCommission.upsert({
          where: {
            scopeKey_month_affiliateKey: { scopeKey, month, affiliateKey },
          },
          create: {
            scopeKey,
            month,
            affiliateKey,
            amountUsdH1: half.usdH1,
            amountUsdH2: half.usdH2,
            amountUsd: total,
            updatedById: user.id,
          },
          update: {
            amountUsdH1: half.usdH1,
            amountUsdH2: half.usdH2,
            amountUsd: total,
            updatedById: user.id,
          },
        });
      }
    });

    return this.loadHalvesForMonth(scopeKey, month);
  }
}
