import { Injectable } from '@nestjs/common';
import { AuthUser } from '../common/ownership.util';
import { SettlementCollabglowPaymentsSyncService } from './settlement-collabglow-payments-sync.service';
import { SettlementFamestaPaymentsSyncService } from './settlement-famesta-payments-sync.service';
import { SettlementLinkbuxPaymentsSyncService } from './settlement-linkbux-payments-sync.service';
import { SettlementLinkhaitaoPaymentsSyncService } from './settlement-linkhaitao-payments-sync.service';
import { SettlementPartnermaticPaymentsSyncService } from './settlement-partnermatic-payments-sync.service';
import { SettlementRewardooPaymentsSyncService } from './settlement-rewardoo-payments-sync.service';
import { SettlementUltrainfluencePaymentsSyncService } from './settlement-ultrainfluence-payments-sync.service';

export interface AllPaymentsSyncResult {
  month: string;
  platforms: Array<{
    platform: string;
    synced: number;
    failed: number;
  }>;
}

/**
 * 按平台顺序同步全部打款数据（写入各渠道账号所属员工 scope）
 */
@Injectable()
export class SettlementAllPaymentsSyncService {
  constructor(
    private readonly rewardoo: SettlementRewardooPaymentsSyncService,
    private readonly linkbux: SettlementLinkbuxPaymentsSyncService,
    private readonly linkhaitao: SettlementLinkhaitaoPaymentsSyncService,
    private readonly partnermatic: SettlementPartnermaticPaymentsSyncService,
    private readonly ultrainfluence: SettlementUltrainfluencePaymentsSyncService,
    private readonly famesta: SettlementFamestaPaymentsSyncService,
    private readonly collabglow: SettlementCollabglowPaymentsSyncService,
  ) {}

  async syncForMonth(
    user: AuthUser,
    month: string,
    queryUserId?: number,
  ): Promise<AllPaymentsSyncResult> {
    const runners: Array<{ platform: string; run: () => Promise<{ synced: unknown[] }> }> = [
      { platform: 'rewardoo', run: () => this.rewardoo.syncForMonth(user, month, queryUserId) },
      { platform: 'linkbux', run: () => this.linkbux.syncForMonth(user, month, queryUserId) },
      { platform: 'linkhaitao', run: () => this.linkhaitao.syncForMonth(user, month, queryUserId) },
      {
        platform: 'partnermatic',
        run: () => this.partnermatic.syncForMonth(user, month, queryUserId),
      },
      {
        platform: 'ultrainfluence',
        run: () => this.ultrainfluence.syncForMonth(user, month, queryUserId),
      },
      { platform: 'famesta', run: () => this.famesta.syncForMonth(user, month, queryUserId) },
      { platform: 'collabglow', run: () => this.collabglow.syncForMonth(user, month, queryUserId) },
    ];

    const platforms: AllPaymentsSyncResult['platforms'] = [];
    for (const { platform, run } of runners) {
      try {
        const result = await run();
        const lines = result.synced as Array<{ error?: string }>;
        platforms.push({
          platform,
          synced: lines.filter((l) => !l.error).length,
          failed: lines.filter((l) => l.error).length,
        });
      } catch {
        platforms.push({ platform, synced: 0, failed: 1 });
      }
    }

    return { month, platforms };
  }
}
