/**
 * 探测 LinkBux user_click 的 uid/uid2 筛选是否有效
 */
import axios from 'axios';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { extractLbClickListAndPages, assertLbClickApiSuccess } from '../src/collectors/linkbux-api.util';

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

async function query(token: string, day: string, extra: Record<string, string> = {}) {
  await new Promise((r) => setTimeout(r, 2600));
  const res = await axios.get(LB, {
    params: {
      mod: 'medium',
      op: 'user_click',
      token,
      begin_date: day,
      end_date: day,
      type: 'json',
      page: '1',
      limit: '2000',
      ...extra,
    },
    timeout: 120000,
    validateStatus: () => true,
  });
  try {
    assertLbClickApiSuccess(res.data, 'uid-probe');
  } catch (e) {
    return { ok: false, err: String(e), totalItems: 0, listLen: 0, uids: [] as string[] };
  }
  const parsed = extractLbClickListAndPages(res.data);
  const rows = parsed.list as { uid?: string; uid2?: string; mid?: string; mcid?: string }[];
  const uids = [...new Set(rows.map((r) => String(r.uid ?? '').trim()).filter(Boolean))];
  return { ok: true, err: '', totalItems: parsed.totalItems, listLen: rows.length, uids };
}

async function main() {
  const lb = await prisma.channelAccount.findFirst({
    where: { affiliateAlias: 'lb2' },
    select: { credentialsEnc: true },
  });
  const token = decrypt(lb!.credentialsEnc!).apiToken!;
  const day = '2026-06-02';

  console.log('=== 样本 uid 分布（06-02 无筛选）===');
  const base = await query(token, day);
  console.log(`total_items=${base.totalItems} list=${base.listLen} unique_uids_in_list=${base.uids.length}`);
  console.log('sample uids:', base.uids.slice(0, 20).join(', ') || '(全部为空)');

  console.log('\n=== uid 筛选探测 ===');
  const filters: { label: string; extra: Record<string, string> }[] = [
    { label: '无筛选', extra: {} },
    { label: 'uid=388783', extra: { uid: '388783' } },
    { label: 'uid=m388783', extra: { uid: 'm388783' } },
    { label: 'uid=divanideaaa', extra: { uid: 'divanideaaa' } },
    { label: 'uid=空字符串', extra: { uid: '' } },
    { label: 'uid2=388783', extra: { uid2: '388783' } },
  ];
  if (base.uids[0]) {
    filters.push({ label: `uid=${base.uids[0]}`, extra: { uid: base.uids[0] } });
  }

  for (const f of filters) {
    const r = await query(token, day, f.extra);
    console.log(`${f.label}: total_items=${r.totalItems} list=${r.listLen} ${r.err ? 'ERR=' + r.err.slice(0, 60) : ''}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
