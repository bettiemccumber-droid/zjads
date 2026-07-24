import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

import {
  PLATFORM_CATALOG,
  buildPlatformCredentialSchema,
} from '../src/platforms/platform-catalog.util';
import { ensurePlatformStatusMappings } from '../src/common/platform-status-defaults.util';

const prisma = new PrismaClient();

async function main() {
  let org = await prisma.organization.findFirst();
  if (!org) {
    org = await prisma.organization.create({ data: { name: '默认公司' } });
  }

  const passwordHash = await bcrypt.hash('Admin123!', 10);
  await prisma.user.upsert({
    where: { email: 'admin@company.local' },
    update: {},
    create: {
      organizationId: org.id,
      email: 'admin@company.local',
      passwordHash,
      username: '管理员',
      role: 'ADMIN',
    },
  });

  for (const p of PLATFORM_CATALOG) {
    const platform = await prisma.platform.upsert({
      where: { code: p.code },
      update: { name: p.name, sortOrder: p.sortOrder },
      create: {
        code: p.code,
        name: p.name,
        sortOrder: p.sortOrder,
        credentialSchema: buildPlatformCredentialSchema(p.code),
      },
    });

    await ensurePlatformStatusMappings(prisma, platform.id, p.code);
  }

  console.log('Seed OK: admin@company.local / Admin123!, platforms');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
