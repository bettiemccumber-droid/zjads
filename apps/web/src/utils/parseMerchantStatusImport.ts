import * as XLSX from 'xlsx';

export interface MerchantQueryImportItem {
  merchantId?: string;
  mcid?: string;
  domain?: string;
}

const MID_HEADERS = ['mid', 'merchantid', 'merchant_id', '商家id', '商家ID'];
const MCID_HEADERS = ['mcid', 'slug', 'brand', '商家slug'];
const DOMAIN_HEADERS = ['domain', 'url', 'website', '网址', '域名', 'site_url'];

/**
 * 从 Excel/CSV 解析商家查询项
 */
export function parseMerchantStatusImport(file: ArrayBuffer): MerchantQueryImportItem[] {
  const wb = XLSX.read(file, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('文件中没有工作表');

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  if (rows.length === 0) throw new Error('文件中没有数据行');

  const headers = Object.keys(rows[0] ?? {}).map(normalizeHeader_);
  const headerMap = new Map<string, string>();
  for (const h of Object.keys(rows[0] ?? {})) {
    headerMap.set(normalizeHeader_(h), h);
  }

  const midCol = findColumn_(headers, MID_HEADERS);
  const mcidCol = findColumn_(headers, MCID_HEADERS);
  const domainCol = findColumn_(headers, DOMAIN_HEADERS);

  if (!midCol && !mcidCol && !domainCol) {
    throw new Error('未找到 MID / mcid / 网址 列，请检查表头');
  }

  const items: MerchantQueryImportItem[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const merchantId = midCol ? String(row[headerMap.get(midCol)!] ?? '').trim() : '';
    const mcid = mcidCol ? String(row[headerMap.get(mcidCol)!] ?? '').trim().toLowerCase() : '';
    const domain = domainCol ? String(row[headerMap.get(domainCol)!] ?? '').trim().toLowerCase() : '';
    if (!merchantId && !mcid && !domain) continue;

    const key = merchantId || `mcid:${mcid}` || `domain:${domain}`;
    if (seen.has(key)) continue;
    seen.add(key);

    items.push({
      merchantId: merchantId || undefined,
      mcid: mcid || undefined,
      domain: domain || undefined,
    });
  }

  if (items.length === 0) throw new Error('未解析到有效商家行');
  return items;
}

function normalizeHeader_(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, '');
}

function findColumn_(headers: string[], candidates: string[]): string | null {
  for (const c of candidates) {
    const n = normalizeHeader_(c);
    const hit = headers.find((h) => h === n || h.includes(n));
    if (hit) return hit;
  }
  return null;
}
