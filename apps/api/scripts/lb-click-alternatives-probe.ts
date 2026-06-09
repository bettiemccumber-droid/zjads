/**
 * 探测 LinkBux 精确商家×日点击的替代方案
 */
import axios from 'axios';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { extractLbClickListAndPages, assertLbClickApiSuccess } from '../src/collectors/linkbux-api.util';
import { resolveLbClickMerchantId, type LbClickRow } from '../src/collectors/linkbux-clicks';

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

async function userClick(token: string, extra: Record<string, string>) {
  await new Promise((r) => setTimeout(r, 2600));
  const res = await axios.get(LB, {
    params: { mod: 'medium', op: 'user_click', token, type: 'json', page: '1', limit: '2000', ...extra },
    timeout: 120000,
    validateStatus: () => true,
  });
  try {
    assertLbClickApiSuccess(res.data, 'probe');
  } catch (e) {
    return { ok: false, err: String(e), totalItems: 0, listLen: 0, rows: [] as LbClickRow[] };
  }
  const parsed = extractLbClickListAndPages(res.data);
  return {
    ok: true,
    err: '',
    totalItems: parsed.totalItems,
    listLen: parsed.list.length,
    rows: parsed.list as LbClickRow[],
  };
}

function countMerchant(rows: LbClickRow[], mid: string, slugToMid: Map<string, string>): number {
  const seen = new Set<string>();
  let n = 0;
  for (const row of rows) {
    const ref = String(row.click_ref ?? '').trim();
    if (ref) {
      if (seen.has(ref)) continue;
      seen.add(ref);
    }
    if (resolveLbClickMerchantId(row, slugToMid) === mid) n += 1;
  }
  return n;
}

async function main() {
  const lb = await prisma.channelAccount.findFirst({
    where: { affiliateAlias: 'lb2' },
    select: { credentialsEnc: true },
  });
  const token = decrypt(lb!.credentialsEnc!).apiToken!;
  const slugToMid = new Map<string, string>();
  const DIVANI = '388783';

  console.log('=== A. mid/mcid 筛选是否影响 total_items（06-02）===');
  const bases: { label: string; params: Record<string, string> }[] = [
    { label: '无筛选', params: { begin_date: '2026-06-02', end_date: '2026-06-02' } },
    { label: 'mid=388783', params: { begin_date: '2026-06-02', end_date: '2026-06-02', mid: '388783' } },
    { label: 'mcid=divanideaaa', params: { begin_date: '2026-06-02', end_date: '2026-06-02', mcid: 'divanideaaa' } },
    { label: 'merchant_id=388783', params: { begin_date: '2026-06-02', end_date: '2026-06-02', merchant_id: '388783' } },
  ];
  for (const b of bases) {
    const r = await userClick(token, b.params);
    const div = r.ok ? countMerchant(r.rows, DIVANI, slugToMid) : 0;
    console.log(`${b.label}: total_items=${r.totalItems} list=${r.listLen} divaniInList=${div} err=${r.err.slice(0, 80)}`);
  }

  console.log('\n=== B. 按小时切分（06-02，Divani 后台 3124）===');
  let hourDivani = 0;
  let hourTotal = 0;
  for (let h = 0; h < 24; h += 1) {
    const begin = `2026-06-02 ${String(h).padStart(2, '0')}:00:00`;
    const end = `2026-06-02 ${String(h).padStart(2, '0')}:59:59`;
    const r = await userClick(token, { begin_date: begin, end_date: end });
    if (!r.ok) {
      console.log(`hour ${h}: FAIL ${r.err.slice(0, 100)}`);
      continue;
    }
    const div = countMerchant(r.rows, DIVANI, slugToMid);
    hourDivani += div;
    hourTotal += r.totalItems;
    if (r.totalItems > 0) {
      console.log(`hour ${h}: total_items=${r.totalItems} list=${r.listLen} divani=${div} capped=${r.totalItems > r.listLen}`);
    }
  }
  console.log(`hour sum total_items=${hourTotal} divani=${hourDivani} (LB divani=3124)`);

  console.log('\n=== C. 日期+时间格式变体（06-02 全天）===');
  const formats = [
    { begin_date: '2026-06-02 00:00:00', end_date: '2026-06-02 23:59:59' },
    { begin_date: '2026-06-02T00:00:00', end_date: '2026-06-02T23:59:59' },
    { begin_date: '2026-06-02 00:00', end_date: '2026-06-02 23:59' },
  ];
  for (const f of formats) {
    const r = await userClick(token, f);
    console.log(`${f.begin_date}: total_items=${r.totalItems} ok=${r.ok} err=${r.err.slice(0, 60)}`);
  }

  console.log('\n=== D. performance + offer_type 变体 ===');
  const perfOps = [
    { op: 'performance', offer_type: 'CPS' },
    { op: 'performance', offer_type: 'CPC' },
    { op: 'cps_cpa_performance' },
    { op: 'cps_performance' },
    { op: 'merchant_performance' },
    { op: 'report_performance', report_type: 'click' },
  ];
  for (const p of perfOps) {
    await new Promise((r) => setTimeout(r, 1500));
    const { op, ...rest } = p;
    const res = await axios.get(LB, {
      params: {
        mod: 'medium',
        op,
        token,
        begin_date: '2026-06-01',
        end_date: '2026-06-07',
        begin_click_date: '2026-06-01',
        end_click_date: '2026-06-07',
        type: 'json',
        page: '1',
        limit: '10',
        ...rest,
      },
      timeout: 60000,
      validateStatus: () => true,
    });
    const s = JSON.stringify(res.data);
    const hasClick = /"clicks?"|total_click/i.test(s) && !/order_id/i.test(s);
    const code = (res.data as { status?: { code?: number } | number })?.status;
    const statusCode = typeof code === 'object' ? code?.code : code;
    console.log(`${op} ${JSON.stringify(rest)}: status=${String(statusCode)} clickLike=${hasClick} len=${s.length}`);
    if (hasClick) console.log(s.slice(0, 500));
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
