import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { resolveOwnerUserId } from '../common/ownership.util';
import { CryptoService } from '../common/crypto.service';
import { AuthUser, isAdmin } from '../common/ownership.util';
import { PrismaService } from '../prisma/prisma.service';
import { mapCatalogOffer, monetizationRowMatchesText, parseMerchantQueryText } from './merchant-status-normalizer';
import {
  browseMonetizationPage,
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
  MonetizationBrandRow,
  PlatformPassSummary,
  RelationshipStatus,
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

export interface DiscoverMerchantQuery {
  channelAccountId?: number;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface DiscoverMerchantRow {
  channelAccountId: number;
  platformCode: string;
  platformName: string;
  accountName: string;
  mid: string;
  mcid: string | null;
  name: string;
  merchantUrl: string;
  commRate: string;
  categories: string;
  countryCode: string;
  supportRegion: string;
  tags: string;
  logo: string;
  relationship: RelationshipStatus;
  relationshipLabel: string;
  claimed: boolean;
}

export interface DiscoverMerchantResult {
  total: number;
  page: number;
  pageSize: number;
  rows: DiscoverMerchantRow[];
  errors: Array<{ channelAccountId: number; platformCode: string; message: string }>;
  hint: string;
}

@Injectable()
export class MerchantsService {
  /** 名称搜索只扫每个账号商家库的前 2000 条，避免每次把全库拉下来。 */
  private readonly discoverScanCache = new Map<number, { at: number; rows: MonetizationBrandRow[]; truncated: boolean }>();

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
    return resolveOwnerUserId(user, targetUserId, 'read');
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

  /**
   * 按联盟账号和 MID 向平台要商家网址。选中在投商家后用来自动带出网址。
   */
  /**
   * 从员工的联盟账号里翻已经通过审核的商家。领取这些商家会直接做广告。
   */
  async browseMerchantCatalog(ownerUserId: number, query: DiscoverMerchantQuery): Promise<DiscoverMerchantResult> {
    const page = Math.max(1, Math.floor(query.page ?? 1) || 1);
    const pageSize = Math.min(50, Math.max(1, Math.floor(query.pageSize ?? 20) || 20));
    const q = (query.q ?? '').trim();
    const accounts = await this.loadAccountsForQuery_(
      ownerUserId,
      query.channelAccountId ? [query.channelAccountId] : undefined,
    );
    const errors: DiscoverMerchantResult['errors'] = [];
    const collected: Array<DiscoverMerchantRow & { sort: number }> = [];
    let total = 0;
    let truncated = false;
    let pendingOnly = 0;

    if (!query.channelAccountId && page > 1) {
      throw new BadRequestException('翻页请先选择一个联盟账号');
    }

    for (const account of accounts) {
      if (!isMerchantStatusPlatformSupported(account.platform.code)) {
        errors.push({
          channelAccountId: account.id,
          platformCode: account.platform.code,
          message: `${account.platform.name} 暂不支持商家库`,
        });
        continue;
      }
      let apiToken = '';
      try {
        apiToken = this.crypto.decrypt<{ apiToken: string }>(account.credentialsEnc).apiToken;
      } catch {
        errors.push({
          channelAccountId: account.id,
          platformCode: account.platform.code,
          message: `${account.displayName} 的 Token 解密失败`,
        });
        continue;
      }
      if (!apiToken) {
        errors.push({
          channelAccountId: account.id,
          platformCode: account.platform.code,
          message: `${account.displayName} 没有 API Token`,
        });
        continue;
      }

      try {
        if (/^\d+$/.test(q)) {
          const brands = await preloadMonetizationBrandsForAccount(account.platform.code, apiToken, [{ merchantId: q }]);
          const approved = brands.filter((row) => this.isApprovedMerchant_(row));
          pendingOnly += brands.length - approved.length;
          total += approved.length;
          approved.forEach((row, index) => {
            const mapped = this.toDiscoverRow_(account, row);
            if (mapped) collected.push({ ...mapped, sort: index });
          });
          continue;
        }

        if (q) {
          const scanned = await this.loadDiscoverScan_(account.platform.code, account.id, apiToken);
          if (scanned.truncated) truncated = true;
          const matched = scanned.rows.filter((row) => this.isApprovedMerchant_(row) && monetizationRowMatchesText(row, q));
          total += matched.length;
          const start = query.channelAccountId ? (page - 1) * pageSize : 0;
          const slice = query.channelAccountId ? matched.slice(start, start + pageSize) : matched.slice(0, pageSize);
          slice.forEach((row, index) => {
            const mapped = this.toDiscoverRow_(account, row);
            if (mapped) collected.push({ ...mapped, sort: index });
          });
          continue;
        }

        const browsed = await browseMonetizationPage(account.platform.code, apiToken, page, pageSize, 'Joined');
        const approved = browsed.rows.filter((row) => this.isApprovedMerchant_(row));
        total += approved.length === browsed.rows.length ? browsed.total : approved.length;
        approved.forEach((row, index) => {
          const mapped = this.toDiscoverRow_(account, row);
          if (mapped) collected.push({ ...mapped, sort: index });
        });
      } catch (err) {
        errors.push({
          channelAccountId: account.id,
          platformCode: account.platform.code,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const mids = [...new Set(collected.map((row) => row.mid))];
    const claimed = mids.length
      ? await this.prisma.catalogMerchant.findMany({
          where: { ownerUserId, mid: { in: mids }, blockReason: 'none' },
          select: { channelAccountId: true, mid: true },
        })
      : [];
    const claimedKeys = new Set(claimed.map((row) => `${row.channelAccountId}:${row.mid}`));
    const rows = collected.map(({ sort: _sort, ...row }) => ({
      ...row,
      claimed: claimedKeys.has(`${row.channelAccountId}:${row.mid}`),
    }));

    return {
      total,
      page,
      pageSize,
      rows,
      errors,
      hint: collected.length === 0 && pendingOnly > 0
        ? '这个商家还没通过审核，不能领取。选取商家只列出已经通过审核、可以投放的商家。'
        : q && !/^\d+$/.test(q) && truncated
          ? '名称只在已通过审核的商家里匹配前 2000 条。知道 MID 时直接搜 MID。'
          : '',
    };
  }

  async lookupMerchantSite(ownerUserId: number, channelAccountId: number, merchantId: string) {
    const mid = merchantId.trim();
    if (!mid) return { siteUrl: '', merchantName: null as string | null };
    const saved = await this.prisma.catalogMerchant.findFirst({
      where: {
        ownerUserId,
        mid,
        blockReason: 'none',
        ...(channelAccountId ? { channelAccountId } : {}),
      },
    });
    if (saved?.merchantUrl) {
      return {
        siteUrl: normalizeMerchantSiteUrl(saved.merchantUrl),
        merchantName: saved.name,
        error: null,
        relationshipStatus: 'joined' as const,
      };
    }
    if (!channelAccountId) return { siteUrl: '', merchantName: null as string | null };
    const accounts = await this.loadAccountsForQuery_(ownerUserId, [channelAccountId]);
    const rows = await this.queryRowsForAccounts_([{ merchantId: mid }], accounts, ownerUserId);
    const row = rows.find((item) => item.siteUrl) ?? rows[0];
    return {
      siteUrl: normalizeMerchantSiteUrl(row?.siteUrl ?? ''),
      merchantName: row?.merchantName?.trim() || null,
      error: row?.error ?? null,
      relationshipStatus: row?.relationshipStatus ?? null,
    };
  }

  /**
   * 名称搜索缓存一页 2000 条，10 分钟内重复搜索不再打平台。
   */
  private async loadDiscoverScan_(platformCode: string, channelAccountId: number, apiToken: string) {
    const cached = this.discoverScanCache.get(channelAccountId);
    if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached;
    const browsed = await browseMonetizationPage(platformCode, apiToken, 1, 2000, 'Joined');
    const entry = {
      at: Date.now(),
      rows: browsed.rows,
      truncated: browsed.pages > 1 || browsed.total > browsed.rows.length,
    };
    this.discoverScanCache.set(channelAccountId, entry);
    return entry;
  }

  /**
   * 已经加入并且平台标记为可投放。待审核、未加入的不出现在选取商家里。
   */
  private isApprovedMerchant_(row: MonetizationBrandRow): boolean {
    const offer = mapCatalogOffer(row);
    return offer.relationshipStatus === 'joined';
  }

  /**
   * 平台原始行转成选取商家表格的一行。没有 MID 的跳过。
   */
  private toDiscoverRow_(
    account: { id: number; displayName: string; platform: { code: string; name: string } },
    row: MonetizationBrandRow,
  ): DiscoverMerchantRow | null {
    const offer = mapCatalogOffer(row);
    const mid = offer.merchantId || offer.mcid || '';
    const name = offer.merchantName?.trim() || '';
    if (!mid || !name) return null;
    return {
      channelAccountId: account.id,
      platformCode: account.platform.code,
      platformName: account.platform.name,
      accountName: account.displayName,
      mid,
      mcid: offer.mcid,
      name,
      merchantUrl: normalizeMerchantSiteUrl(offer.siteUrl ?? ''),
      commRate: offer.commRate,
      categories: offer.categories,
      countryCode: offer.countryCode,
      supportRegion: offer.supportRegion,
      tags: offer.tags,
      logo: offer.logo,
      relationship: offer.relationshipStatus,
      relationshipLabel: RELATIONSHIP_LABEL[offer.relationshipStatus],
      claimed: false,
    };
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

/**
 * 平台返回的网址补上协议，方便直接当商家网址用。
 */
const RELATIONSHIP_LABEL: Record<RelationshipStatus, string> = {
  joined: '已加入',
  pending: '待审核',
  rejected: '已拒绝',
  not_joined: '未加入',
  not_found: '无此商家',
  unknown: '未知',
};

function normalizeMerchantSiteUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
