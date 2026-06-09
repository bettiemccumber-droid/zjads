/**
 * 探测 PM click_report 接口参数
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';

function loadEnv() {
  const envPath = path.join(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

function decrypt(cipherB64: string, hexKey: string) {
  const key = Buffer.from(hexKey, 'hex');
  const buf = Buffer.from(cipherB64, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  return JSON.parse(dec) as { apiToken?: string };
}

const URL = 'https://api.partnermatic.com/api/click_report';

async function main() {
  loadEnv();
  const prisma = new PrismaClient();
  const account = await prisma.channelAccount.findFirst({
    where: { platform: { code: 'partnermatic' }, isActive: true },
  });
  const { apiToken } = decrypt(account!.credentialsEnc, process.env.CREDENTIALS_ENCRYPTION_KEY!);

  const body = {
    source: 'partnermatic',
    token: apiToken,
    beginDate: '2026-05-26 00:00:00',
    endDate: '2026-05-26 00:59:59',
    curPage: 1,
    perPage: 500,
  };
  const res = await axios.post(URL, body, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 30000,
  });
  console.log('code', res.data?.code, 'msg', res.data?.message);
  const d = res.data?.data;
  if (d) {
    console.log('data keys', Object.keys(d));
    const list = d.list ?? d.data ?? [];
    console.log('list len', Array.isArray(list) ? list.length : 'n/a');
    if (Array.isArray(list) && list[0]) console.log('sample', JSON.stringify(list[0]));
  }
  await prisma.$disconnect();
}

main().catch((e) => console.error(e.response?.data ?? e.message));
