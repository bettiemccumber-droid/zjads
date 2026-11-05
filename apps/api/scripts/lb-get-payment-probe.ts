/**
 * 核对 LinkBux get_payment 与结算汇总（不写库）
 * 用法: npx ts-node --transpile-only scripts/lb-get-payment-probe.ts [YYYY-MM] [accountId|alias]
 */
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import {
  aggregateLinkbuxPaymentsForSettlement,
  fetchLinkbuxPayments,
  type LinkbuxPaymentRow,
} from '../src/collectors/linkbux-payments.util';
import { LB_API2 } from '../src/collectors/linkbux-api.util';
import { monthToDateRange } from '../src/reports/settlement-monthly.util';

dotenv.config();
const prisma = new PrismaClient();

function decrypt(enc: string): { apiToken?: string } {
  const key = Buffer.from(process.env.CREDENTIALS_ENCRYPTION_KEY ?? '', 'hex');
  const buf = Buffer.from(enc, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString()) as {
    apiToken?: string;
  };
}

function summarizeBody(body: unknown): Record<string, unknown> {
  const root = body as Record<string, unknown>;
  const data = root.data;
  const out: Record<string, unknown> = {
    topKeys: Object.keys(root).slice(0, 20),
    code: root.code ?? (root.status as { code?: unknown })?.code,
    msg: root.msg ?? (root.status as { msg?: unknown })?.msg,
  };
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    out.dataKeys = Object.keys(d).slice(0, 30);
    for (const k of ['list', 'payments', 'payment_list', 'payment_history'] as const) {
      if (Array.isArray(d[k])) out[`data.${k}.length`] = d[k].length;
    }
    out.payment_in_progress = d.payment_in_progress ?? d.paymentInProgress;
  }
  if (Array.isArray(data)) out.dataArrayLen = data.length;
  return out;
}

async function rawGetPayment(token: string) {
  const { data } = await axios.get(LB_API2, {
    params: { mod: 'payment', op: 'get_payment', token, type: 'json' },
    timeout: 120000,
    validateStatus: () => true,
  });
  return data;
}

function previewRows(rows: LinkbuxPaymentRow[]) {
  return rows.slice(0, 5).map((r) => ({
    payment_id: r.payment_id,
    date: r.date,
    amount: r.amount ?? r.payment_amount,
    status: r.status,
  }));
}

async function main() {
  const month = process.argv[2]?.trim() || '2026-11';
  const pick = process.argv[3]?.trim();
  const { startDate, endDate } = monthToDateRange(month);

  const envToken = process.env.LB_PROBE_TOKEN?.trim();
  if (envToken) {
    console.log('使用 LB_PROBE_TOKEN');
    const raw = await rawGetPayment(envToken);
    console.log(JSON.stringify(summarizeBody(raw), null, 2));
    const rows = await fetchLinkbuxPayments(envToken, startDate, endDate);
    console.log('rows', rows.length, previewRows(rows));
    console.log('agg', aggregateLinkbuxPaymentsForSettlement(rows, month));
    return;
  }

  const accounts = await prisma.channelAccount.findMany({
    where: { isActive: true, platform: { code: 'linkbux' } },
    include: { platform: true },
    orderBy: { id: 'asc' },
  });
  if (!accounts.length) {
    console.log('无 LinkBux 渠道账号');
    return;
  }

  let account = accounts[0];
  if (pick) {
    const byId = accounts.find((a) => String(a.id) === pick);
    const byAlias = accounts.find(
      (a) => a.affiliateAlias?.toLowerCase() === pick.toLowerCase(),
    );
    account = byId ?? byAlias ?? account;
  }

  const cred = decrypt(account.credentialsEnc);
  const token = cred.apiToken?.trim();
  if (!token) {
    console.log('Token 为空', account.displayName);
    return;
  }

  console.log('账号:', account.id, account.displayName, account.affiliateAlias);
  console.log('月份:', month, startDate, '~', endDate);

  const raw = await rawGetPayment(token);
  console.log('\n--- api2 get_payment 原始结构 ---');
  console.log(JSON.stringify(summarizeBody(raw), null, 2));

  const rows = await fetchLinkbuxPayments(token, startDate, endDate);
  console.log('\n--- fetchLinkbuxPayments 解析行数 ---', rows.length);
  console.log(JSON.stringify(previewRows(rows), null, 2));

  const agg = aggregateLinkbuxPaymentsForSettlement(rows, month);
  console.log('\n--- 2026-11 汇总 (应收/实收 上下半月) ---');
  console.log(JSON.stringify(agg, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
