/**
 * 对比 Divani(388783) 每日：API 样本计数 vs 放大后 vs LB 后台基准
 */
import axios from 'axios';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import {
  allocateLbDayClickCounts,
  fetchLinkBuxClicks,
  resolveLbClickMerchantId,
  type LbClickRow,
} from '../src/collectors/linkbux-clicks';
import { fetchLbClickDayFirstPage } from '../src/collectors/linkbux-api.util';
import type { PmMerchantClickAgg } from '../src/collectors/partnermatic-clicks';

dotenv.config();
const prisma = new PrismaClient();

const LB_TRUTH: Record<string, number> = {
  '2026-06-01': 1071,
  '2026-06-02': 3124,
  '2026-06-03': 2801,
  '2026-06-04': 661,
  '2026-06-05': 2638,
  '2026-06-06': 3175,
  '2026-06-07': 2287,
};

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

async function probeReportOps(token: string, day: string) {
  const ops = [
    'cps_cpa_report',
    'cps_report',
    'cpa_report',
    'performance_report',
    'click_stat',
    'user_click_stat',
    'stat_click',
    'report_cps',
    'merchant_performance',
  ];
  for (const op of ops) {
    try {
      const res = await axios.get('https://www.linkbux.com/api.php', {
        params: {
          mod: 'medium',
          op,
          token,
          begin_date: day,
          end_date: day,
          type: 'json',
          mid: '388783',
          mcid: 'divanideaaa',
        },
        timeout: 30000,
        validateStatus: () => true,
      });
      const text = JSON.stringify(res.data);
      if (/click/i.test(text) && !/order_id/i.test(text)) {
        console.log(`\n★ ${op} has click field:`, text.slice(0, 400));
      }
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  const lb = await prisma.channelAccount.findFirst({
    where: { affiliateAlias: 'lb2' },
    select: { credentialsEnc: true },
  });
  const { apiToken } = decryptCredentials(lb!.credentialsEnc!);
  const token = apiToken!;
  const slugToMid = new Map<string, string>();

  console.log('day | sample | scaled | LB | diff');
  for (const day of Object.keys(LB_TRUTH)) {
    const { rows, totalItems } = await fetchLbClickDayFirstPage<LbClickRow>(token, day, 'probe');
    let sampleNoDedupe = 0;
    for (const row of rows) {
      const mid = resolveLbClickMerchantId(row, slugToMid);
      if (mid === '388783') sampleNoDedupe += 1;
    }

    const seen = new Set<string>();
    let sample = 0;
    for (const row of rows) {
      const ref = String(row.click_ref ?? '').trim();
      if (ref) {
        if (seen.has(ref)) continue;
        seen.add(ref);
      }
      const mid = resolveLbClickMerchantId(row, slugToMid);
      if (mid === '388783') sample += 1;
    }

    const aggs: PmMerchantClickAgg[] = [{ merchantId: '388783', merchantName: 'D', clickDate: day, clicks: sample }];
    for (const row of rows) {
      const ref = String(row.click_ref ?? '').trim();
      if (ref && seen.has(ref)) {
        /* counted */
      }
    }
    /** rebuild full day aggs for allocate */
    const dayMap = new Map<string, number>();
    seen.clear();
    for (const row of rows) {
      const ref = String(row.click_ref ?? '').trim();
      if (ref) {
        if (seen.has(ref)) continue;
        seen.add(ref);
      }
      const mid = resolveLbClickMerchantId(row, slugToMid);
      if (!mid) continue;
      dayMap.set(mid, (dayMap.get(mid) ?? 0) + 1);
    }
    const dayAggs: PmMerchantClickAgg[] = [...dayMap.entries()].map(([merchantId, clicks]) => ({
      merchantId,
      merchantName: '',
      clickDate: day,
      clicks,
    }));
    allocateLbDayClickCounts(dayAggs, totalItems, day);
    const scaled = dayAggs.find((r) => r.merchantId === '388783')?.clicks ?? 0;
    const truth = LB_TRUTH[day];
    console.log(
      `${day} | sample=${sample} raw=${sampleNoDedupe} | scaled=${scaled} | LB=${truth} | ${scaled - truth}`,
    );
    await new Promise((r) => setTimeout(r, 2600));
  }

  console.log('\n--- probe report ops (06-01) ---');
  await probeReportOps(token, '2026-06-01');

  const week = await fetchLinkBuxClicks(token, '2026-06-01', '2026-06-07');
  const divaniWeek = week.aggs
    .filter((a) => a.merchantId === '388783')
    .reduce((s, r) => s + r.clicks, 0);
  console.log(`\nweek divani=${divaniWeek} LB=15757 accountTotal=${week.accountClickTotal}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
