import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MerchantsService } from '../merchants/merchants.service';
import { parseCampaignName } from '../common/campaign-name.util';
import {
  AdDraft,
  buildCampaignName,
  buildSampleArticle,
  buildSampleDraft,
  buildTrackUrl,
  sampleArticleHtml,
  isCustomerEligible,
  usdToMicros,
  validateDraft,
} from './ads-automation.util';
import { buildCreateCampaignPayload } from './mutate-payload';

/**
 * 内容站发布端口。对方接口未知，成功前 articleUrl 保持为空。
 */
@Injectable()
export class ArticlePublisher {
  /**
   * 预留的发布动作。接上站点接口后在这里回写文章 URL。
   */
  async publish(): Promise<{ articleUrl: string }> {
    return { articleUrl: '' };
  }
}

@Injectable()
export class AdsAutomationService implements OnModuleInit {
  private readonly runningJobs = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly articles: ArticlePublisher,
    private readonly merchants: MerchantsService,
  ) {}

  /**
   * 重启后把没写完草稿的任务重新跑一遍。
   */
  async onModuleInit() {
    try {
      const pending = await this.prisma.adJob.findMany({
        where: { status: { in: ['PENDING', 'RUNNING'] } },
        select: { id: true, draft: true },
      });
      pending.filter((job) => job.draft == null).forEach((job) => this.kick(job.id));
    } catch (error) {
      console.error('[ads] 跳过未完成任务恢复', error);
    }
  }

  /**
   * 全部内容站。站点由管理员维护，员工绑定自己的联盟账号时共用这份列表。
   */
  async listSites() {
    return this.prisma.publishSite.findMany({
      orderBy: { id: 'desc' },
    });
  }

  /**
   * 新增内容站。域名按小写保存，全库不重复。
   */
  async createSite(ownerUserId: number, name: string, domain: string) {
    const trimmedName = (name ?? '').trim();
    const normalized = (domain ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!trimmedName || !normalized) throw new BadRequestException('名称和域名不能为空');
    const existing = await this.prisma.publishSite.findFirst({ where: { domain: normalized } });
    if (existing) throw new ConflictException('这个域名已经有内容站');
    return this.prisma.publishSite.create({
      data: { ownerUserId, name: trimmedName, domain: normalized },
    });
  }

  /**
   * 收款方式列表。
   */
  async listPaymentMethods(ownerUserId: number) {
    return this.prisma.paymentMethod.findMany({
      where: { ownerUserId },
      orderBy: { id: 'desc' },
    });
  }

  /**
   * 新增收款方式。
   */
  async createPaymentMethod(ownerUserId: number, name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('收款方式名称不能为空');
    return this.prisma.paymentMethod.create({
      data: { ownerUserId, name: trimmed },
    });
  }

  /**
   * 当前员工名下的子账号。已登记的 MCC 账户带 Google 状态；其余来自已导入日报，先把 CID 和在投系列显示出来。
   */
  async listAccountBoard(ownerUserId: number) {
    const connections = await this.prisma.googleAdsConnection.findMany({
      where: { ownerUserId },
      include: { customers: { orderBy: { id: 'desc' } } },
      orderBy: { id: 'desc' },
    });
    const registered = new Map<string, {
      mccCustomerId: string;
      googleStatus: string;
      availability: string;
      activeCampaignCount: number;
      updatedAt: Date;
    }>();
    for (const connection of connections) {
      for (const customer of connection.customers) {
        registered.set(digits(customer.customerId), {
          mccCustomerId: connection.mccCustomerId,
          googleStatus: customer.googleStatus,
          availability: customer.availability,
          activeCampaignCount: customer.activeCampaignCount,
          updatedAt: customer.updatedAt,
        });
      }
    }

    const daily = await this.prisma.adCampaignDaily.findMany({
      where: { ownerUserId },
      select: { customerId: true, campaignId: true, campaignStatus: true, date: true },
    });
    const fromSheet = new Map<string, { last: string; enabled: Set<string> }>();
    for (const row of daily) {
      if (!row.customerId || row.customerId === 'unknown') continue;
      const id = digits(row.customerId);
      const day = row.date.toISOString().slice(0, 10);
      let bucket = fromSheet.get(id);
      if (!bucket) {
        bucket = { last: day, enabled: new Set() };
        fromSheet.set(id, bucket);
      }
      if (day > bucket.last) {
        bucket.last = day;
        bucket.enabled.clear();
      }
      if (day === bucket.last && row.campaignStatus === 'ENABLED' && row.campaignId !== '__account_gap__') {
        bucket.enabled.add(row.campaignId);
      }
    }

    const sources = await this.prisma.adDataSource.findMany({
      where: { ownerUserId, isActive: true },
      select: { name: true, linkedCustomerIds: true },
    });
    const mccByCustomer = new Map<string, string[]>();
    for (const source of sources) {
      const linked = Array.isArray(source.linkedCustomerIds) ? source.linkedCustomerIds : [];
      for (const raw of linked) {
        const key = digits(String(raw));
        if (!key) continue;
        const names = mccByCustomer.get(key) ?? [];
        if (!names.includes(source.name)) names.push(source.name);
        mccByCustomer.set(key, names);
      }
    }
    const onlySourceName = sources.length === 1 ? sources[0].name : '';

    const ids = new Set<string>([...registered.keys(), ...fromSheet.keys()]);
    const rows = [...ids].map((customerId) => {
      const saved = registered.get(customerId);
      const sheet = fromSheet.get(customerId);
      const linkedName = (mccByCustomer.get(customerId) ?? []).join('、');
      return {
        id: customerId,
        mccCustomerId: saved?.mccCustomerId ?? '',
        mccLabel: linkedName || onlySourceName,
        customerId,
        googleStatus: saved?.googleStatus ?? 'UNKNOWN',
        availability: saved?.availability ?? 'unknown',
        activeCampaignCount: sheet ? sheet.enabled.size : saved?.activeCampaignCount ?? 0,
        updatedAt: sheet?.last ?? saved?.updatedAt.toISOString() ?? '',
      };
    }).map((row) => ({
      ...row,
      availability: accountAvailability(row.googleStatus, row.activeCampaignCount, row.availability),
    }));
    rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return {
      summary: {
        total: rows.length,
        enabled: rows.filter((row) => row.googleStatus === 'ENABLED').length,
        suspended: rows.filter((row) => row.googleStatus === 'SUSPENDED').length,
        closed: rows.filter((row) => row.googleStatus === 'CANCELED' || row.googleStatus === 'CLOSED').length,
        unknown: rows.filter((row) => row.googleStatus === 'UNKNOWN').length,
      },
      rows,
    };
  }

  /**
   * 当前员工已生成的文章。文章地址要等内容站回写。
   */
  async listArticles(ownerUserId: number) {
    const rows = await this.prisma.article.findMany({
      where: { ownerUserId },
      orderBy: { id: 'desc' },
      include: { site: true },
    });
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      articleUrl: row.articleUrl,
      merchantUrl: row.merchantUrl,
      trackUrl: row.trackUrl,
      publishStatus: row.publishStatus,
      siteName: row.site.name,
      siteDomain: row.site.domain,
      createdAt: row.createdAt,
    }));
  }

  /**
   * 把文章交给内容站。站点接口未接上时文章地址保持为空。
   */
  async publishArticle(ownerUserId: number, id: number) {
    const row = await this.prisma.article.findFirst({
      where: { id, ownerUserId },
      include: { site: true },
    });
    if (!row) throw new NotFoundException('文章不存在');
    const published = await this.articles.publish();
    const articleUrl = published.articleUrl.trim();
    const updated = await this.prisma.article.update({
      where: { id: row.id },
      data: {
        articleUrl,
        publishStatus: articleUrl ? 'published' : 'pending_site',
      },
      include: { site: true },
    });
    return {
      id: updated.id,
      title: updated.title,
      articleUrl: updated.articleUrl,
      publishStatus: updated.publishStatus,
      siteName: updated.site.name,
      siteDomain: updated.site.domain,
      accepted: Boolean(articleUrl),
    };
  }

  /**
   * 发文可选商家。只取这个员工最近一天仍在投放的广告系列，不从订单里另找商家。
   */
  async searchArticleMerchants(ownerUserId: number, q: string) {
    const query = q.trim().toLowerCase();
    const latest = await this.prisma.adCampaignDaily.findFirst({
      where: { ownerUserId, source: 'sheet' },
      orderBy: { date: 'desc' },
      select: { date: true },
    });
    if (!latest) return [];
    const campaigns = await this.prisma.adCampaignDaily.findMany({
      where: {
        ownerUserId,
        date: latest.date,
        campaignStatus: 'ENABLED',
        campaignId: { not: '__account_gap__' },
      },
      select: { campaignName: true, merchantId: true, affiliateAlias: true },
    });
    const accounts = await this.prisma.channelAccount.findMany({
      where: { ownerUserId },
      include: { platform: true, site: true },
    });
    const accountByAlias = new Map(
      accounts
        .filter((account) => account.affiliateAlias)
        .map((account) => [account.affiliateAlias.toLowerCase(), account]),
    );
    const drafts = campaigns.map((campaign) => {
      const parsed = parseCampaignName(campaign.campaignName);
      const parts = campaignMerchantParts(campaign.campaignName);
      const mid = (campaign.merchantId || parsed.merchantId).trim();
      const alias = (campaign.affiliateAlias || parsed.affiliateAlias).trim().toLowerCase();
      return { mid, alias, name: parts.name, countryCode: parts.countryCode };
    });
    const mids = [...new Set(drafts.map((row) => row.mid).filter(Boolean))];
    const [catalogs, orderNames] = await Promise.all([
      mids.length
        ? this.prisma.catalogMerchant.findMany({
            where: { ownerUserId, mid: { in: mids }, blockReason: 'none' },
          })
        : Promise.resolve([]),
      mids.length
        ? this.prisma.affiliateOrder.findMany({
            where: {
              channelAccount: { ownerUserId },
              merchantId: { in: mids },
              merchantName: { not: '' },
            },
            select: { merchantId: true, merchantName: true },
            orderBy: { id: 'desc' },
            take: 300,
          })
        : Promise.resolve([]),
    ]);
    const catalogByMid = new Map(catalogs.map((row) => [row.mid, row]));
    const nameByMid = new Map<string, string>();
    for (const row of orderNames) {
      const mid = (row.merchantId || '').trim();
      const name = (row.merchantName || '').trim();
      if (mid && name && !nameByMid.has(mid)) nameByMid.set(mid, name);
    }
    const seen = new Set<string>();
    const rows: Array<{
      key: string;
      catalogMerchantId: number | null;
      channelAccountId: number;
      name: string;
      mid: string;
      merchantUrl: string;
      countryCode: string;
      platformCode: string;
      siteId: number | null;
      siteName: string | null;
      siteDomain: string | null;
      label: string;
    }> = [];
    for (const draft of drafts) {
      if (!draft.mid && !draft.name) continue;
      const dedupe = `${draft.alias}:${draft.mid || draft.name}`;
      if (seen.has(dedupe)) continue;
      const account = accountByAlias.get(draft.alias) ?? onlyAccountForAlias(accounts, draft.alias);
      const catalog = draft.mid ? catalogByMid.get(draft.mid) : undefined;
      const name = nameByMid.get(draft.mid) || draft.name;
      if (!name) continue;
      const platformCode = account?.platform.code || platformCodeFromAlias(draft.alias);
      const label = articleMerchantLabel(name, platformCode || draft.alias, draft.mid);
      const haystack = `${name} ${draft.mid} ${label}`.toLowerCase();
      if (query && !haystack.includes(query)) continue;
      seen.add(dedupe);
      rows.push({
        key: `ad:${dedupe}`,
        catalogMerchantId: catalog?.id ?? null,
        channelAccountId: account?.id ?? 0,
        name,
        mid: draft.mid,
        merchantUrl: catalog?.merchantUrl ?? '',
        countryCode: (catalog?.countryCode || draft.countryCode || 'US').toUpperCase(),
        platformCode,
        siteId: account?.siteId ?? null,
        siteName: account?.site?.name ?? null,
        siteDomain: account?.site?.domain ?? null,
        label,
      });
      if (rows.length >= 20) break;
    }
    return rows;
  }

  /**
   * 选中在投商家后，向对应联盟平台要商家网址。
   */
  async lookupArticleMerchant(ownerUserId: number, channelAccountId: number, mid: string) {
    return this.merchants.lookupMerchantSite(ownerUserId, channelAccountId, mid);
  }

  /**
   * 预览示例文章，不落库。跟踪链接按联盟账号规则生成。
   */
  async previewComposedArticle(ownerUserId: number, input: ArticleComposeInput) {
    const prepared = await this.prepareComposedArticle(ownerUserId, input);
    return {
      title: prepared.sample.title,
      sections: prepared.sample.sections,
      merchantUrl: prepared.merchantUrl,
      trackUrl: prepared.trackUrl,
      siteId: prepared.account.siteId,
      siteName: prepared.account.site?.name ?? '',
      siteDomain: prepared.account.site?.domain ?? '',
    };
  }

  /**
   * 保存一篇文章。不创建广告系列，内容站未回写时文章地址为空。
   */
  async publishComposedArticle(ownerUserId: number, input: ArticleComposeInput) {
    const prepared = await this.prepareComposedArticle(ownerUserId, input);
    if (!prepared.account.siteId || !prepared.account.site) {
      throw new BadRequestException('请先在我的平台账号里绑定内容站');
    }
    if (input.siteId && input.siteId !== prepared.account.siteId) {
      throw new BadRequestException('发布站点要和联盟账号绑定的内容站一致');
    }
    const mid = prepared.mid || midFromUrl(prepared.merchantUrl);
    const catalog = prepared.merchant ?? await this.prisma.catalogMerchant.upsert({
      where: {
        ownerUserId_channelAccountId_mid: {
          ownerUserId,
          channelAccountId: prepared.account.id,
          mid,
        },
      },
      create: {
        ownerUserId,
        channelAccountId: prepared.account.id,
        platformCode: prepared.account.platform.code,
        mid,
        name: prepared.name,
        merchantUrl: prepared.merchantUrl,
        countryCode: prepared.countryCode,
        blockReason: 'none',
      },
      update: {},
    });
    if (catalog.blockReason !== 'none') throw new BadRequestException('这个商家不能发文');
    const published = await this.articles.publish();
    const articleUrl = published.articleUrl.trim();
    const body = sampleArticleHtml(prepared.sample, prepared.name, prepared.trackUrl);
    const article = await this.prisma.$transaction(async (tx) => {
      const job = await tx.adJob.create({
        data: {
          ownerUserId,
          catalogMerchantId: catalog.id,
          channelAccountId: prepared.account.id,
          status: 'COMPLETED',
          step: 'ARTICLE_ONLY',
          progress: 100,
          progressMessage: '文章已保存，等待内容站回写',
          mccCustomerId: '',
          customerId: '',
          campaignName: prepared.sample.title.slice(0, 255),
          targetCountry: prepared.countryCode,
          languageCode: prepared.languageCode,
          input: {
            kind: 'article',
            merchantUrl: prepared.merchantUrl,
            languageCode: prepared.languageCode,
          },
        },
      });
      return tx.article.create({
        data: {
          ownerUserId,
          siteId: prepared.account.siteId!,
          adJobId: job.id,
          title: prepared.sample.title.slice(0, 255),
          body,
          trackUrl: prepared.trackUrl,
          merchantUrl: prepared.merchantUrl,
          articleUrl,
          publishStatus: articleUrl ? 'published' : 'pending_site',
        },
        include: { site: true },
      });
    });
    return {
      id: article.id,
      title: article.title,
      sections: prepared.sample.sections,
      merchantUrl: article.merchantUrl,
      trackUrl: article.trackUrl,
      articleUrl: article.articleUrl,
      publishStatus: article.publishStatus,
      siteName: article.site.name,
      siteDomain: article.site.domain,
      accepted: Boolean(articleUrl),
    };
  }

  /**
   * 可领取商家列表。
   */
  async listMerchants(ownerUserId: number) {
    return this.prisma.catalogMerchant.findMany({
      where: { ownerUserId },
      orderBy: { id: 'desc' },
    });
  }

  /**
   * 我的商家：这个员工已经投过广告的商家。日报里出现过的，以及在这里领取后生成过广告的。
   */
  async listAdvertisedMerchants(ownerUserId: number) {
    const [daily, running, jobs, accounts, catalogs] = await Promise.all([
      this.prisma.adCampaignDaily.findMany({
        where: {
          ownerUserId,
          source: 'sheet',
          campaignId: { not: '__account_gap__' },
          merchantId: { not: '' },
        },
        distinct: ['merchantId'],
        select: { merchantId: true, affiliateAlias: true, campaignName: true },
      }),
      this.prisma.adCampaignDaily.groupBy({
        by: ['merchantId'],
        where: {
          ownerUserId,
          source: 'sheet',
          campaignStatus: 'ENABLED',
          campaignId: { not: '__account_gap__' },
          merchantId: { not: '' },
        },
      }),
      this.prisma.adJob.findMany({
        where: { ownerUserId, step: { not: 'ARTICLE_ONLY' } },
        orderBy: { createdAt: 'desc' },
        include: { catalogMerchant: true },
      }),
      this.prisma.channelAccount.findMany({
        where: { ownerUserId },
        include: { platform: true },
      }),
      this.prisma.catalogMerchant.findMany({ where: { ownerUserId, blockReason: 'none' } }),
    ]);
    const accountByAlias = new Map(
      accounts.filter((account) => account.affiliateAlias).map((account) => [account.affiliateAlias.toLowerCase(), account]),
    );
    const catalogByMid = new Map(catalogs.map((row) => [row.mid, row]));
    const runningMids = new Set(running.map((row) => row.merchantId));
    const rows = new Map<string, {
      name: string;
      mid: string;
      platformCode: string;
      merchantUrl: string;
      countryCode: string;
      channelAccountId: number;
      enabled: boolean;
    }>();

    for (const row of daily) {
      const parsed = parseCampaignName(row.campaignName);
      const mid = (row.merchantId || parsed.merchantId).trim();
      if (!mid || rows.has(mid)) continue;
      const alias = (row.affiliateAlias || parsed.affiliateAlias).trim().toLowerCase();
      const parts = campaignMerchantParts(row.campaignName);
      const account = accountByAlias.get(alias) ?? onlyAccountForAlias(accounts, alias);
      const catalog = catalogByMid.get(mid);
      rows.set(mid, {
        name: catalog?.name || parts.name || mid,
        mid,
        platformCode: catalog?.platformCode || account?.platform.code || platformCodeFromAlias(alias),
        merchantUrl: catalog?.merchantUrl || '',
        countryCode: catalog?.countryCode || parts.countryCode || 'US',
        channelAccountId: catalog?.channelAccountId || account?.id || 0,
        enabled: runningMids.has(mid),
      });
    }

    for (const job of jobs) {
      const merchant = job.catalogMerchant;
      if (!merchant || rows.has(merchant.mid)) continue;
      rows.set(merchant.mid, {
        name: merchant.name,
        mid: merchant.mid,
        platformCode: merchant.platformCode,
        merchantUrl: merchant.merchantUrl,
        countryCode: merchant.countryCode,
        channelAccountId: merchant.channelAccountId,
        enabled: job.status !== 'FAILED',
      });
    }

    return [...rows.values()];
  }

  /**
   * 登记一个可领取商家。成人、禁止、违规会记下来，领取时拒绝。
   */
  async createMerchant(
    ownerUserId: number,
    input: {
      channelAccountId: number;
      mid: string;
      name: string;
      merchantUrl: string;
      countryCode: string;
      blockReason?: string;
    },
  ) {
    const account = await this.prisma.channelAccount.findFirst({
      where: { id: input.channelAccountId, ownerUserId },
      include: { platform: true },
    });
    if (!account) throw new NotFoundException('渠道账号不存在');
    if (!/^https?:\/\//i.test(input.merchantUrl)) {
      throw new BadRequestException('商家网址需要以 http 或 https 开头');
    }
    const blockReason = input.blockReason?.trim() || 'none';
    const mid = input.mid.trim();
    const data = {
      platformCode: account.platform.code,
      name: input.name.trim(),
      merchantUrl: input.merchantUrl.trim(),
      countryCode: (input.countryCode.trim() || 'US').toUpperCase().slice(0, 8),
      blockReason,
    };
    return this.prisma.catalogMerchant.upsert({
      where: {
        ownerUserId_channelAccountId_mid: {
          ownerUserId,
          channelAccountId: account.id,
          mid,
        },
      },
      create: {
        ownerUserId,
        channelAccountId: account.id,
        mid,
        ...data,
      },
      update: data,
    });
  }

  /**
   * 取消领取。已经生成过广告任务的商家留在库里，避免把任务上的商家拆掉。
   */
  async releaseMerchant(ownerUserId: number, id: number) {
    const row = await this.prisma.catalogMerchant.findFirst({
      where: { id, ownerUserId },
      include: { _count: { select: { adJobs: true } } },
    });
    if (!row) throw new NotFoundException('商家不存在');
    if (row._count.adJobs > 0) {
      throw new BadRequestException('这个商家已经有广告任务，不能取消领取');
    }
    await this.prisma.catalogMerchant.delete({ where: { id: row.id } });
    return { id: row.id };
  }

  /**
   * 联盟商家库翻页。选取之前先在这里找到带网址的商家。
   */
  async discoverMerchants(
    ownerUserId: number,
    query: { channelAccountId?: number; q?: string; page?: number; pageSize?: number },
  ) {
    return this.merchants.browseMerchantCatalog(ownerUserId, query);
  }

  /**
   * 登记 MCC。令牌留空，本期不访问 Google。
   */
  async createConnection(ownerUserId: number, mccCustomerId: string) {
    const mcc = digits(mccCustomerId);
    return this.prisma.googleAdsConnection.upsert({
      where: { ownerUserId_mccCustomerId: { ownerUserId, mccCustomerId: mcc } },
      create: { ownerUserId, mccCustomerId: mcc },
      update: {},
    });
  }

  /**
   * 某个 MCC 下的子账户。
   */
  async listCustomers(ownerUserId: number, mccCustomerId: string) {
    const connection = await this.mustConnection(ownerUserId, mccCustomerId);
    return this.prisma.googleAdsCustomer.findMany({
      where: { connectionId: connection.id },
      orderBy: { activeCampaignCount: 'asc' },
    });
  }

  /**
   * 手工登记子账户，供发布时挑选。
   */
  async createCustomer(
    ownerUserId: number,
    input: {
      mccCustomerId: string;
      customerId: string;
      googleStatus?: string;
      availability?: string;
      currencyCode?: string;
      timeZone?: string;
      activeCampaignCount?: number;
    },
  ) {
    const connection = await this.mustConnection(ownerUserId, input.mccCustomerId);
    return this.prisma.googleAdsCustomer.upsert({
      where: {
        connectionId_customerId: {
          connectionId: connection.id,
          customerId: digits(input.customerId),
        },
      },
      create: {
        connectionId: connection.id,
        customerId: digits(input.customerId),
        googleStatus: input.googleStatus ?? 'ENABLED',
        availability: input.availability ?? 'available',
        currencyCode: input.currencyCode ?? 'USD',
        timeZone: input.timeZone ?? 'Asia/Shanghai',
        activeCampaignCount: input.activeCampaignCount ?? 0,
      },
      update: {
        googleStatus: input.googleStatus ?? 'ENABLED',
        availability: input.availability ?? 'available',
        currencyCode: input.currencyCode ?? 'USD',
        timeZone: input.timeZone ?? 'Asia/Shanghai',
        activeCampaignCount: input.activeCampaignCount ?? 0,
      },
    });
  }

  /**
   * 领取商家并开始生成。禁止类商家直接拒绝。
   */
  async claim(
    ownerUserId: number,
    input: { catalogMerchantId: number; mccCustomerId: string; targetCountry: string; languageCode?: string; bidding?: 'MAXIMIZE_CLICKS' | 'MANUAL_CPC'; dailyBudgetUsd?: string; cpcBidCeilingUsd?: string },
  ) {
    const merchant = await this.prisma.catalogMerchant.findFirst({
      where: { id: input.catalogMerchantId, ownerUserId },
    });
    if (!merchant) throw new NotFoundException('商家不存在');
    if (merchant.blockReason === 'adult' || merchant.blockReason === 'prohibited' || merchant.blockReason === 'violation') {
      throw new BadRequestException('该商家禁止投放');
    }
    const mcc = normalizeMccKey(input.mccCustomerId);
    await this.prisma.googleAdsConnection.upsert({
      where: { ownerUserId_mccCustomerId: { ownerUserId, mccCustomerId: mcc } },
      create: { ownerUserId, mccCustomerId: mcc },
      update: {},
    });
    const country = input.targetCountry.trim().toUpperCase();
    const job = await this.prisma.adJob.create({
      data: {
        ownerUserId,
        catalogMerchantId: merchant.id,
        channelAccountId: merchant.channelAccountId,
        status: 'PENDING',
        step: 'COMPETITOR_CREATIVES',
        progress: 0,
        progressMessage: '排队中',
        mccCustomerId: mcc,
        targetCountry: country,
        languageCode: (input.languageCode ?? '').trim(),
        input: {
          merchantName: merchant.name,
          merchantUrl: merchant.merchantUrl,
          mid: merchant.mid,
          platformCode: merchant.platformCode,
          countryCode: country,
          languageCode: (input.languageCode ?? '').trim(),
          bidding: input.bidding === 'MANUAL_CPC' ? 'MANUAL_CPC' : 'MAXIMIZE_CLICKS',
          dailyBudgetUsd: input.dailyBudgetUsd?.trim() || '3.00',
          cpcBidCeilingUsd: input.cpcBidCeilingUsd?.trim() || '0.50',
        },
      },
    });
    await this.addEvent(job.id, 'PENDING', 'COMPETITOR_CREATIVES', '排队中');
    this.kick(job.id);
    return this.getJob(ownerUserId, job.id);
  }

  /**
   * 查询任务进度。
   */
  async getJob(ownerUserId: number, id: string) {
    const job = await this.prisma.adJob.findFirst({
      where: { id, ownerUserId },
      include: { article: true, campaign: true },
    });
    if (!job) throw new NotFoundException('任务不存在');
    return {
      ...job,
      campaign: job.campaign ? this.campaignJson(job.campaign) : null,
    };
  }

  /**
   * 任务列表。
   */
  async listJobs(ownerUserId: number) {
    const jobs = await this.prisma.adJob.findMany({
      where: { ownerUserId, step: { not: 'ARTICLE_ONLY' } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { campaign: true },
    });
    return jobs.map((job) => ({
      id: job.id,
      status: job.status,
      step: job.step,
      progress: job.progress,
      progressMessage: job.progressMessage,
      campaignName: job.campaignName,
      errorMessage: job.errorMessage,
      campaign: job.campaign ? this.campaignJson(job.campaign) : null,
    }));
  }

  /**
   * 保存人工修改。超长文案允许留在草稿里，确认发布时才拒绝。
   */
  async patchDraft(ownerUserId: number, id: string, patch: Partial<AdDraft>) {
    const job = await this.mustJob(ownerUserId, id);
    if (job.status !== 'READY_FOR_REVIEW') {
      throw new BadRequestException('只有待确认的任务可以修改草稿');
    }
    const current = this.readDraft(job.draft);
    const next: AdDraft = { ...current, ...stripEmpty(patch) };
    await this.prisma.adJob.update({
      where: { id },
      data: { draft: next as unknown as Prisma.InputJsonValue },
    });
    return this.getJob(ownerUserId, id);
  }

  /**
   * 确认发布：写文章、本地系列和待提交报文。不调用 Google。
   */
  async publish(ownerUserId: number, id: string, customerId?: string) {
    const job = await this.mustJob(ownerUserId, id);
    if (job.status === 'COMPLETED' && job.campaign) {
      return this.getJob(ownerUserId, id);
    }
    if (job.status !== 'READY_FOR_REVIEW') {
      throw new BadRequestException('文案尚未生成完成');
    }
    const draft = this.readDraft(job.draft);
    const errors = validateDraft(draft);
    if (errors.length) throw new BadRequestException(errors.join('；'));

    const account = await this.prisma.channelAccount.findFirst({
      where: { id: job.channelAccountId, ownerUserId },
      include: { platform: true, site: true },
    });
    if (!account?.site) throw new BadRequestException('联盟账号还没有绑定内容站');

    const customer = await this.pickCustomer(ownerUserId, job.mccCustomerId, customerId);
    const merchant = await this.prisma.catalogMerchant.findUniqueOrThrow({
      where: { id: job.catalogMerchantId },
    });
    const existingCount = await this.prisma.adAutomationCampaign.count({ where: { ownerUserId } });
    const campaignName = buildCampaignName({
      sequence: 2001 + existingCount,
      platformCode: merchant.platformCode,
      merchantName: merchant.name,
      countryCode: job.targetCountry,
      mid: merchant.mid,
    });
    const idempotencyKey = `${customer.customerId}:${campaignName}`;
    const duplicate = await this.prisma.adJob.findFirst({
      where: { ownerUserId, idempotencyKey, status: 'COMPLETED' },
    });
    if (duplicate) return this.getJob(ownerUserId, duplicate.id);

    const trackUrl = buildTrackUrl(account.platform.code, draft.merchantUrl, account.trackLinkPrefix);
    const published = await this.articles.publish();
    const payload = buildCreateCampaignPayload({
      customerId: customer.customerId,
      campaignName,
      draft,
    });
    const budgetMicros = BigInt(usdToMicros(draft.dailyBudgetUsd));
    const ceilingMicros = BigInt(usdToMicros(draft.cpcBidCeilingUsd));

    await this.prisma.$transaction(async (tx) => {
      await tx.adJob.update({
        where: { id: job.id },
        data: {
          status: 'SUBMITTING',
          step: 'READY_FOR_REVIEW',
          progress: 90,
          progressMessage: '正在保存待提交记录',
          customerId: customer.customerId,
          campaignName,
          idempotencyKey,
        },
      });
      const article = await tx.article.create({
        data: {
          ownerUserId,
          siteId: account.site!.id,
          adJobId: job.id,
          title: draft.headlines[0],
          body: articleBody(merchant.name, trackUrl),
          trackUrl,
          merchantUrl: draft.merchantUrl,
          articleUrl: published.articleUrl,
          publishStatus: published.articleUrl ? 'published' : 'pending_site',
        },
      });
      const campaign = await tx.adAutomationCampaign.create({
        data: {
          ownerUserId,
          jobId: job.id,
          customerId: customer.customerId,
          mccCustomerId: job.mccCustomerId,
          campaignName,
          merchantUrl: draft.merchantUrl,
          finalUrlSuffix: draft.finalUrlSuffix,
          status: 'WAITING_SUBMIT',
          dailyBudgetMicros: budgetMicros,
          bidding: draft.bidding,
          cpcBidCeilingMicros: ceilingMicros,
        },
      });
      await tx.adsOutbox.create({
        data: {
          ownerUserId,
          campaignId: campaign.id,
          kind: 'CREATE_CAMPAIGN',
          status: 'HELD',
          payload: payload as Prisma.InputJsonValue,
          snapshot: { articleId: article.id } as Prisma.InputJsonValue,
        },
      });
      await tx.adJob.update({
        where: { id: job.id },
        data: { status: 'COMPLETED', progress: 100, progressMessage: '待提交', errorMessage: null },
      });
      await tx.adJobEvent.create({
        data: {
          jobId: job.id,
          status: 'COMPLETED',
          step: 'READY_FOR_REVIEW',
          message: '已写入待提交队列，尚未调用 Google Ads',
        },
      });
    });

    return this.getJob(ownerUserId, id);
  }

  /**
   * 本地系列列表。状态是待提交、待暂停或待启用。
   */
  async listCampaigns(ownerUserId: number) {
    const rows = await this.prisma.adAutomationCampaign.findMany({
      where: { ownerUserId },
      orderBy: { id: 'desc' },
      include: { job: { include: { article: true } } },
    });
    return rows.map((row) => ({
      ...this.campaignJson(row),
      articleUrl: row.job.article?.articleUrl ?? '',
      articleStatus: row.job.article?.publishStatus ?? '',
    }));
  }

  /**
   * 把启用或暂停写成待提交记录。
   */
  async updateStatus(ownerUserId: number, id: number, status: 'ENABLED' | 'PAUSED') {
    const row = await this.mustCampaign(ownerUserId, id);
    const next = status === 'PAUSED' ? 'WAITING_PAUSE' : 'WAITING_ENABLE';
    if (row.status === next) return this.campaignJson(row);
    const payload = {
      operations: [
        {
          update: { resourceName: `customers/${row.customerId}/campaigns/-`, status },
          updateMask: 'status',
        },
      ],
    };
    await this.prisma.$transaction([
      this.prisma.adAutomationCampaign.update({ where: { id: row.id }, data: { status: next } }),
      this.prisma.adsOutbox.create({
        data: {
          ownerUserId,
          campaignId: row.id,
          kind: 'UPDATE_STATUS',
          payload,
          snapshot: { status: row.status } as Prisma.InputJsonValue,
        },
      }),
    ]);
    return this.campaignJson({ ...row, status: next });
  }

  /**
   * 把日预算改成绝对值，并保留改前金额。
   */
  async updateBudget(ownerUserId: number, id: number, dailyBudgetUsd: string) {
    const amountMicros = usdToMicros(dailyBudgetUsd);
    if (BigInt(amountMicros) <= 0n) throw new BadRequestException('日预算必须大于 0');
    const row = await this.mustCampaign(ownerUserId, id);
    const payload = {
      operations: [
        {
          update: {
            resourceName: `customers/${row.customerId}/campaignBudgets/-`,
            amountMicros,
          },
          updateMask: 'amountMicros',
        },
      ],
    };
    const updated = await this.prisma.$transaction(async (tx) => {
      const campaign = await tx.adAutomationCampaign.update({
        where: { id: row.id },
        data: { dailyBudgetMicros: BigInt(amountMicros) },
      });
      await tx.adsOutbox.create({
        data: {
          ownerUserId,
          campaignId: row.id,
          kind: 'UPDATE_BUDGET',
          payload,
          snapshot: { dailyBudgetMicros: row.dailyBudgetMicros.toString() },
        },
      });
      return campaign;
    });
    return this.campaignJson(updated);
  }

  /**
   * 按步骤写样例草稿。抓站和模型以后替换这一段。
   */
  private async generate(jobId: string) {
    const steps: Array<[string, number, string]> = [
      ['COMPETITOR_CREATIVES', 15, '竞品在投创意'],
      ['BRAND_TERMS', 35, '品牌核心词'],
      ['CRAWLING', 55, '正在分析商家网站'],
      ['GENERATING', 80, 'AI 生成文案'],
    ];
    try {
      const job = await this.prisma.adJob.findUnique({ where: { id: jobId } });
      if (!job || job.draft) return;
      const input = job.input as {
        merchantName: string;
        merchantUrl: string;
        countryCode: string;
        languageCode: string;
        bidding?: 'MAXIMIZE_CLICKS' | 'MANUAL_CPC';
        dailyBudgetUsd?: string;
        cpcBidCeilingUsd?: string;
      };
      for (const [step, progress, message] of steps) {
        await this.prisma.adJob.update({
          where: { id: jobId },
          data: { status: 'RUNNING', step, progress, progressMessage: message },
        });
        await this.addEvent(jobId, 'RUNNING', step, message);
      }
      const language = input.languageCode || 'en';
      const draft = buildSampleDraft({
        merchantName: input.merchantName,
        merchantUrl: input.merchantUrl,
        countryCode: input.countryCode,
        languageCode: language,
        bidding: input.bidding,
        dailyBudgetUsd: input.dailyBudgetUsd,
        cpcBidCeilingUsd: input.cpcBidCeilingUsd,
      });
      await this.prisma.adJob.update({
        where: { id: jobId },
        data: {
          status: 'READY_FOR_REVIEW',
          step: 'READY_FOR_REVIEW',
          progress: 80,
          progressMessage: '最终预览',
          languageCode: language,
          draft: draft as unknown as Prisma.InputJsonValue,
        },
      });
      await this.addEvent(jobId, 'READY_FOR_REVIEW', 'READY_FOR_REVIEW', '最终预览');
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成失败';
      await this.prisma.adJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', errorMessage: message },
      });
      await this.addEvent(jobId, 'FAILED', 'GENERATING', message);
    }
  }

  /**
   * 异步执行生成，避免领取接口一直等到文案写完。
   */
  private kick(jobId: string) {
    if (this.runningJobs.has(jobId)) return;
    this.runningJobs.add(jobId);
    setImmediate(() => {
      void this.generate(jobId).finally(() => this.runningJobs.delete(jobId));
    });
  }

  /**
   * 在指定 MCC 下选择可投放的 CID。
   */
  private async pickCustomer(ownerUserId: number, mccCustomerId: string, requested?: string) {
    const connection = await this.mustConnection(ownerUserId, mccCustomerId);
    const customers = await this.prisma.googleAdsCustomer.findMany({
      where: { connectionId: connection.id },
      orderBy: { activeCampaignCount: 'asc' },
    });
    if (requested?.trim()) {
      const wanted = digits(requested);
      const found = customers.find((item) => item.customerId === wanted);
      if (!found || !isCustomerEligible(found)) {
        throw new BadRequestException('指定的 CID 不可用');
      }
      return found;
    }
    const eligible = customers.filter((item) => isCustomerEligible(item));
    if (!eligible.length) throw new BadRequestException('该 MCC 下没有可投放的 CID');
    return eligible[0];
  }

  private async mustConnection(ownerUserId: number, mccCustomerId: string) {
    const connection = await this.prisma.googleAdsConnection.findUnique({
      where: {
        ownerUserId_mccCustomerId: { ownerUserId, mccCustomerId: digits(mccCustomerId) },
      },
    });
    if (!connection) throw new NotFoundException('MCC 不存在');
    return connection;
  }

  private async mustJob(ownerUserId: number, id: string) {
    const job = await this.prisma.adJob.findFirst({
      where: { id, ownerUserId },
      include: { campaign: true },
    });
    if (!job) throw new NotFoundException('任务不存在');
    return job;
  }

  private async mustCampaign(ownerUserId: number, id: number) {
    const row = await this.prisma.adAutomationCampaign.findFirst({ where: { id, ownerUserId } });
    if (!row) throw new NotFoundException('广告系列不存在');
    return row;
  }

  private readDraft(value: Prisma.JsonValue | null): AdDraft {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('草稿不存在');
    }
    return value as unknown as AdDraft;
  }

  private campaignJson(row: {
    id: number;
    customerId: string;
    mccCustomerId: string;
    campaignName: string;
    merchantUrl: string;
    finalUrlSuffix: string;
    status: string;
    dailyBudgetMicros: bigint;
    bidding: string;
    cpcBidCeilingMicros: bigint;
    jobId?: string;
  }) {
    return {
      id: row.id,
      jobId: row.jobId,
      customerId: row.customerId,
      mccCustomerId: row.mccCustomerId,
      campaignName: row.campaignName,
      merchantUrl: row.merchantUrl,
      finalUrlSuffix: row.finalUrlSuffix,
      status: row.status,
      dailyBudgetMicros: row.dailyBudgetMicros.toString(),
      bidding: row.bidding,
      cpcBidCeilingMicros: row.cpcBidCeilingMicros.toString(),
    };
  }

  private async addEvent(jobId: string, status: string, step: string, message: string) {
    await this.prisma.adJobEvent.create({ data: { jobId, status, step, message } });
  }

  /**
   * 校验发文表单，并按联盟账号拼出跟踪链接和示例正文。
   */
  private async prepareComposedArticle(ownerUserId: number, input: ArticleComposeInput) {
    const account = await this.prisma.channelAccount.findFirst({
      where: { id: input.channelAccountId, ownerUserId },
      include: { platform: true, site: true },
    });
    if (!account) throw new NotFoundException('联盟账号不存在');
    const merchantUrl = input.merchantUrl.trim();
    if (!/^https?:\/\//i.test(merchantUrl)) {
      throw new BadRequestException('商家网址需要以 http 或 https 开头');
    }
    const merchant = input.catalogMerchantId
      ? await this.prisma.catalogMerchant.findFirst({
          where: { id: input.catalogMerchantId, ownerUserId },
        })
      : null;
    if (input.catalogMerchantId && !merchant) throw new NotFoundException('商家不存在');
    if (merchant && merchant.blockReason !== 'none') throw new BadRequestException('这个商家不能发文');
    const name = (input.name || merchant?.name || '').trim();
    if (!name) throw new BadRequestException('请填写商家名称');
    const mid = (input.mid || merchant?.mid || '').trim();
    const countryCode = input.countryCode.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(countryCode)) throw new BadRequestException('目标国家用两位代码，例如 US');
    const languageCode = input.languageCode.trim() || 'en';
    const trackUrl = buildTrackUrl(account.platform.code, merchantUrl, account.trackLinkPrefix);
    const sample = buildSampleArticle({ merchantName: name, merchantUrl, trackUrl, languageCode });
    return { account, merchant, name, mid, countryCode, languageCode, trackUrl, merchantUrl, sample };
  }
}

