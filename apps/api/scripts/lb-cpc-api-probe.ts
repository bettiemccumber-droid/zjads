/**
 * 细探 CPC Performance / CPC ClickData 官方 op 名
 */
import axios from 'axios';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();
const prisma = new PrismaClient();
const LB = 'https://www.linkbux.com/api.php';

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

async function call(label: string, params: Record<string, string>) {
  const res = await axios.get(LB, { params, timeout: 60000, validateStatus: () => true });
  const text = JSON.stringify(res.data);
  const hasClicksField = /"clicks"\s*:/.test(text) && !/"order_id"/.test(text.slice(0, 500));
  console.log(`\n--- ${label} ---`);
  console.log(`clicksField=${hasClicksField} len=${text.length}`);
  console.log(text.slice(0, 600));
}

async function main() {
  const lb = await prisma.channelAccount.findFirst({ where: { affiliateAlias: 'lb2' }, select: { credentialsEnc: true } });
  const { apiToken } = decrypt(lb!.credentialsEnc!);
  const day = '2026-06-01';
  const base = { token: apiToken!, type: 'json', begin_date: day, end_date: day, page: '1', limit: '10' };

  await call('user_click 单日', { mod: 'medium', op: 'user_click', ...base });

  const tries: Record<string, string>[] = [
    { mod: 'medium', op: 'cpc_performance' },
    { mod: 'medium', op: 'cpc_clickdata' },
    { mod: 'medium', op: 'cpc_click_data' },
    { mod: 'medium', op: 'cpc_click' },
    { mod: 'medium', op: 'cpc_perf' },
    { mod: 'report', op: 'cpc_performance' },
    { mod: 'report', op: 'cpc_clickdata' },
    { mod: 'medium', op: 'performance', report_type: 'cpc' },
    { mod: 'medium', op: 'performance', offer_type: 'CPC' },
    { mod: 'medium', op: 'cpc_performance', dimension: 'day', sub_dimension: 'merchant' },
    { mod: 'medium', op: 'cpc_performance', primary: 'day', secondary: 'merchant' },
    { mod: 'medium', op: 'cpc_clickdata', data_type: 'click' },
    { mod: 'medium', op: 'cpc_clickdata', type: 'click' },
    { mod: 'medium', op: 'click_data' },
    { mod: 'medium', op: 'clickdata' },
    { mod: 'medium', op: 'cpc_clickdata', mod_type: 'cpc' },
  ];

  for (const t of tries) {
    await call(JSON.stringify(t), { ...base, ...t });
    await new Promise((r) => setTimeout(r, 1500));
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
