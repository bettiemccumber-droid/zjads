import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/** @typedef {'approved' | 'pending' | 'rejected'} NormStatus */

const platforms = [
  { code: 'partnermatic', name: 'PartnerMatic', sortOrder: 1 },
  { code: 'linkhaitao', name: 'LinkHaitao', sortOrder: 2 },
  { code: 'linkbux', name: 'LinkBux', sortOrder: 3 },
  { code: 'rewardoo', name: 'Rewardoo', sortOrder: 4 },
  { code: 'partnerboost', name: 'PartnerBoost', sortOrder: 5 },
  { code: 'brandsparkhub', name: 'Brandsparkhub', sortOrder: 6 },
  { code: 'creatorflare', name: 'Creatorflare', sortOrder: 7 },
  { code: 'collabglow', name: 'CollabGlow', sortOrder: 8 },
];

const pmStatusMappings: Array<{ raw: string; norm: 'approved' | 'pending' | 'rejected' }> = [
  { raw: 'Approved', norm: 'approved' },
  { raw: 'APPROVED', norm: 'approved' },
  { raw: 'Pending', norm: 'pending' },
  { raw: 'PENDING', norm: 'pending' },
  { raw: 'Rejected', norm: 'rejected' },
  { raw: 'REJECTED', norm: 'rejected' },
  { raw: 'Canceled', norm: 'rejected' },
  { raw: 'CANCELED', norm: 'rejected' },
];

const lhStatusMappings: Array<{ raw: string; norm: 'approved' | 'pending' | 'rejected' }> = [
  { raw: 'EFFECTIVE', norm: 'approved' },
  { raw: 'UNTREATED', norm: 'pending' },
  { raw: 'EXPIRED', norm: 'rejected' },
  { raw: 'REJECTED', norm: 'rejected' },
];

const lbStatusMappings: Array<{ raw: string; norm: 'approved' | 'pending' | 'rejected' }> = [
  { raw: 'Approved', norm: 'approved' },
  { raw: 'APPROVED', norm: 'approved' },
  { raw: 'Pending', norm: 'pending' },
  { raw: 'PENDING', norm: 'pending' },
  { raw: 'Rejected', norm: 'rejected' },
  { raw: 'REJECTED', norm: 'rejected' },
];

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

  for (const p of platforms) {
    const platform = await prisma.platform.upsert({
      where: { code: p.code },
      update: { name: p.name, sortOrder: p.sortOrder },
      create: {
        code: p.code,
        name: p.name,
        sortOrder: p.sortOrder,
        credentialSchema: {
          fields: [
            { key: 'apiToken', label: 'API Token', required: true, secret: true },
            {
              key: 'externalChannelId',
              label: 'Channel ID',
              required: p.code === 'partnermatic',
            },
          ],
        },
      },
    });

    const mappings =
      p.code === 'partnermatic'
        ? pmStatusMappings
        : p.code === 'linkhaitao'
          ? lhStatusMappings
          : p.code === 'linkbux'
            ? lbStatusMappings
            : pmStatusMappings.slice(0, 4);
    for (const m of mappings) {
      await prisma.platformStatusMapping.upsert({
        where: {
          platformId_rawStatus: { platformId: platform.id, rawStatus: m.raw },
        },
        update: { normalizedStatus: m.norm },
        create: {
          platformId: platform.id,
          rawStatus: m.raw,
          normalizedStatus: m.norm,
        },
      });
    }
  }

  console.log('Seed OK: admin@company.local / Admin123!, platforms');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
