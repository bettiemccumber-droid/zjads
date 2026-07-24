import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { isCollectorImplemented } from '../collectors/collectors.registry';
import { PrismaService } from '../prisma/prisma.service';
import { ensurePlatformCatalog } from './platform-catalog.util';

@Injectable()
export class PlatformsService implements OnModuleInit {
  private readonly logger = new Logger(PlatformsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    try {
      await ensurePlatformCatalog(this.prisma);
    } catch (err) {
      this.logger.error(
        `平台目录同步失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async listEnabled() {
    const rows = await this.prisma.platform.findMany({
      where: { isEnabled: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        credentialSchema: true,
      },
    });
    return rows.map((p) => ({
      ...p,
      collectorImplemented: isCollectorImplemented(p.code),
    }));
  }

  async getStatusMappings(platformId: number) {
    return this.prisma.platformStatusMapping.findMany({
      where: { platformId },
    });
  }

  async getStatusMappingsByCode(platformCode: string) {
    const platform = await this.prisma.platform.findUnique({
      where: { code: platformCode },
    });
    if (!platform) return [];
    return this.getStatusMappings(platform.id);
  }
}
