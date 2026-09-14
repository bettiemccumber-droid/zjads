/**
 * CollabGlow / Famesta API 冒烟：Transaction V3、Monetization、Click（1 小时片）
 * 用法: npx ts-node --transpile-only scripts/cg-fs-api-probe.ts [collabglow|famesta|both]
 */
import axios from 'axios';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

type PlatformCode = 'collabglow' | 'famesta';

const CONFIG: Record<
  PlatformCode,
  { source: string; base: string }
> = {
  collabglow: { source: 'collabglow', base: 'https://api.collabglow.com/api' },
  famesta: { source: 'famesta', base: 'https://api.famesta.com/api' },
};

/**
 * 解密渠道账号凭证
 */
function decryptCredentials(payload: string): { apiToken?: string } {
  const hex = process.env.CREDENTIALS_ENCRYPTION_KEY ?? '';
  if (!hex) {
    throw new Error('缺少 CREDENTIALS_ENCRYPTION_KEY');
  }
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

async function postJson(url: string, body: Record<string, unknown>) {
  const { data } = await axios.post(url, body, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 120000,
    validateStatus: () => true,
  });
  return data as Record<string, unknown>;
}

/**
 * 探测单平台三类 API
 */
async function probePlatform(code: PlatformCode, token: string, label: string) {
  const { source, base } = CONFIG[code];
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 7);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  console.log(`\n=== ${code} (${label}) ===`);

  const tx = await postJson(`${base}/transaction_v3`, {
    source,
    token,
    dataScope: 'user',
    beginDate: fmt(start),
    endDate: fmt(end),
    updateBeginDate: '',
    updateEndDate: '',
    curPage: 1,
    perPage: 5,
  });
  const txData = tx.data as Record<string, unknown> | undefined;
  console.log('transaction_v3:', tx.code, tx.message, {
    total: txData?.total,
    listLen: Array.isArray(txData?.list) ? (txData?.list as unknown[]).length : 0,
  });

  const mon = await postJson(`${base}/monetization`, {
    source,
    token,
    approval_type: '',
    offer_type: '',
    relationship: '',
    categories: '',
    country: '',
    curPage: 1,
    perPage: 5,
  });
  const monData = mon.data as Record<string, unknown> | undefined;
  console.log('monetization:', mon.code, mon.message, {
    listLen: Array.isArray(monData?.list) ? (monData?.list as unknown[]).length : 0,
  });

  const day = fmt(end);
  const click = await postJson(`${base}/click_report`, {
    source,
    token,
    beginDate: `${day} 00:00:00`,
    endDate: `${day} 00:59:59`,
    curPage: 1,
    perPage: 5,
  });
  const clickData = click.data as Record<string, unknown> | undefined;
  console.log('click_report (1h):', click.code, click.message, {
    listLen: Array.isArray(clickData?.list) ? (clickData?.list as unknown[]).length : 0,
  });

  if (code === 'collabglow' && tx.code !== '0' && tx.code !== 0) {
    const alt = await postJson(`${base}/transaction_v3`, {
      source: 'collabglov',
      token,
      dataScope: 'user',
      beginDate: fmt(start),
      endDate: fmt(end),
      updateBeginDate: '',
      updateEndDate: '',
      curPage: 1,
      perPage: 5,
    });
    console.log('transaction_v3 (source=collabglov retry):', alt.code, alt.message);
  }
}

async function main() {
  const which = (process.argv[2] ?? 'both').toLowerCase();
  const codes: PlatformCode[] =
    which === 'collabglow' || which === 'cg'
      ? ['collabglow']
      : which === 'famesta' || which === 'fs'
        ? ['famesta']
        : ['collabglow', 'famesta'];

  const prisma = new PrismaClient();
  try {
    for (const code of codes) {
      const acct = await prisma.channelAccount.findFirst({
        where: { platform: { code }, isActive: true },
        include: { platform: true },
      });
      if (!acct?.credentialsEncrypted) {
        console.log(`${code}: 无活跃渠道账号，跳过（请先在后台配置 Token）`);
        continue;
      }
      const cred = decryptCredentials(acct.credentialsEncrypted);
      if (!cred.apiToken) {
        console.log(`${code}: 凭证无 apiToken`);
        continue;
      }
      await probePlatform(code, cred.apiToken, acct.displayName);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
