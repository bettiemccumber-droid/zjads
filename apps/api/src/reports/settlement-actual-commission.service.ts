import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthUser } from '../common/ownership.util';
import { PrismaService } from '../prisma/prisma.service';
import { roundMoney } from './settlement-monthly.util';
import {
  canEditSettlementActualCommission,
  resolveSettlementReportScopeKey,
} from './settlement-report-scope.util';

export interface SettlementActualCommissionHalf {
  usdH1: number;
  usdH2: number;
}

@Injectable()
export class SettlementActualCommissionService {
  constructor(private readonly prisma: PrismaService) {}

  private parseRow(row: {
    amountUsd: unknown;
    amountUsdH1: unknown;
    amountUsdH2: unknown;
  }): SettlementActualCommissionHalf {
    let h1 = roundMoney(Number(row.amountUsdH1 ?? 0));
    let h2 = roundMoney(Number(row.amountUsdH2 ?? 0));
    const legacy = roundMoney(Number(row.amountUsd ?? 0));
    if (h1 === 0 && h2 === 0 && legacy > 0) {
      h2 = legacy;
    }
    return { usdH1: h1, usdH2: h2 };
  }

  /**
   * 读取某月各联盟序号列的实收佣金 (USD，上下半月)
   */
  async loadHalvesForMonth(
    scopeKey: string,
    month: string,
  ): Promise<Record<string, SettlementActualCommissionHalf>> {
    const rows = await this.prisma.settlementActualCommission.findMany({
      where: { scopeKey, month },
    });
    const out: Record<string, SettlementActualCommissionHalf> = {};
    for (const r of rows) {
      out[r.affiliateKey] = this.parseRow(r);
    }
    return out;
  }

  /** @deprecated 兼容年度汇总：按列合计实收 */
  async loadForMonth(scopeKey: string, month: string): Promise<Record<string, number>> {
    const halves = await this.loadHalvesForMonth(scopeKey, month);
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(halves)) {
      out[k] = roundMoney(v.usdH1 + v.usdH2);
    }
    return out;
  }

  async loadYearSum(scopeKey: string, year: string): Promise<Record<string, number>> {
    const rows = await this.prisma.settlementActualCommission.findMany({
      where: {
        scopeKey,
        month: { gte: `${year}-01`, lte: `${year}-12` },
      },
    });
    const out: Record<string, number> = {};
    for (const r of rows) {
      const { usdH1, usdH2 } = this.parseRow(r);
      out[r.affiliateKey] = roundMoney((out[r.affiliateKey] ?? 0) + usdH1 + usdH2);
    }
    return out;
  }

  /**
   * 批量保存实收佣金（上下半月 USD）
   */
  async saveHalves(
    user: AuthUser,
    month: string,
    values: Record<string, SettlementActualCommissionHalf>,
    queryUserId?: number,
  ): Promise<Record<string, SettlementActualCommissionHalf>> {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new BadRequestException('month 须为 YYYY-MM');
    }
    if (!canEditSettlementActualCommission(user, queryUserId)) {
      throw new ForbiddenException('无权保存该范围的实收佣金');
    }
    const scopeKey = resolveSettlementReportScopeKey(user, queryUserId);
    return this.saveHalvesWithScopeKey(user, month, scopeKey, values);
  }

  /**
   * 写入指定 scope（打款同步固定用 user:{渠道账号所属员工}）
   */
  async saveHalvesWithScopeKey(
    user: AuthUser,
    month: string,
    scopeKey: string,
    values: Record<string, SettlementActualCommissionHalf>,
  ): Promise<Record<string, SettlementActualCommissionHalf>> {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new BadRequestException('month 须为 YYYY-MM');
    }
    this.assertScopeWrite(user, scopeKey);

    const normalized: Record<string, SettlementActualCommissionHalf> = {};
    for (const [key, raw] of Object.entries(values)) {
      const affiliateKey = key.trim().toLowerCase();
      if (!affiliateKey) continue;
      const h1 = Number(raw.usdH1);
      const h2 = Number(raw.usdH2);
      if (!Number.isFinite(h1) || !Number.isFinite(h2)) {
        throw new BadRequestException(`实收金额无效: ${key}`);
      }
      if (h1 < 0 || h2 < 0) {
        throw new BadRequestException('实收佣金不能为负数');
      }
      normalized[affiliateKey] = { usdH1: roundMoney(h1), usdH2: roundMoney(h2) };
    }

    await this.prisma.$transaction(async (tx) => {
      for (const [affiliateKey, half] of Object.entries(normalized)) {
        const total = roundMoney(half.usdH1 + half.usdH2);
        await tx.settlementActualCommission.upsert({
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

  private assertScopeWrite(user: AuthUser, scopeKey: string): void {
    if (user.role === UserRole.ADMIN) return;
    const m = /^user:(\d+)$/.exec(scopeKey);
    if (m && Number(m[1]) === user.id) return;
    throw new ForbiddenException('无权写入该 scope 的实收佣金');
  }

  /**
   * 兼容旧客户端：单列合计写入下半月
   */
  async save(
    user: AuthUser,
    month: string,
    values: Record<string, number>,
    queryUserId?: number,
  ): Promise<Record<string, number>> {
    const halves: Record<string, SettlementActualCommissionHalf> = {};
    for (const [k, v] of Object.entries(values)) {
      halves[k] = { usdH1: 0, usdH2: roundMoney(Number(v)) };
    }
    const saved = await this.saveHalves(user, month, halves, queryUserId);
    const out: Record<string, number> = {};
    for (const [k, h] of Object.entries(saved)) {
      out[k] = roundMoney(h.usdH1 + h.usdH2);
    }
    return out;
  }
}
