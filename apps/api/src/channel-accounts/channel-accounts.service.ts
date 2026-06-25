import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isCollectorImplemented } from '../collectors/collectors.registry';
import { CryptoService } from '../common/crypto.service';
import { AuthUser, isAdmin } from '../common/ownership.util';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateChannelAccountDto {
  platformId: number;
  externalChannelId?: string;
  displayName: string;
  affiliateAlias?: string;
  apiToken: string;
}

export interface UpdateChannelAccountDto {
  displayName?: string;
  externalChannelId?: string;
  affiliateAlias?: string;
  /** 留空则不修改 Token */
  apiToken?: string;
  isActive?: boolean;
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
    isActive: boolean;
    createdAt: Date;
    credentialsEnc: string;
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
      isActive: account.isActive,
      tokenPreview,
      createdAt: account.createdAt,
    };
  }

  async list(user: AuthUser, filterUserId?: number) {
    const ownerId = isAdmin(user) && filterUserId ? filterUserId : user.id;
    const accounts = await this.prisma.channelAccount.findMany({
      where: { ownerUserId: ownerId },
      include: { platform: true },
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

    try {
      const account = await this.prisma.channelAccount.create({
        data: {
          ownerUserId: user.id,
          platformId: dto.platformId,
          externalChannelId: channelId,
          displayName: dto.displayName.trim(),
          affiliateAlias: (dto.affiliateAlias ?? '').trim().toLowerCase(),
          credentialsEnc,
        },
        include: { platform: true },
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
   * 更新渠道账号（联盟序号、Channel ID、Token 等；留空 Token 表示不修改）
   */
  async update(user: AuthUser, id: number, dto: UpdateChannelAccountDto) {
    const account = await this.prisma.channelAccount.findUnique({
      where: { id },
      include: { platform: true },
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
    if (dto.apiToken !== undefined && dto.apiToken.trim()) {
      data.credentialsEnc = this.crypto.encrypt({ apiToken: dto.apiToken.trim() });
    }

    if (!Object.keys(data).length) {
      return this.toPublic(account);
    }

    try {
      const updated = await this.prisma.channelAccount.update({
        where: { id },
        data,
        include: { platform: true },
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
      include: { platform: true },
    });
    if (!account) throw new NotFoundException('渠道账号不存在');
    const credentials = this.crypto.decrypt<{ apiToken: string }>(account.credentialsEnc);
    return { account, credentials };
  }

  async listActiveForSync(ownerUserId: number) {
    return this.prisma.channelAccount.findMany({
      where: { ownerUserId, isActive: true },
      include: { platform: true },
    });
  }
}
