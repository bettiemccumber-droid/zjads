/**
 * 探测 LinkBux user_click 响应结构（本地诊断）
 */
import axios from 'axios';
import { fetchLinkBuxClicks } from '../src/collectors/linkbux-clicks';
import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();
const LB_API = 'https://www.linkbux.com/api.php';

function decryptCredentials(payload: string): { apiToken?: string } {
  const hex = process.env.CREDENTIALS_ENCRYPTION_KEY ?? '';
  const key = Buffer.from(hex, 'hex');
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  return JSON.parse(dec) as { apiToken?: string };
}

async function probe(label: string, token: string, begin: string, end: string) {
  const res = await axios.get(LB_API, {
    params: {
      mod: 'medium',
      op: 'user_click',
      token,
      begin_date: begin,
      end_date: end,
      type: 'json',
      page: '1',
      limit: '10',
    },
    timeout: 120000,
    validateStatus: () => true,
  });
  console.log(`\n--- ${label} ---`);
  console.log(`begin=${begin} end=${end} http=${res.status}`);
  console.log(JSON.stringify(res.data, null, 2).slice(0, 2000));
}

async function main() {
  const lb = await prisma.channelAccount.findFirst({
    where: { platform: { code: 'linkbux' } },
    select: { credentialsEnc: true, displayName: true, affiliateAlias: true },
  });
  if (!lb?.credentialsEnc || !process.env.CREDENTIALS_ENCRYPTION_KEY) {
    console.log('需要 linkbux 账号与 CREDENTIALS_ENCRYPTION_KEY');
    return;
  }
  const { apiToken } = decryptCredentials(lb.credentialsEnc);
  if (!apiToken) {
    console.log('无 apiToken');
    return;
  }
  console.log(`账号: ${lb.displayName} (${lb.affiliateAlias})`);

  const day = '2026-06-01';
  await probe('日期仅 YMD', apiToken, day, day);
  await probe('两日 YMD', apiToken, day, '2026-06-02');
  await probe('小时片', apiToken, `${day} 00:00:00`, `${day} 00:59:59`);

  console.log('\n=== fetchLinkBuxClicks 单日 ===');
  const dayResult = await fetchLinkBuxClicks(apiToken, day, day);
  console.log(`商家数 ${dayResult.aggs.length}, 点击合计 ${dayResult.accountClickTotal}`);
  for (const a of dayResult.aggs.slice(0, 5)) {
    console.log(`  mid=${a.merchantId} ${a.clickDate} clicks=${a.clicks}`);
  }

  const weekStart = '2026-06-01';
  const weekEnd = '2026-06-07';
  console.log(`\n=== fetchLinkBuxClicks ${weekStart}~${weekEnd} ===`);
  const weekResult = await fetchLinkBuxClicks(apiToken, weekStart, weekEnd);
  const divani = weekResult.aggs
    .filter((a) => a.merchantId === '388783')
    .reduce((s, r) => s + r.clicks, 0);
  console.log(
    `账号合计 ${weekResult.accountClickTotal}，Divani(388783) ${divani}（LB 后台约 15757）`,
  );
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
