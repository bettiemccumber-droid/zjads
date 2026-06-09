/**
 * 探测 LinkBux 各点击/报表 API（CPC ClickData、CPC Performance 等）
 */
import axios from 'axios';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();
const LB_API = 'https://www.linkbux.com/api.php';
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

function hasClickField(body: unknown): boolean {
  const s = JSON.stringify(body).toLowerCase();
  return (
    (s.includes('"click"') || s.includes('total_click') || s.includes('"clicks"')) &&
    !s.includes('order_id')
  );
}

function summarize(body: unknown): string {
  const root = body as Record<string, unknown>;
  const status =
    root.status ??
    (typeof root.status === 'object' && root.status != null
      ? (root.status as { code?: number }).code
      : undefined) ??
    root.code;
  const payload = (root.payliad ?? root.payload ?? root.data ?? root) as Record<string, unknown>;
  const list = (payload.list ?? root.list) as unknown[] | undefined;
  const total = payload.total as Record<string, unknown> | undefined;
  const totalItems = total?.total_items ?? payload.total_items ?? root.total_items;
  const first = list?.[0];
  const keys = first && typeof first === 'object' ? Object.keys(first as object).join(',') : 'none';
  return `status=${String(status)} items=${String(totalItems ?? list?.length ?? 0)} keys=[${keys}]`;
}

async function tryOp(
  token: string,
  op: string,
  extra: Record<string, string> = {},
): Promise<{ op: string; ok: boolean; clickLike: boolean; detail: string; preview: string }> {
  const params = {
    mod: 'medium',
    op,
    token,
    begin_date: '2026-06-01',
    end_date: '2026-06-07',
    type: 'json',
    page: '1',
    limit: '5',
    ...extra,
  };
  try {
    const res = await axios.get(LB_API, { params, timeout: 60000, validateStatus: () => true });
    const body = res.data;
    const ok =
      body?.status === 200 ||
      body?.status === '200' ||
      body?.status?.code === 0 ||
      body?.code === 0 ||
      body?.payliad != null ||
      body?.data?.list != null;
    const clickLike = ok && hasClickField(body);
    return {
      op,
      ok: !!ok,
      clickLike,
      detail: summarize(body),
      preview: JSON.stringify(body).slice(0, 350),
    };
  } catch (e) {
    return { op, ok: false, clickLike: false, detail: String(e), preview: '' };
  }
}

async function main() {
  const lb = await prisma.channelAccount.findFirst({
    where: { affiliateAlias: 'lb2' },
    select: { credentialsEnc: true },
  });
  const { apiToken } = decryptCredentials(lb!.credentialsEnc!);
  const token = apiToken!;

  const ops = [
    'user_click',
    'cpc_clickdata',
    'cpc_click_data',
    'cpc_click',
    'cpc_performance',
    'cpc_perf',
    'cpc_report',
    'cpc_stat',
    'cpc_clicks',
    'click_cpc',
    'performance_cpc',
    'cps_cpa_performance',
    'cps_cpa_report',
    'cps_performance',
    'report_performance',
    'stat_performance',
    'click_performance',
    'click_report',
    'click_stat',
    'transaction_v2',
    'transaction_v3',
  ];

  console.log('=== LinkBux API 探测 (06-01~06-07) ===\n');

  for (const op of ops) {
    const r = await tryOp(token, op);
    const mark = r.clickLike ? '★ CLICK' : r.ok ? '· OK' : '✗';
    console.log(`${mark} ${op.padEnd(22)} ${r.detail}`);
    if (r.clickLike) {
      console.log(`    ${r.preview}\n`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  console.log('\n=== 带 dimension 参数重试 CPC 类 ===');
  const cpcOps = ['cpc_performance', 'cpc_clickdata', 'cpc_click_data', 'cps_cpa_performance'];
  const dims = [
    { primary: 'day', secondary: 'merchant' },
    { dimension: 'day', sub_dimension: 'merchant' },
    { group_by: 'merchant' },
    { report_type: 'cpc' },
  ];
  for (const op of cpcOps) {
    for (const dim of dims) {
      const r = await tryOp(token, op, dim as unknown as Record<string, string>);
      if (r.clickLike || (r.ok && r.detail.includes('click'))) {
        console.log(`★ ${op} ${JSON.stringify(dim)} ${r.detail}`);
        console.log(`  ${r.preview}\n`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
