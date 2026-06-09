/**
 * 按天读取 LB user_click 的 total_items（仅第 1 页元数据）
 */
import axios from 'axios';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { LB_API, extractLbClickListAndPages, assertLbClickApiSuccess } from '../src/collectors/linkbux-api.util';
import { fetchLinkBuxClicks } from '../src/collectors/linkbux-clicks';

dotenv.config();
const prisma = new PrismaClient();

function decryptCredentials(payload: string): { apiToken?: string } {
  const key = Buffer.from(process.env.CREDENTIALS_ENCRYPTION_KEY ?? '', 'hex');
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  return JSON.parse(dec) as { apiToken?: string };
}

async function main() {
  const lb = await prisma.channelAccount.findFirst({
    where: { affiliateAlias: 'lb2' },
    select: { credentialsEnc: true },
  });
  const { apiToken } = decryptCredentials(lb!.credentialsEnc!);

  const days = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05', '2026-06-06', '2026-06-07'];
  let metaTotal = 0;
  let cappedTotal = 0;

  for (const day of days) {
    const res = await axios.get(LB_API, {
      params: {
        mod: 'medium',
        op: 'user_click',
        token: apiToken,
        begin_date: day,
        end_date: day,
        type: 'json',
        page: '1',
        limit: '2000',
      },
      timeout: 120000,
      validateStatus: () => true,
    });
    assertLbClickApiSuccess(res.data, day);
    const parsed = extractLbClickListAndPages(res.data);
    metaTotal += parsed.totalItems;
    cappedTotal += Math.min(parsed.totalItems, parsed.list.length);
    console.log(`${day} total_items=${parsed.totalItems} page1=${parsed.list.length}`);
    await new Promise((r) => setTimeout(r, 2600));
  }

  console.log(`\nmeta total_items 合计=${metaTotal}`);
  console.log(` capped(每页2000)合计=${cappedTotal}`);

  const aggs = await fetchLinkBuxClicks(apiToken!, '2026-06-01', '2026-06-07');
  console.log(`fetchLinkBuxClicks 账号合计=${aggs.accountClickTotal}`);
  console.log(`LB 后台 CPS Total Clicks ≈ 22706`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
