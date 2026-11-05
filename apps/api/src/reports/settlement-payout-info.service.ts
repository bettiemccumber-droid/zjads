import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthUser, isAdmin } from '../common/ownership.util';
import { PrismaService } from '../prisma/prisma.service';
import { canEditSettlementActualCommission } from './settlement-report-scope.util';

export interface SettlementPayoutLineInput {
  channelAccountId: number;
  payeeName: string;
  bankAccount: string;
}

@Injectable()
export class SettlementPayoutInfoService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 批量保存各渠道账号的结算收款信息（与佣金矩阵列一一对应）
   */
  async saveLines(
    user: AuthUser,
    lines: SettlementPayoutLineInput[],
    queryUserId?: number,
  ): Promise<void> {
    if (!canEditSettlementActualCommission(user, queryUserId)) {
      throw new ForbiddenException('无权保存收款信息');
    }
    if (!lines.length) {
      return;
    }

    const normalized: SettlementPayoutLineInput[] = [];
    for (const raw of lines) {
      const channelAccountId = Number(raw.channelAccountId);
      if (!Number.isInteger(channelAccountId) || channelAccountId <= 0) {
        throw new BadRequestException('channelAccountId 无效');
      }
      normalized.push({
        channelAccountId,
        payeeName: String(raw.payeeName ?? '').trim().slice(0, 120),
        bankAccount: String(raw.bankAccount ?? '').trim().slice(0, 80),
      });
    }

    await this.prisma.$transaction(async (tx) => {
      for (const line of normalized) {
        const account = await tx.channelAccount.findUnique({
          where: { id: line.channelAccountId },
        });
        if (!account) {
          throw new NotFoundException(`渠道账号不存在: ${line.channelAccountId}`);
        }
        if (account.ownerUserId !== user.id && !isAdmin(user)) {
          throw new ForbiddenException('无权修改该渠道账号的收款信息');
        }
        await tx.channelAccount.update({
          where: { id: line.channelAccountId },
          data: {
            settlementPayeeName: line.payeeName,
            settlementBankAccount: line.bankAccount,
          },
        });
      }
    });
  }
}
