import * as XLSX from 'xlsx';

export interface MerchantOpsListImportRow {
  platformCode: string;
  mid: string;
  name?: string;
  countryCode?: string;
  merchantUrl?: string;
  category?: string;
  note?: string;
}

const PLATFORM_HEADERS = ['platform', 'platformcode', 'platform_code', '联盟', '平台', '联盟平台'];
const MID_HEADERS = ['mid', 'merchantid', 'merchant_id', '商家id', '商家mid'];
const NAME_HEADERS = ['name', 'merchantname', 'merchant_name', '商家名称', '商家名'];
const COUNTRY_HEADERS = ['country', 'countrycode', 'country_code', '国家', '地区', '出单国家'];
const URL_HEADERS = ['url', 'website', 'merchanturl', 'merchant_url', '网址', '域名'];
const CATEGORY_HEADERS = ['category', 'categories', '品类', '类目', '主营业务'];
const NOTE_HEADERS = ['note', 'reason', '备注', '原因', '说明'];

/**
 * 从 Excel/CSV 解析违规或推荐商家名单。至少要有平台 + MID。
 */
export function parseMerchantOpsListImport(file: ArrayBuffer): MerchantOpsListImportRow[] {
  const wb = XLSX.read(file, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('文件中没有工作表');

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
  if (matrix.length === 0) throw new Error('文件中没有数据行');

  const headerIndex = findHeaderRow_(matrix);
  if (headerIndex < 0) throw new Error('未找到表头，请包含「平台/联盟」和「MID」列');

  const header = matrix[headerIndex].map((cell) => normalizeHeader_(cell));
  const colPlatform = findCol_(header, PLATFORM_HEADERS);
  const colMid = findCol_(header, MID_HEADERS);
  if (colPlatform == null || colMid == null) {
    throw new Error('表头需同时包含平台（联盟）和 MID');
  }
  const colName = findCol_(header, NAME_HEADERS);
  const colCountry = findCol_(header, COUNTRY_HEADERS);
  const colUrl = findCol_(header, URL_HEADERS);
  const colCategory = findCol_(header, CATEGORY_HEADERS);
  const colNote = findCol_(header, NOTE_HEADERS);

  const rows: MerchantOpsListImportRow[] = [];
  const seen = new Set<string>();
  for (let r = headerIndex + 1; r < matrix.length; r += 1) {
    const line = matrix[r];
    if (!line || line.every((cell) => !String(cell ?? '').trim())) continue;
    const platformCode = String(line[colPlatform] ?? '').trim();
    const mid = String(line[colMid] ?? '').trim();
    if (!platformCode || !mid) continue;
    const key = `${platformCode.toLowerCase()}:${mid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      platformCode,
      mid,
      name: colName != null ? String(line[colName] ?? '').trim() : undefined,
      countryCode: colCountry != null ? String(line[colCountry] ?? '').trim() : undefined,
      merchantUrl: colUrl != null ? String(line[colUrl] ?? '').trim() : undefined,
      category: colCategory != null ? String(line[colCategory] ?? '').trim() : undefined,
      note: colNote != null ? String(line[colNote] ?? '').trim() : undefined,
    });
  }
  if (rows.length === 0) throw new Error('未解析到有效商家行');
  return rows;
}

function normalizeHeader_(cell: unknown) {
  return String(cell ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-（）()]/g, '');
}

function findCol_(header: string[], candidates: string[]) {
  const normalized = candidates.map((item) => item.toLowerCase().replace(/[\s_\-（）()]/g, ''));
  for (let i = 0; i < header.length; i += 1) {
    if (normalized.includes(header[i])) return i;
  }
  return null;
}

function findHeaderRow_(matrix: unknown[][]) {
  const limit = Math.min(matrix.length, 30);
  for (let r = 0; r < limit; r += 1) {
    const header = matrix[r].map((cell) => normalizeHeader_(cell));
    if (findCol_(header, PLATFORM_HEADERS) != null && findCol_(header, MID_HEADERS) != null) {
      return r;
    }
  }
  return -1;
}
