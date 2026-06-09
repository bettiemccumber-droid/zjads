/**
 * 探测 PM click_report 中 Ticombo(116442) 的 brand_id 字段
 */
import * as crypto from 'crypto';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

function decrypt(cipherB64: string) {
  const key = Buffer.from(process.env.CREDENTIALS_ENCRYPTION_KEY ?? '', 'hex');
  const buf = Buffer.from(cipherB64, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'),
  ) as { apiToken?: string };
}

const URL = 'https://api.partnermatic.com/api/click_report';

async function main() {
  const prisma = new PrismaClient();
  const account = await prisma.channelAccount.findFirst({
    where: { affiliateAlias: 'pm2', platform: { code: 'partnermatic' } },
  });
  if (!account) return console.log('no pm2');
  const { apiToken } = decrypt(account.credentialsEnc);

  const day = '2026-06-01';
  let page = 1;
  let totalPages = 1;
  const matches: unknown[] = [];
  let total = 0;

  while (page <= totalPages && page <= 20) {
    const res = await axios.post(
      URL,
      {
        source: 'partnermatic',
        token: apiToken,
        beginDate: `${day} 00:00:00`,
        endDate: `${day} 23:59:59`,
        curPage: page,
        perPage: 500,
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 60000 },
    );
    if (res.data?.code !== '0') {
      console.log('err', res.data);
      break;
    }
    const data = res.data.data ?? {};
    totalPages = Number(data.total_page) || 1;
    const list = (data.list ?? []) as Record<string, unknown>[];
    total += list.length;
    for (const row of list) {
      const mid = String(row.brand_id ?? row.mid ?? '');
      const name = String(row.merchant_name ?? '');
      if (mid === '116442' || name.toLowerCase().includes('ticombo')) {
        matches.push(row);
      }
    }
    page += 1;
  }

  console.log(`day=${day} fetched=${total} matches=${matches.length}`);
  if (matches[0]) console.log('sample', JSON.stringify(matches[0]));
  const brandIds = new Set(matches.map((r) => String((r as Record<string, unknown>).brand_id ?? (r as Record<string, unknown>).mid)));
  console.log('brand_ids in matches', [...brandIds]);

  await prisma.$disconnect();
}

main().catch((e) => console.error(e.response?.data ?? e.message));
