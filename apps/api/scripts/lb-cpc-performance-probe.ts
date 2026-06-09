/**
 * 探测 LinkBux CPC Performance API（官方参数 begin_click_date / end_click_date）
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

async function fetchPage(
  token: string,
  begin: string,
  end: string,
  page: number,
  extra: Record<string, string> = {},
) {
  const res = await axios.get(LB, {
    params: {
      mod: 'medium',
      op: 'cpc_performance',
      token,
      begin_click_date: begin,
      end_click_date: end,
      type: 'json',
      status: 'All',
      page: String(page),
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
  const { apiToken } = decrypt(lb!.credentialsEnc!);
  const token = apiToken!;

  const weekStart = '2026-06-01';
  const weekEnd = '2026-06-07';

  console.log('=== CPC Performance 7日 ===');
  const p1 = await fetchPage(token, weekStart, weekEnd, 1);
  console.log(JSON.stringify(p1, null, 2).slice(0, 2500));

  const data = (p1 as { data?: { list?: unknown[]; total_items?: string | number; total_page?: number } }).data;
  const list = (data?.list ?? []) as Record<string, unknown>[];
  const totalItems = Number(data?.total_items ?? 0);
  const totalPage = Number(data?.total_page ?? 1);

  let all = [...list];
  for (let page = 2; page <= totalPage && page <= 20; page += 1) {
    await new Promise((r) => setTimeout(r, 1500));
    const pn = await fetchPage(token, weekStart, weekEnd, page);
    const rows = ((pn as { data?: { list?: unknown[] } }).data?.list ?? []) as Record<string, unknown>[];
    all.push(...rows);
    if (all.length >= totalItems) break;
  }

  const totalClicks = all.reduce((s, r) => s + Number(r.clicks ?? 0), 0);
  const divani = all.filter((r) => String(r.mid) === '388783' || String(r.mcid).includes('divani'));
  const divaniClicks = divani.reduce((s, r) => s + Number(r.clicks ?? 0), 0);

  console.log(`\nrows=${all.length} total_items=${totalItems} sum(clicks)=${totalClicks}`);
  console.log(`Divani rows=${divani.length} clicks=${divaniClicks} (CPS后台约15757)`);
  if (divani.length) {
    console.log('Divani sample:', JSON.stringify(divani.slice(0, 3), null, 2));
  }
  if (list[0]) {
    console.log('\n首行字段:', Object.keys(list[0]).join(', '));
  }

  console.log('\n=== 按 mcid=divanideaaa 筛选 ===');
  const filtered = await fetchPage(token, weekStart, weekEnd, 1, { mcid: 'divanideaaa' });
  const fList = ((filtered as { data?: { list?: unknown[]; total_items?: number } }).data?.list ??
    []) as Record<string, unknown>[];
  console.log(
    `items=${(filtered as { data?: { total_items?: number } }).data?.total_items} list=${fList.length} clicks=${fList.reduce((s, r) => s + Number(r.clicks ?? 0), 0)}`,
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
