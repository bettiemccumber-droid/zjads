/**
 * 探测 user_click 分页/limit/sort 及 report 模块
 */
import axios from 'axios';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { extractLbClickListAndPages } from '../src/collectors/linkbux-api.util';

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

async function clickQuery(token: string, params: Record<string, string>) {
  await new Promise((r) => setTimeout(r, 2600));
  const res = await axios.get(LB, {
    params: { mod: 'medium', op: 'user_click', token, begin_date: '2026-06-02', end_date: '2026-06-02', type: 'json', ...params },
    timeout: 120000,
    validateStatus: () => true,
  });
  const parsed = extractLbClickListAndPages(res.data);
  const refs1 = new Set((parsed.list as { click_ref?: string }[]).map((r) => r.click_ref).filter(Boolean));
  return { status: (res.data as { status?: unknown }).status, ...parsed, uniqueRefs: refs1.size };
}

async function main() {
  const lb = await prisma.channelAccount.findFirst({ where: { affiliateAlias: 'lb2' }, select: { credentialsEnc: true } });
  const token = decrypt(lb!.credentialsEnc!).apiToken!;

  console.log('=== limit 变体 ===');
  for (const limit of ['2000', '5000', '10000']) {
    const r = await clickQuery(token, { page: '1', limit });
    console.log(`limit=${limit}: total_items=${r.totalItems} list=${r.list.length} refs=${r.uniqueRefs}`);
  }

  console.log('\n=== page 1 vs 2 vs 3 ===');
  const pages: Record<string, unknown>[] = [];
  for (const page of ['1', '2', '3']) {
    const r = await clickQuery(token, { page, limit: '2000' });
    const refs = (r.list as { click_ref?: string }[]).map((x) => x.click_ref).slice(0, 3);
    pages.push(...(r.list as Record<string, unknown>[]));
    console.log(`page=${page}: list=${r.list.length} total_items=${r.totalItems} first3refs=${refs.join(',')}`);
  }
  const p1refs = new Set((pages.slice(0, 2000) as { click_ref?: string }[]).map((r) => r.click_ref));
  const p2refs = new Set((pages.slice(2000, 4000) as { click_ref?: string }[]).map((r) => r.click_ref));
  let overlap = 0;
  for (const ref of p2refs) if (p1refs.has(ref)) overlap += 1;
  console.log(`page1 vs page2 overlap refs: ${overlap}/${p2refs.size}`);

  console.log('\n=== sort 参数 ===');
  for (const sort of ['asc', 'desc', 'click_time', 'click_time_desc', 'click_time_asc', 'mid', 'merchant']) {
    const r = await clickQuery(token, { page: '1', limit: '2000', sort, order: 'desc' });
    const first = (r.list[0] as { click_ref?: string; click_time?: string; mid?: string }) ?? {};
    console.log(`sort=${sort}: list=${r.list.length} first=${first.click_ref} time=${first.click_time} mid=${first.mid}`);
  }

  console.log('\n=== mod=report 点击类 op ===');
  const ops = ['user_click', 'click_report', 'click_stat', 'cps_click', 'cps_click_report', 'stat', 'report'];
  for (const op of ops) {
    await new Promise((r) => setTimeout(r, 1500));
    const res = await axios.get(LB, {
      params: { mod: 'report', op, token, begin_date: '2026-06-02', end_date: '2026-06-02', type: 'json', page: '1', limit: '10' },
      timeout: 60000,
      validateStatus: () => true,
    });
    const s = JSON.stringify(res.data);
    console.log(`report/${op}: ${s.slice(0, 200)}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
