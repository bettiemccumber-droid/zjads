import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import axios from 'axios';
import { createHash } from 'crypto';
import { isCollectorImplemented } from '../collectors/collectors.registry';
import { CryptoService } from '../common/crypto.service';
import { AuthUser, isAdmin, resolveOwnerUserId } from '../common/ownership.util';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateChannelAccountDto {
  platformId: number;
  externalChannelId?: string;
  displayName: string;
  affiliateAlias?: string;
  apiToken: string;
  /** 绑定内容站时必填，并且要对应一次成功的测试连接。 */
  siteId?: number;
  paymentMethodId?: number;
  testId?: number;
  trackLinkPrefix?: string;
}

export interface UpdateChannelAccountDto {
  displayName?: string;
  externalChannelId?: string;
  affiliateAlias?: string;
  settlementPayeeName?: string;
  settlementBankAccount?: string;
  /** 留空则不修改 Token */
  apiToken?: string;
  isActive?: boolean;
  siteId?: number | null;
  paymentMethodId?: number | null;
  trackLinkPrefix?: string;
  testId?: number;
}

@Injectable()
export class ChannelAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  private toPublic(account: {
    id: number;
    platformId: number;
    externalChannelId: string;
    displayName: string;
    affiliateAlias: string;
    settlementPayeeName: string;
    settlementBankAccount: string;
    isActive: boolean;
    createdAt: Date;
    credentialsEnc: string;
    siteId?: number | null;
    paymentMethodId?: number | null;
    trackLinkPrefix?: string;
    lastTestedAt?: Date | null;
    lastTestOk?: boolean;
    site?: { id: number; name: string; domain: string } | null;
    paymentMethod?: { id: number; name: string } | null;
    platform?: { code: string; name: string };
  }) {
    let tokenPreview = '****';
    try {
      const cred = this.crypto.decrypt<{ apiToken?: string }>(account.credentialsEnc);
      tokenPreview = this.crypto.maskToken(cred.apiToken ?? '');
    } catch {
      /* ignore */
    }
    return {
      id: account.id,
      platformId: account.platformId,
      platformCode: account.platform?.code,
      platformName: account.platform?.name,
      externalChannelId: account.externalChannelId || null,
      displayName: account.displayName,
      affiliateAlias: account.affiliateAlias,
      settlementPayeeName: account.settlementPayeeName ?? '',
      settlementBankAccount: account.settlementBankAccount ?? '',
      isActive: account.isActive,
      tokenPreview,
      siteId: account.siteId ?? null,
      siteName: account.site?.name ?? null,
      siteDomain: account.site?.domain ?? null,
      paymentMethodId: account.paymentMethodId ?? null,
      paymentMethodName: account.paymentMethod?.name ?? null,
      trackLinkPrefix: account.trackLinkPrefix ?? '',
      lastTestedAt: account.lastTestedAt ?? null,
      lastTestOk: account.lastTestOk ?? false,
      createdAt: account.createdAt,
    };
  }

  async list(user: AuthUser, filterUserId?: number) {
    const ownerId =
      filterUserId != null ? resolveOwnerUserId(user, filterUserId, 'read') : user.id;
    const accounts = await this.prisma.channelAccount.findMany({
      where: { ownerUserId: ownerId },
      include: { platform: true, site: true, paymentMethod: true },
      orderBy: [{ platform: { sortOrder: 'asc' } }, { id: 'desc' }],
    });
    return accounts.map((a) => this.toPublic(a));
  }

  async listGroupedByPlatform(user: AuthUser, filterUserId?: number) {
    const items = await this.list(user, filterUserId);
    const map = new Map<string, typeof items>();
    for (const item of items) {
      const key = item.platformCode ?? 'unknown';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries()).map(([code, accounts]) => ({
      platformCode: code,
      platformName: accounts[0]?.platformName ?? code,
      collectorImplemented: isCollectorImplemented(code),
      accounts,
    }));
  }

  async create(user: AuthUser, dto: CreateChannelAccountDto) {
    const platform = await this.prisma.platform.findUnique({
      where: { id: dto.platformId },
    });
    if (!platform?.isEnabled) throw new NotFoundException('平台不存在');

    const channelId = (dto.externalChannelId ?? '').trim();
    const credentialsEnc = this.crypto.encrypt({ apiToken: dto.apiToken.trim() });
    const binding = await this.resolveSiteBinding(user.id, dto);

    try {
      const account = await this.prisma.channelAccount.create({
        data: {
          ownerUserId: user.id,
          platformId: dto.platformId,
          externalChannelId: channelId,
          displayName: dto.displayName.trim(),
          affiliateAlias: (dto.affiliateAlias ?? '').trim().toLowerCase(),
          credentialsEnc,
          siteId: binding.siteId,
          paymentMethodId: binding.paymentMethodId,
          trackLinkPrefix: (dto.trackLinkPrefix ?? '').trim(),
          lastTestedAt: binding.testedAt,
          lastTestOk: binding.tested,
        },
        include: { platform: true, site: true, paymentMethod: true },
      });
      return this.toPublic(account);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('该平台下此 Channel 已存在，请勿重复添加');
      }
      throw e;
    }
  }

  /**
   * 用 API Key 打一次平台接口。Partnermatic 请求当天第一页；其他平台只确认 Key 非空并标明未接入远端测试。
   * 编辑时 Key 留空，则用该账号已保存的 Key。不修改已有渠道账号。
   */
  async testConnection(user: AuthUser, platformId: number, apiToken?: string, accountId?: number) {
    let token = apiToken?.trim() ?? '';
    let resolvedPlatformId = platformId;
    if (!token && accountId) {
      const account = await this.prisma.channelAccount.findUnique({ where: { id: accountId } });
      if (!account) throw new NotFoundException('账号不存在');
      if (account.ownerUserId !== user.id && !isAdmin(user)) {
        throw new ForbiddenException('无权测试此账号');
      }
      token = this.crypto.decrypt<{ apiToken: string }>(account.credentialsEnc).apiToken.trim();
      resolvedPlatformId = account.platformId;
    }
    const platform = await this.prisma.platform.findUnique({ where: { id: resolvedPlatformId } });
    if (!platform?.isEnabled) throw new NotFoundException('平台不存在');
    if (!token) throw new BadRequestException('API Key 不能为空');

    let okResult = false;
    let message = '该平台的远端测试还没接入';
    if (platform.code === 'partnermatic') {
      const probed = await this.probePartnermatic(token);
      okResult = probed.ok;
      message = probed.message;
    } else {
      okResult = true;
      message = '未请求该平台远端接口，Key 非空，记为通过';
    }

    const row = await this.prisma.channelConnectionTest.create({
      data: {
        ownerUserId: user.id,
        platformId: resolvedPlatformId,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        ok: okResult,
        message: message.slice(0, 500),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
    return { id: row.id, ok: row.ok, message: row.message };
  }

  /**
   * 绑定内容站时核销一次成功的测试。不绑站点则保持原有创建行为。
   */
  private async resolveSiteBinding(ownerUserId: number, dto: CreateChannelAccountDto) {
    if (!dto.siteId) {
      return { siteId: null as number | null, paymentMethodId: null as number | null, tested: false, testedAt: null as Date | null };
    }
    if (!dto.testId) throw new BadRequestException('绑定内容站前需要先测试连接');
    const tokenHash = createHash('sha256').update(dto.apiToken.trim()).digest('hex');
    const test = await this.prisma.channelConnectionTest.findFirst({
      where: {
        id: dto.testId,
        ownerUserId,
        platformId: dto.platformId,
        tokenHash,
        ok: true,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!test) throw new BadRequestException('测试连接已失效，请重新测试');
    const site = await this.prisma.publishSite.findFirst({
      where: { id: dto.siteId },
    });
    if (!site) throw new NotFoundException('内容站不存在');
    let paymentMethodId: number | null = null;
    if (dto.paymentMethodId) {
      const method = await this.prisma.paymentMethod.findFirst({
        where: { id: dto.paymentMethodId, ownerUserId },
      });
      if (!method) throw new NotFoundException('收款方式不存在');
      paymentMethodId = method.id;
    }
    await this.prisma.channelConnectionTest.update({
      where: { id: test.id },
      data: { consumedAt: new Date() },
    });
    return { siteId: site.id, paymentMethodId, tested: true, testedAt: new Date() };
  }

  /**
   * 用当天的一页交易确认 Partnermatic Key 是否有效。
   */
  private async probePartnermatic(token: string): Promise<{ ok: boolean; message: string }> {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
    try {
      const response = await axios.post(
        'https://api.partnermatic.com/api/transaction',
        {
          source: 'partnermatic',
          token,
          dataScope: 'user',
          beginDate: day,
          endDate: day,
          curPage: 1,
          perPage: 1,
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 15000 },
      );
      if (response.data?.code === '0') return { ok: true, message: '连接成功' };
      return { ok: false, message: String(response.data?.message ?? 'PartnerMatic API 错误') };
    } catch (error) {
      const message = error instanceof Error ? error.message : '连接失败';
      return { ok: false, message };
    }
  }

  /**
   * 更新渠道账号（联盟序号、Channel ID、Token 等；留空 Token 表示不修改）
   */
  async update(user: AuthUser, id: number, dto: UpdateChannelAccountDto) {
    const account = await this.prisma.channelAccount.findUnique({
      where: { id },
      include: { platform: true, site: true, paymentMethod: true },
    });
    if (!account) throw new NotFoundException('账号不存在');
    if (account.ownerUserId !== user.id && !isAdmin(user)) {
      throw new ForbiddenException('无权修改此账号');
    }

    const data: Prisma.ChannelAccountUpdateInput = {};

    if (dto.displayName !== undefined) {
      const name = dto.displayName.trim();
      if (!name) throw new ConflictException('显示名称不能为空');
      data.displayName = name;
    }
    if (dto.affiliateAlias !== undefined) {
      data.affiliateAlias = dto.affiliateAlias.trim().toLowerCase();
    }
    if (dto.externalChannelId !== undefined) {
      data.externalChannelId = dto.externalChannelId.trim();
    }
    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }
    if (dto.settlementPayeeName !== undefined) {
      data.settlementPayeeName = dto.settlementPayeeName.trim().slice(0, 120);
    }
    if (dto.settlementBankAccount !== undefined) {
      data.settlementBankAccount = dto.settlementBankAccount.trim().slice(0, 80);
    }
    let testedOk = account.lastTestOk;
    if (dto.testId) {
      const token =
        dto.apiToken?.trim() ||
        this.crypto.decrypt<{ apiToken: string }>(account.credentialsEnc).apiToken;
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const test = await this.prisma.channelConnectionTest.findFirst({
        where: {
          id: dto.testId,
          ownerUserId: account.ownerUserId,
          platformId: account.platformId,
          tokenHash,
          ok: true,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (!test) throw new BadRequestException('测试连接已失效，请重新测试');
      await this.prisma.channelConnectionTest.update({
        where: { id: test.id },
        data: { consumedAt: new Date() },
      });
      testedOk = true;
      data.lastTestOk = true;
      data.lastTestedAt = new Date();
    }
    if (dto.apiToken !== undefined && dto.apiToken.trim()) {
      data.credentialsEnc = this.crypto.encrypt({ apiToken: dto.apiToken.trim() });
      if (!dto.testId) {
        data.lastTestOk = false;
        testedOk = false;
      }
    }
    if (dto.trackLinkPrefix !== undefined) {
      data.trackLinkPrefix = dto.trackLinkPrefix.trim().slice(0, 500);
    }
    if (dto.siteId !== undefined) {
      if (dto.siteId === null) {
        data.site = { disconnect: true };
      } else {
        const site = await this.prisma.publishSite.findFirst({
          where: { id: dto.siteId },
        });
        if (!site) throw new NotFoundException('内容站不存在');
        if (!testedOk) throw new BadRequestException('绑定内容站前需要先测试连接');
        data.site = { connect: { id: site.id } };
      }
    }
    if (dto.paymentMethodId !== undefined) {
      if (dto.paymentMethodId === null) {
        data.paymentMethod = { disconnect: true };
      } else {
        const method = await this.prisma.paymentMethod.findFirst({
          where: { id: dto.paymentMethodId, ownerUserId: account.ownerUserId },
        });
        if (!method) throw new NotFoundException('收款方式不存在');
        data.paymentMethod = { connect: { id: method.id } };
      }
    }

    if (!Object.keys(data).length) {
      return this.toPublic(account);
    }

    try {
      const updated = await this.prisma.channelAccount.update({
        where: { id },
        data,
        include: { platform: true, site: true, paymentMethod: true },
      });
      return this.toPublic(updated);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('该平台下此 Channel 已被其他账号使用');
      }
      throw e;
    }
  }

  async remove(user: AuthUser, id: number) {
    const account = await this.prisma.channelAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('账号不存在');
    if (account.ownerUserId !== user.id && !isAdmin(user)) {
      throw new ForbiddenException('无权删除此账号');
    }
    await this.prisma.channelAccount.delete({ where: { id } });
    return { id };
  }

  async getWithCredentials(ownerUserId: number, id: number) {
    const account = await this.prisma.channelAccount.findFirst({
      where: { id, ownerUserId, isActive: true },
      include: { platform: true, site: true, paymentMethod: true },
    });
    if (!account) throw new NotFoundException('渠道账号不存在');
    const credentials = this.crypto.decrypt<{ apiToken: string }>(account.credentialsEnc);
    return { account, credentials };
  }

  async listActiveForSync(ownerUserId: number) {
    return this.prisma.channelAccount.findMany({
      where: { ownerUserId, isActive: true },
      include: { platform: true, site: true, paymentMethod: true },
    });
  }
}
