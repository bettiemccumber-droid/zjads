import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CryptoService } from '../common/crypto.service';
import { AuthUser, isAdmin } from '../common/ownership.util';
import { PrismaService } from '../prisma/prisma.service';
import { parseMerchantQueryText } from './merchant-status-normalizer';
import {
  buildMerchantQueryKey,
  isMerchantStatusPlatformSupported,
  matchMerchantStatusFromPreload,
  preloadMonetizationBrandsForAccount,
  summarizeMerchantStatusRows,
} from './merchant-status-query.util';
import {
  MerchantQueryItem,
  MerchantStatusAdminSummaryResult,
  MerchantStatusQueryResult,
  MerchantStatusRow,
  PlatformPassSummary,
  UserMerchantPassSummary,
} from './merchant-status.types';

export interface MerchantStatusQueryDto {
  items: MerchantQueryItem[];
  channelAccountIds?: number[];
  targetUserId?: number;
}

export interface MerchantStatusSummaryDto {
  items: MerchantQueryItem[];
  userIds?: number[];
}

@Injectable()
export class MerchantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * 解析粘贴文本为查询项
   */
  parseQueryText(text: string): MerchantQueryItem[] {
    const items = parseMerchantQueryText(text);
    if (items.length === 0) {
      throw new BadRequestException('未解析到有效的 MID 或 mcid');
    }
    if (items.length > 500) {
      throw new BadRequestException('单次最多查询 500 个商家');
    }
    return items;
  }

  /**
   * 员工 / 管理员代查：查询指定员工的商家状态
   */
  async queryStatus(user: AuthUser, dto: MerchantStatusQueryDto): Promise<MerchantStatusQueryResult> {
    const ownerId = this.resolveTargetOwnerId_(user, dto.targetUserId);
    const items = this.normalizeQueryItems_(dto.items);
    const accounts = await this.loadAccountsForQuery_(ownerId, dto.channelAccountIds);

    const rows = await this.queryRowsForAccounts_(items, accounts, ownerId);
    return { items: rows, summary: summarizeMerchantStatusRows(rows) };
  }

  /**
   * 管理员：同一批商家，跨员工汇总各平台通过数
   */
  async queryAdminSummary(
    user: AuthUser,
    dto: MerchantStatusSummaryDto,
  ): Promise<MerchantStatusAdminSummaryResult> {
    if (!isAdmin(user)) {
      throw new ForbiddenException('仅管理员可使用汇总查询');
    }

    const items = this.normalizeQueryItems_(dto.items);
    const userIds = await this.resolveSummaryUserIds_(dto.userIds);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, isActive: true },
      select: { id: true, username: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u.username]));

    const byUser: UserMerchantPassSummary[] = [];
    const allRows: MerchantStatusRow[] = [];

    for (const uid of userIds) {
      const username = userMap.get(uid) ?? `#${uid}`;
      const accounts = await this.loadAccountsForQuery_(uid);
      const rows = await this.queryRowsForAccounts_(items, accounts, uid, username);
      allRows.push(...rows);
      byUser.push(this.buildUserPassSummary_(uid, username, rows));
    }

    return {
      byUser,
      grandTotal: summarizeMerchantStatusRows(allRows),
    };
  }

  /**
   * 列出某员工可用于商家状态查询的渠道账号
   */
  async listQueryableAccounts(user: AuthUser, targetUserId?: number) {
    const ownerId = this.resolveTargetOwnerId_(user, targetUserId);
    const accounts = await this.prisma.channelAccount.findMany({
      where: { ownerUserId: ownerId, isActive: true },
      include: { platform: true },
      orderBy: [{ platform: { sortOrder: 'asc' } }, { id: 'asc' }],
    });

    return accounts.map((a) => ({
      id: a.id,
      displayName: a.displayName,
      affiliateAlias: a.affiliateAlias,
      platformCode: a.platform.code,
      platformName: a.platform.name,
      statusQuerySupported: isMerchantStatusPlatformSupported(a.platform.code),
    }));
  }

  private resolveTargetOwnerId_(user: AuthUser, targetUserId?: number): number {
    if (targetUserId != null) {
      if (user.role !== UserRole.ADMIN && targetUserId !== user.id) {
        throw new ForbiddenException('无权查看其他员工的商家状态');
      }
      return targetUserId;
    }
    return user.id;
  }

  private normalizeQueryItems_(items: MerchantQueryItem[]): MerchantQueryItem[] {
    if (!items?.length) {
      throw new BadRequestException('请至少提供一个商家（MID / mcid / 域名）');
    }
    const normalized: MerchantQueryItem[] = [];
    const seen = new Set<string>();

    for (const raw of items) {
      const merchantId = raw.merchantId?.trim() || undefined;
      const mcid = raw.mcid?.trim().toLowerCase() || undefined;
      const domain = raw.domain?.trim().toLowerCase() || undefined;
      if (!merchantId && !mcid && !domain) continue;

      const key = buildMerchantQueryKey({ merchantId, mcid, domain });
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push({ merchantId, mcid, domain });
    }

    if (normalized.length === 0) {
      throw new BadRequestException('请至少提供一个有效的商家标识');
    }
    if (normalized.length > 500) {
      throw new BadRequestException('单次最多查询 500 个商家');
    }
    return normalized;
  }

  private async loadAccountsForQuery_(ownerId: number, channelAccountIds?: number[]) {
    const accounts = await this.prisma.channelAccount.findMany({
      where: {
        ownerUserId: ownerId,
        isActive: true,
        ...(channelAccountIds?.length ? { id: { in: channelAccountIds } } : {}),
      },
      include: { platform: true },
      orderBy: [{ platform: { sortOrder: 'asc' } }, { id: 'asc' }],
    });

    if (accounts.length === 0) {
      throw new NotFoundException('未找到可用的平台账号，请先在「我的平台账号」中配置');
    }

    if (channelAccountIds?.length) {
      const found = new Set(accounts.map((a) => a.id));
      const missing = channelAccountIds.filter((id) => !found.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(`渠道账号不存在或不可用：${missing.join(', ')}`);
      }
    }

    return accounts;
  }

  private async resolveSummaryUserIds_(userIds?: number[]): Promise<number[]> {
    if (userIds?.length) {
      return userIds;
    }
    const users = await this.prisma.user.findMany({
      where: { isActive: true, role: { in: [UserRole.OPERATOR, UserRole.VIEWER] } },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  private async queryRowsForAccounts_(
    items: MerchantQueryItem[],
    accounts: Array<{
      id: number;
      displayName: string;
      affiliateAlias: string;
      credentialsEnc: string;
      platform: { code: string; name: string };
    }>,
    ownerUserId: number,
    ownerUsername?: string,
  ): Promise<MerchantStatusRow[]> {
    const username =
      ownerUsername ??
      (await this.prisma.user.findUnique({ where: { id: ownerUserId }, select: { username: true } }))
        ?.username ??
      `#${ownerUserId}`;

    const rows: MerchantStatusRow[] = [];

    for (const account of accounts) {
      if (!isMerchantStatusPlatformSupported(account.platform.code)) {
        for (const query of items) {
          rows.push({
            queryKey: buildMerchantQueryKey(query),
            merchantId: query.merchantId ?? null,
            mcid: query.mcid ?? null,
            merchantName: null,
            siteUrl: null,
            platformCode: account.platform.code,
            platformName: account.platform.name,
            channelAccountId: account.id,
            channelDisplayName: account.displayName,
            affiliateAlias: account.affiliateAlias,
            ownerUserId,
            ownerUsername: username,
            relationshipStatus: 'unknown',
            relationshipRaw: null,
            merchantAvailability: 'unknown',
            availabilityRaw: null,
            actionable: false,
            actionLabel: '查询失败',
            queriedAt: new Date().toISOString(),
            error: `平台 ${account.platform.name} 暂不支持商家状态查询`,
          });
        }
        continue;
      }

      let apiToken: string;
      try {
        const cred = this.crypto.decrypt<{ apiToken: string }>(account.credentialsEnc);
        apiToken = cred.apiToken;
      } catch {
        for (const query of items) {
          rows.push({
            queryKey: buildMerchantQueryKey(query),
            merchantId: query.merchantId ?? null,
            mcid: query.mcid ?? null,
            merchantName: null,
            siteUrl: null,
            platformCode: account.platform.code,
            platformName: account.platform.name,
            channelAccountId: account.id,
            channelDisplayName: account.displayName,
            affiliateAlias: account.affiliateAlias,
            ownerUserId,
            ownerUsername: username,
            relationshipStatus: 'unknown',
            relationshipRaw: null,
            merchantAvailability: 'unknown',
            availabilityRaw: null,
            actionable: false,
            actionLabel: '查询失败',
            queriedAt: new Date().toISOString(),
            error: '渠道 Token 解密失败',
          });
        }
        continue;
      }

      let brands;
      try {
        brands = await preloadMonetizationBrandsForAccount(
          account.platform.code,
          apiToken,
          items,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        for (const query of items) {
          rows.push({
            queryKey: buildMerchantQueryKey(query),
            merchantId: query.merchantId ?? null,
            mcid: query.mcid ?? null,
            merchantName: null,
            siteUrl: null,
            platformCode: account.platform.code,
            platformName: account.platform.name,
            channelAccountId: account.id,
            channelDisplayName: account.displayName,
            affiliateAlias: account.affiliateAlias,
            ownerUserId,
            ownerUsername: username,
            relationshipStatus: 'unknown',
            relationshipRaw: null,
            merchantAvailability: 'unknown',
            availabilityRaw: null,
            actionable: false,
            actionLabel: '查询失败',
            queriedAt: new Date().toISOString(),
            error: message,
          });
        }
        continue;
      }

      for (const query of items) {
        rows.push(
          matchMerchantStatusFromPreload(
            {
              query,
              queryKey: buildMerchantQueryKey(query),
              platformCode: account.platform.code,
              platformName: account.platform.name,
              channelAccountId: account.id,
              channelDisplayName: account.displayName,
              affiliateAlias: account.affiliateAlias,
              ownerUserId,
              ownerUsername: username,
            },
            brands,
          ),
        );
      }
    }

    return rows;
  }

  private buildUserPassSummary_(
    userId: number,
    username: string,
    rows: MerchantStatusRow[],
  ): UserMerchantPassSummary {
    const platformMap = new Map<string, PlatformPassSummary>();

    for (const row of rows) {
      const key = row.platformCode;
      if (!platformMap.has(key)) {
        platformMap.set(key, {
          platformCode: row.platformCode,
          platformName: row.platformName,
          passed: 0,
          pending: 0,
          notPassed: 0,
          failed: 0,
        });
      }
      const agg = platformMap.get(key)!;
      if (row.error) agg.failed += 1;
      else if (row.actionable) agg.passed += 1;
      else if (row.relationshipStatus === 'pending') agg.pending += 1;
      else agg.notPassed += 1;
    }

    const byPlatform = [...platformMap.values()].sort((a, b) =>
      a.platformName.localeCompare(b.platformName),
    );
    const totalPassed = byPlatform.reduce((s, p) => s + p.passed, 0);

    return { userId, username, byPlatform, totalPassed };
  }
}
