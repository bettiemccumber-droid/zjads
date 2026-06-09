/**
 * 深入探测 LinkBux performance API 是否含商家×日点击
 */
import axios from 'axios';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();
const LB = 'https://www.linkbux.com/api.php';
const prisma = new PrismaClient();

function decrypt(p: string) {
  const key = Buffer.from(process.env.CREDENTIALS_ENCRYPTION_KEY ?? '', 'hex');
  const buf = Buffer.from(p, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString()) as { apiToken?: string };
}

async function fetchPerf(token: string, extra: Record<string, string> = {}) {
  const res = await axios.get(LB, {
    params: {
      mod: 'medium',
      op: 'performance',
      token,
      begin_date: '2026-06-01',
      end_date: '2026-06-07',
      type: 'json',
      page: '1',
      limit: '2000',
      ...extra,
    },
    timeout: 120000,
    validateStatus: () => true,
  });
  return res.data;
}

async function main() {
  const lb = await prisma.channelAccount.findFirst({
    where: { affiliateAlias: 'lb2' },
    select: { credentialsEnc: true },
  });
  const token = decrypt(lb!.credentialsEnc!).apiToken!;

  console.log('=== performance 默认 ===');
  const p1 = await fetchPerf(token);
  console.log(JSON.stringify(p1, null, 2).slice(0, 3000));

  const list = ((p1 as { data?: { list?: unknown[] } }).data?.list ??
    (p1 as { payliad?: { list?: unknown[] } }).payliad?.list ??
    []) as Record<string, unknown>[];
  if (list[0]) {
    console.log('\n首行 keys:', Object.keys(list[0]).join(', '));
    console.log('首行:', JSON.stringify(list[0], null, 2));
  }

  console.log('\n=== performance + offer_type=CPS ===');
  const p2 = await fetchPerf(token, { offer_type: 'CPS' });
  const list2 = ((p2 as { data?: { list?: unknown[] } }).data?.list ?? []) as Record<string, unknown>[];
  console.log('total_items=', (p2 as { data?: { total_items?: number } }).data?.total_items);
  console.log('list len=', list2.length);
  if (list2[0]) console.log('keys:', Object.keys(list2[0]).join(', '));

  console.log('\n=== 按 mid 筛选 Divani ===');
  await new Promise((r) => setTimeout(r, 2000));
  const p3 = await fetchPerf(token, { mid: '388783', mcid: 'divanideaaa' });
  console.log(JSON.stringify(p3, null, 2).slice(0, 2000));

  console.log('\n=== 单日 performance ===');
  await new Promise((r) => setTimeout(r, 2000));
  const p4 = await fetchPerf(token, { begin_date: '2026-06-02', end_date: '2026-06-02' });
  const list4 = ((p4 as { data?: { list?: unknown[] } }).data?.list ?? []) as Record<string, unknown>[];
  const divani = list4.filter((r) => String(r.mid) === '388783' || String(r.mcid).includes('divani'));
  console.log(`06-02 rows=${list4.length} divani rows=${divani.length}`);
  if (divani[0]) console.log('divani row:', JSON.stringify(divani[0], null, 2));

  /** 汇总 clicks 类字段 */
  for (const row of list4) {
    const clickFields = Object.entries(row).filter(([k, v]) => /click/i.test(k) && v != null);
    if (clickFields.length) {
      console.log('click fields sample:', clickFields.map(([k, v]) => `${k}=${v}`).join(', '));
      break;
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
