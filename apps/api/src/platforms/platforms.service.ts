import { Injectable } from '@nestjs/common';
import { isCollectorImplemented } from '../collectors/collectors.registry';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PlatformsService {
  constructor(private readonly prisma: PrismaService) {}

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