/**
 * 可用性。暂停、取消、关闭为禁用；有启用系列为占用；其余为空闲。
 */
function accountAvailability(googleStatus: string, activeCampaignCount: number, saved: string): 'disabled' | 'occupied' | 'idle' {
  if (
    saved === 'disabled' ||
    googleStatus === 'SUSPENDED' ||
    googleStatus === 'CANCELED' ||
    googleStatus === 'CLOSED'
  ) {
    return 'disabled';
  }
  return activeCampaignCount > 0 ? 'occupied' : 'idle';
}

/**
 * 只保留数字，用来对齐带横杠和不带横杠的客户号。
 */
function digits(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * MCC 键。数据源还没有 Google 客户号时用 s + 数据源 id，长度不超过 16。
 */
function normalizeMccKey(value: string): string {
  const trimmed = value.trim();
  if (/^[A-Za-z][A-Za-z0-9]{0,15}$/.test(trimmed)) return trimmed;
  const numeric = digits(trimmed).slice(0, 16);
  if (!numeric) throw new BadRequestException('请选择 MCC');
  return numeric;
}

/**
 * 草稿补丁里去掉 undefined，避免把已有字段覆盖掉。
 */
function stripEmpty(patch: Partial<AdDraft>): Partial<AdDraft> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<AdDraft>;
}

