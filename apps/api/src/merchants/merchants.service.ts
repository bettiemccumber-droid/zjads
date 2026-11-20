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
  /** 按联盟平台筛选；与 channelAccountId 二选一，优先账号 */
  platformCode?: string;
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
  /** 无搜索词翻页缓存。单页结果，10 分钟内同账号同页秒开。 */
  private readonly discoverPageCache = new Map<string, {
    at: number;
    rows: MonetizationBrandRow[];
    total: number;
    pages: number;
  }>();
  /** 我的商家按 MID 补商标。十分钟内不重复打联盟。 */
  private readonly logoCache = new Map<string, { at: number; logo: string }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  private withTimeout_<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} 超时（${Math.round(ms / 1000)}s）`)), ms);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

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
    const platformCode = (query.platformCode ?? '').trim().toLowerCase();
    let accounts = await this.loadAccountsForQuery_(
      ownerUserId,
      query.channelAccountId ? [query.channelAccountId] : undefined,
    );
    if (!query.channelAccountId && platformCode) {
      accounts = accounts.filter((account) => account.platform.code.toLowerCase() === platformCode);
      if (accounts.length === 0) {
        throw new BadRequestException(`没有可用的 ${platformCode} 联盟账号`);
      }
    }
    const scoped = Boolean(query.channelAccountId || platformCode);
    const errors: DiscoverMerchantResult['errors'] = [];
    const collected: Array<DiscoverMerchantRow & { sort: number }> = [];
    let total = 0;
    let truncated = false;
    let pendingOnly = 0;

    if (!scoped && page > 1) {
      throw new BadRequestException('翻页请先选择一个联盟平台');
    }

    // 全平台只向每个账号要够交错的一小段，单平台才拉满一页
    const browseSize = !scoped && !q
      ? Math.max(6, Math.ceil(pageSize / Math.max(1, accounts.length)))
      : pageSize;
    // 浏览 12s、名称扫描 25s；避免某个联盟拖到 axios 120s
    const browseTimeoutMs = 12_000;
    const scanTimeoutMs = 25_000;

    // 多个联盟账号并行拉库，避免「全平台」串行排队很久
    const settled = await Promise.all(accounts.map(async (account) => {
      if (!isMerchantStatusPlatformSupported(account.platform.code)) {
        return {
          error: {
            channelAccountId: account.id,
            platformCode: account.platform.code,
            message: `${account.platform.name} 暂不支持商家库`,
          } as DiscoverMerchantResult['errors'][number],
        };
      }
      let apiToken = '';
      try {
        apiToken = this.crypto.decrypt<{ apiToken: string }>(account.credentialsEnc).apiToken;
      } catch {
        return {
          error: {
            channelAccountId: account.id,
            platformCode: account.platform.code,
            message: `${account.displayName} 的 Token 解密失败`,
          } as DiscoverMerchantResult['errors'][number],
        };
      }
      if (!apiToken) {
        return {
          error: {
            channelAccountId: account.id,
            platformCode: account.platform.code,
            message: `${account.displayName} 没有 API Token`,
          } as DiscoverMerchantResult['errors'][number],
        };
      }

      try {
        if (/^\d+$/.test(q)) {
          const brands = await this.withTimeout_(
            preloadMonetizationBrandsForAccount(account.platform.code, apiToken, [{ merchantId: q }]),
            browseTimeoutMs,
            account.platform.name,
          );
          const approved = brands.filter((row) => this.isApprovedMerchant_(row));
          return {
            pendingOnly: brands.length - approved.length,
            total: approved.length,
            rows: approved
              .map((row, index) => {
                const mapped = this.toDiscoverRow_(account, row);
                return mapped ? { ...mapped, sort: index } : null;
              })
              .filter((row): row is DiscoverMerchantRow & { sort: number } => row != null),
          };
        }

        if (q) {
          const scanned = await this.withTimeout_(
            this.loadDiscoverScan_(account.platform.code, account.id, apiToken),
            scanTimeoutMs,
            account.platform.name,
          );
          const matched = scanned.rows.filter((row) => this.isApprovedMerchant_(row) && monetizationRowMatchesText(row, q));
          const start = scoped && accounts.length === 1 ? (page - 1) * pageSize : 0;
          const slice = matched.slice(start, start + pageSize);
          return {
            truncated: scanned.truncated,
            total: matched.length,
            rows: slice
              .map((row, index) => {
                const mapped = this.toDiscoverRow_(account, row);
                return mapped ? { ...mapped, sort: index } : null;
              })
              .filter((row): row is DiscoverMerchantRow & { sort: number } => row != null),
          };
        }

        const browsed = await this.withTimeout_(
          this.loadDiscoverBrowsePage_(
            account.platform.code,
            account.id,
            apiToken,
            page,
            browseSize,
          ),
          browseTimeoutMs,
          account.platform.name,
        );
        const approved = browsed.rows.filter((row) => this.isApprovedMerchant_(row));
        // 总数用联盟返回的 Joined 全量；不要用本页过滤后的条数，否则会把 1 万+ 压成十几
        return {
          total: Math.max(browsed.total || 0, approved.length),
          rows: approved
            .map((row, index) => {
              const mapped = this.toDiscoverRow_(account, row);
              return mapped ? { ...mapped, sort: index } : null;
            })
            .filter((row): row is DiscoverMerchantRow & { sort: number } => row != null),
        };
      } catch (err) {
        return {
          error: {
            channelAccountId: account.id,
            platformCode: account.platform.code,
            message: err instanceof Error ? err.message : String(err),
          } as DiscoverMerchantResult['errors'][number],
        };
      }
    }));

    for (const item of settled) {
      if ('error' in item && item.error) {
        errors.push(item.error);
        continue;
      }
      if ('pendingOnly' in item && item.pendingOnly) pendingOnly += item.pendingOnly;
      if ('truncated' in item && item.truncated) truncated = true;
      if ('total' in item && item.total) total += item.total;
      if ('rows' in item && item.rows?.length) collected.push(...item.rows);
    }

    // 多账号合并时按平台交错，保证每个平台都有商家出现在首页
    const needsMerge = accounts.length > 1;
    const merged = needsMerge
      ? this.interleaveDiscoverRows_(collected, pageSize)
      : collected;

    const mids = [...new Set(merged.map((row) => row.mid))];
    const claimed = mids.length
      ? await this.prisma.catalogMerchant.findMany({
          where: { ownerUserId, mid: { in: mids }, blockReason: 'none' },
          select: { channelAccountId: true, mid: true },
        })
      : [];
    const claimedKeys = new Set(claimed.map((row) => `${row.channelAccountId}:${row.mid}`));
    const rows = merged.map(({ sort: _sort, ...row }) => ({
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
          : !scoped
            ? '全平台已按平台交错加载。翻页或名称搜索建议先选单个平台，会更快。'
            : '',
    };
  }

  /** 按平台轮询交错，避免某一平台占满整页。 */
  private interleaveDiscoverRows_(
    rows: Array<DiscoverMerchantRow & { sort: number }>,
    pageSize: number,
  ): Array<DiscoverMerchantRow & { sort: number }> {
    const buckets = new Map<string, Array<DiscoverMerchantRow & { sort: number }>>();
    for (const row of rows) {
      const key = row.platformCode || String(row.channelAccountId);
      const list = buckets.get(key) ?? [];
      list.push(row);
      buckets.set(key, list);
    }
    const queues = [...buckets.values()];
    const out: Array<DiscoverMerchantRow & { sort: number }> = [];
    let index = 0;
    while (out.length < pageSize && queues.some((queue) => queue.length > index)) {
      for (const queue of queues) {
        const row = queue[index];
        if (row) out.push(row);
        if (out.length >= pageSize) break;
      }
      index += 1;
    }
    return out;
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
   * 按账号和 MID 向联盟要商标。查不到或接口失败时不放进结果，调用方继续用首字。
   * cacheOnly 只读 10 分钟内存缓存，避免商家列表被联盟接口拖住。
   * fresh 表示这批 MID 都在缓存里，包括已经确认没有商标的。
   */
  async lookupMerchantLogos(
    ownerUserId: number,
    items: Array<{ channelAccountId: number; mid: string; platformCode: string }>,
    options?: { cacheOnly?: boolean },
  ): Promise<{ logos: Map<string, string>; fresh: boolean }> {
    const result = new Map<string, string>();
    const accounts = await this.prisma.channelAccount.findMany({
      where: { ownerUserId, isActive: true },
      include: { platform: true },
    });
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const missing = new Map<number, string[]>();
    let fresh = true;
    for (const item of items) {
      const mid = item.mid.trim();
      if (!mid) continue;
      let accountId = item.channelAccountId;
      if (!byId.has(accountId)) {
        const matched = accounts.filter((account) => account.platform.code === item.platformCode);
        accountId = matched.length === 1 ? matched[0].id : 0;
      }
      if (!accountId) {
        fresh = false;
        continue;
      }
      const cacheKey = `${accountId}:${mid}`;
      const cached = this.logoCache.get(cacheKey);
      if (cached && Date.now() - cached.at < 10 * 60 * 1000) {
        if (cached.logo) result.set(mid, cached.logo);
        continue;
      }
      fresh = false;
      if (options?.cacheOnly) continue;
      const list = missing.get(accountId) ?? [];
      list.push(mid);
      missing.set(accountId, list);
    }

    if (options?.cacheOnly || missing.size === 0) return { logos: result, fresh };

    await Promise.all([...missing.entries()].map(async ([accountId, mids]) => {
      const account = byId.get(accountId);
      if (!account) return;
      try {
        const apiToken = this.crypto.decrypt<{ apiToken: string }>(account.credentialsEnc).apiToken;
        if (!apiToken) return;
        const unique = [...new Set(mids)];
        const logos = new Map<string, string>();
        const scanned = await this.loadDiscoverScan_(account.platform.code, account.id, apiToken);
        for (const brand of scanned.rows) rememberMerchantLogo_(logos, brand);
        const missed = unique.filter((mid) => !logos.has(mid));
        if (missed.length > 0) {
          const brands = await preloadMonetizationBrandsForAccount(
            account.platform.code,
            apiToken,
            missed.map((merchantId) => ({ merchantId })),
          );
          for (const brand of brands) rememberMerchantLogo_(logos, brand);
        }
        for (const mid of unique) {
          const logo = logos.get(mid) || '';
          this.logoCache.set(`${accountId}:${mid}`, { at: Date.now(), logo });
          if (logo) result.set(mid, logo);
        }
      } catch (error) {
        console.error(`[merchants] 商标查询失败 account=${accountId}`, error instanceof Error ? error.message : error);
      }
    }));

    return { logos: result, fresh: true };
  }

  /**
   * 从十分钟内已经缓存的联盟商家库读取主营业务和佣金率。没有缓存时不打接口。
   */
  readCachedOffers(mids: string[]): Map<string, { categories: string; commRate: string }> {
    const wanted = new Set(mids.map((mid) => mid.trim()).filter(Boolean));
    const result = new Map<string, { categories: string; commRate: string }>();
    const now = Date.now();
    for (const entry of this.discoverScanCache.values()) {
      if (now - entry.at >= 10 * 60 * 1000) continue;
      for (const row of entry.rows) {
        const offer = mapCatalogOffer(row);
        const mid = offer.merchantId?.trim() || '';
        if (!mid || !wanted.has(mid) || result.has(mid)) continue;
        if (!offer.categories && !offer.commRate) continue;
        result.set(mid, { categories: offer.categories, commRate: offer.commRate });
      }
    }
    return result;
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
   * 无搜索词翻页。优先完整扫描缓存，其次单页缓存，最后才打联盟。
   * 单页结果只进 pageCache，避免污染名称搜索的全量扫描缓存。
   */
  private async loadDiscoverBrowsePage_(
    platformCode: string,
    channelAccountId: number,
    apiToken: string,
    page: number,
    pageSize: number,
  ) {
    // 只用未截断的全量扫描缓存；截断扫描（如前 1000/2000）不能当浏览总数，否则刷新后会少一大截
    const scanned = this.discoverScanCache.get(channelAccountId);
    if (
      scanned
      && !scanned.truncated
      && Date.now() - scanned.at < 10 * 60 * 1000
      && scanned.rows.length >= pageSize
    ) {
      const start = (page - 1) * pageSize;
      return {
        rows: scanned.rows.slice(start, start + pageSize),
        total: scanned.rows.length,
        pages: Math.max(1, Math.ceil(scanned.rows.length / pageSize)),
      };
    }
    const pageKey = `${channelAccountId}:${page}:${pageSize}`;
    const pageCached = this.discoverPageCache.get(pageKey);
    if (pageCached && Date.now() - pageCached.at < 10 * 60 * 1000) {
      return {
        rows: pageCached.rows,
        total: pageCached.total,
        pages: pageCached.pages,
      };
    }
    const browsed = await browseMonetizationPage(platformCode, apiToken, page, pageSize, 'Joined');
    this.discoverPageCache.set(pageKey, {
      at: Date.now(),
      rows: browsed.rows,
      total: browsed.total,
      pages: browsed.pages,
    });
    return browsed;
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

/**
 * 同一行的 brand_id 和 mid 都记下，日报里的商家 ID 用的是其中之一。
 */
function rememberMerchantLogo_(logos: Map<string, string>, brand: MonetizationBrandRow) {
  const logo = mapCatalogOffer(brand).logo;
  if (!logo) return;
  for (const value of [brand.brand_id, brand.mid, brand.m_id]) {
    const id = value == null ? '' : String(value).trim();
    if (id && id !== '0') logos.set(id, logo);
  }
}

function normalizeMerchantSiteUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
