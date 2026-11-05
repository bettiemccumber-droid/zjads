import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthUser } from '../common/ownership.util';
import { PrismaService } from '../prisma/prisma.service';
import { roundMoney } from './settlement-monthly.util';
import {
  canEditSettlementActualCommission,
  resolveSettlementReportScopeKey,
} from './settlement-report-scope.util';

export interface SettlementAdSpendLineSaved {
  adjustmentUsd: number;
  spendUsd: number;
}

export interface SettlementAdSpendSavePayload {
  adSourceId: number;
  adjustmentUsd: number;
  spendUsd: number;
}

export interface SettlementMonthlyMetaSaved {
  rebateAdSpendUsd: number;
}

@Injectable()
export class SettlementAdSpendService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 读取某月各 MCC（广告数据源）的手工广告费
   */
  async loadLinesForMonth(
    scopeKey: string,
    month: string,
  ): Promise<Record<number, SettlementAdSpendLineSaved>> {
    const rows = await this.prisma.settlementAdSpendLine.findMany({
      where: { scopeKey, month },
    });
    const out: Record<number, SettlementAdSpendLineSaved> = {};
    for (const r of rows) {
      out[r.adSourceId] = {
        adjustmentUsd: roundMoney(Number(r.adjustmentUsd)),
        spendUsd: roundMoney(Number(r.spendUsd)),
      };
    }
    return out;
  }

  async loadMeta(scopeKey: string, month: string): Promise<SettlementMonthlyMetaSaved> {
    const row = await this.prisma.settlementMonthlyMeta.findUnique({
      where: { scopeKey_month: { scopeKey, month } },
    });
    return {
      rebateAdSpendUsd: roundMoney(Number(row?.rebateAdSpendUsd ?? 0)),
    };
  }

  /**
   * 保存广告费行与应返广告费
   */
  async save(
    user: AuthUser,
    month: string,
    lines: SettlementAdSpendSavePayload[],
    rebateAdSpendUsd: number,
    queryUserId?: number,
  ): Promise<{
    lines: Record<number, SettlementAdSpendLineSaved>;
    meta: SettlementMonthlyMetaSaved;
  }> {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new BadRequestException('month 须为 YYYY-MM');
    }
    if (!canEditSettlementActualCommission(user, queryUserId)) {
      throw new ForbiddenException('无权保存该范围的广告费');
    }
    const scopeKey = resolveSettlementReportScopeKey(user, queryUserId);
    const rebate = Number(rebateAdSpendUsd);
    if (!Number.isFinite(rebate) || rebate < 0) {
      throw new BadRequestException('应返广告费无效');
    }

    const normalized: SettlementAdSpendSavePayload[] = [];
    for (const raw of lines) {
      const adSourceId = Number(raw.adSourceId);
      const adjustmentUsd = Number(raw.adjustmentUsd);
      const spendUsd = Number(raw.spendUsd);
      if (!Number.isInteger(adSourceId) || adSourceId <= 0) {
        throw new BadRequestException('adSourceId 无效');
      }
      if (!Number.isFinite(adjustmentUsd) || !Number.isFinite(spendUsd)) {
        throw new BadRequestException(`广告费金额无效: MCC#${adSourceId}`);
      }
      if (spendUsd < 0) {
        throw new BadRequestException('广告费不能为负数');
      }
      normalized.push({
        adSourceId,
        adjustmentUsd: roundMoney(adjustmentUsd),
        spendUsd: roundMoney(spendUsd),
      });
    }

    await this.prisma.$transaction(async (tx) => {
      for (const line of normalized) {
        await tx.settlementAdSpendLine.upsert({
          where: {
            scopeKey_month_adSourceId: {
              scopeKey,
              month,
              adSourceId: line.adSourceId,
            },
          },
          create: {
            scopeKey,
            month,
            adSourceId: line.adSourceId,
            adjustmentUsd: line.adjustmentUsd,
            spendUsd: line.spendUsd,
            updatedById: user.id,
          },
          update: {
            adjustmentUsd: line.adjustmentUsd,
            spendUsd: line.spendUsd,
            updatedById: user.id,
          },
        });
      }
      await tx.settlementMonthlyMeta.upsert({
        where: { scopeKey_month: { scopeKey, month } },
        create: {
          scopeKey,
          month,
          rebateAdSpendUsd: roundMoney(rebate),
          updatedById: user.id,
        },
        update: {
          rebateAdSpendUsd: roundMoney(rebate),
          updatedById: user.id,
        },
      });
    });

    return {
      lines: await this.loadLinesForMonth(scopeKey, month),
      meta: await this.loadMeta(scopeKey, month),
    };
  }
}