interface ArticleComposeInput {
  channelAccountId: number;
  siteId?: number | null;
  catalogMerchantId?: number | null;
  name?: string;
  mid?: string;
  merchantUrl: string;
  countryCode: string;
  languageCode: string;
}

/**
 * 下拉里的商家名称，带上平台和 MID。
 */
function articleMerchantLabel(name: string, platformCode: string, mid: string): string {
  const platform = platformCode ? ` [${platformCode}]` : '';
  const id = mid ? ` (MID: ${mid})` : '';
  return `${name}${platform}${id}`;
}

/**
 * 系列名第三段是商家，第四段是国家。编号-联盟序号-商家-国家-日期-商家ID。
 */
function campaignMerchantParts(campaignName: string): { name: string; countryCode: string } {
  const parts = campaignName.split('-').map((part) => part.trim()).filter(Boolean);
  const name = parts.length >= 3 ? parts[2] : '';
  const countryCode = parts.length >= 4 && /^[A-Za-z]{2}$/.test(parts[3]) ? parts[3].toUpperCase() : 'US';
  return { name, countryCode };
}

/**
 * 联盟序号前缀对应平台代码，用来在没有精确账号时找唯一账号。
 */
function platformCodeFromAlias(alias: string): string {
  const prefix = alias.toLowerCase();
  if (prefix.startsWith('lh')) return 'linkhaitao';
  if (prefix.startsWith('pm')) return 'partnermatic';
  if (prefix.startsWith('lb')) return 'linkbux';
  if (prefix.startsWith('rw')) return 'rewardoo';
  if (prefix.startsWith('ui')) return 'ultrainfluence';
  if (prefix.startsWith('cg')) return 'collabglow';
  if (prefix.startsWith('fs')) return 'famesta';
  return '';
}

/**
 * 联盟序号对不上账号时，这个平台如果只有一个账号就用它。
 */
function onlyAccountForAlias<T extends { platform: { code: string } }>(accounts: T[], alias: string): T | undefined {
  const code = platformCodeFromAlias(alias);
  if (!code) return undefined;
  const matched = accounts.filter((account) => account.platform.code === code);
  return matched.length === 1 ? matched[0] : undefined;
}

/**
 * 按网址生成一个可登记的 MID。
 */
function midFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').slice(0, 64) || 'merchant';
  } catch {
    return 'merchant';
  }
}

/**
 * 文章正文只放联盟跟踪链接，广告最终到达网址仍是商家网址。
 */
function articleBody(merchantName: string, trackUrl: string): string {
  return `<p><a href="${trackUrl}">${merchantName}</a></p>`;
}
