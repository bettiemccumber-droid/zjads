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

const PLATFORM_HEADERS = [
  'platform',
  'platformcode',
  'platform_code',
  '联盟',
  '平台',
  '联盟平台',
  'platformname',
];
const MID_HEADERS = [
  'mid',
  'merchantid',
  'merchant_id',
  '商家id',
  '商家mid',
  '商家编号',
];
const NAME_HEADERS = [
  'name',
  'merchant',
  'merchantname',
  'merchant_name',
  '商家名称',
  '商家名',
];
const COUNTRY_HEADERS = [
  'country',
  'countrycode',
  'country_code',
  '国家',
  '地区',
  '出单国家',
  'primaryregion',
  'region',
];
const URL_HEADERS = [
  'url',
  'website',
  'merchanturl',
  'merchant_url',
  '网址',
  '域名',
  '商家url',
  '商家网址',
  'siteurl',
];
const CATEGORY_HEADERS = ['category', 'categories', '品类', '类目', '主营业务'];
const NOTE_HEADERS = [
  'note',
  'reason',
  '备注',
  '原因',
  '说明',
  'violationtime',
  '违规时间',
  '违规原因',
];
const BU_HEADERS = ['bu', 'bucode', '业务线'];
const SID_HEADERS = ['sid', '商家sid', 'icid', 'lcid', 'mcid'];

/** 表格里常见平台写法归一成系统 platformCode */
const PLATFORM_ALIASES: Record<string, string> = {
  linkhaitao: 'linkhaitao',
  lh: 'linkhaitao',
  rewardoo: 'rewardoo',
  rewardme: 'rewardoo',
  rw: 'rewardoo',
  linkbux: 'linkbux',
  linkbuy: 'linkbux',
  lb: 'linkbux',
  partnermatic: 'partnermatic',
  pm: 'partnermatic',
  shoplooks: 'shoplooks',
  shoplookz: 'shoplooks',
  bsh: 'shoplooks',
  collabglow: 'collabglow',
  cg: 'collabglow',
  ultrainfluence: 'ultrainfluence',
  ui: 'ultrainfluence',
  famesta: 'famesta',
  fs: 'famesta',
  chuizhan_lh: 'linkhaitao',
  chuizhanlh: 'linkhaitao',
  chuizhan_rw: 'rewardoo',
  chuizhanrw: 'rewardoo',
  chuizhan_pm: 'partnermatic',
  chuizhanpm: 'partnermatic',
  chuizhan_bsh: 'shoplooks',
  chuizhanbsh: 'shoplooks',
  chuizhan_cg: 'collabglow',
  chuizhancg: 'collabglow',
  chuizhan_ui: 'ultrainfluence',
  chuizhanui: 'ultrainfluence',
  chuizhan_fs: 'famesta',
  chuizhanfs: 'famesta',
};

/**
 * 从 Excel/CSV 解析违规或推荐商家名单。
 * 支持多 sheet；兼容「平台+商家ID」表，以及「Merchant ID + BU」表。
 */
export function parseMerchantOpsListImport(file: ArrayBuffer): MerchantOpsListImportRow[] {
  const wb = XLSX.read(file, { type: 'array' });
  if (!wb.SheetNames.length) throw new Error('文件中没有工作表');

  const rows: MerchantOpsListImportRow[] = [];
  const seen = new Set<string>();
  const sheetErrors: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
    if (matrix.length === 0) continue;

    try {
      const parsed = parseSheet_(matrix, sheetName);
      for (const row of parsed) {
        const key = `${row.platformCode}:${row.mid}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(row);
      }
    } catch (error: unknown) {
      sheetErrors.push(`${sheetName}：${error instanceof Error ? error.message : '解析失败'}`);
    }
  }

  if (rows.length === 0) {
    throw new Error(
      sheetErrors[0]
        || '未解析到有效商家行。请包含「平台」+「商家ID/MID」，或「Merchant ID」+「BU」列；多 sheet 会全部读取。',
    );
  }
  return rows;
}

function parseSheet_(matrix: unknown[][], sheetName: string): MerchantOpsListImportRow[] {
  const headerIndex = findHeaderRow_(matrix);
  if (headerIndex < 0) {
    throw new Error('未找到表头（需要商家ID/MID，以及平台或 BU）');
  }

  const header = matrix[headerIndex].map((cell) => normalizeHeader_(cell));
  const colMid = findCol_(header, MID_HEADERS);
  const colPlatform = findCol_(header, PLATFORM_HEADERS);
  const colBu = findCol_(header, BU_HEADERS);
  if (colMid == null) throw new Error('缺少商家ID / MID / Merchant ID 列');
  if (colPlatform == null && colBu == null) {
    throw new Error('缺少平台列，或 BU 列（如 chuizhan_cg）');
  }

  const colName = findCol_(header, NAME_HEADERS);
  const colCountry = findCol_(header, COUNTRY_HEADERS);
  const colUrl = findCol_(header, URL_HEADERS);
  const colCategory = findCol_(header, CATEGORY_HEADERS);
  const colNote = findCol_(header, NOTE_HEADERS);
  const colSid = findCol_(header, SID_HEADERS);

  const rows: MerchantOpsListImportRow[] = [];
  for (let r = headerIndex + 1; r < matrix.length; r += 1) {
    const line = matrix[r];
    if (!line || line.every((cell) => !String(cell ?? '').trim())) continue;

    const mid = cleanMid_(line[colMid]);
    if (!mid) continue;

    const platformRaw =
      colPlatform != null
        ? String(line[colPlatform] ?? '').trim()
        : colBu != null
          ? String(line[colBu] ?? '').trim()
          : '';
    const platformCode = normalizePlatform_(platformRaw);
    if (!platformCode) continue;

    const name = colName != null ? String(line[colName] ?? '').trim() : '';
    const countryCode = colCountry != null ? extractCountry_(String(line[colCountry] ?? '')) : '';
    const merchantUrl = colUrl != null ? String(line[colUrl] ?? '').trim() : '';
    const category = colCategory != null ? String(line[colCategory] ?? '').trim() : '';
    const noteParts = [
      colNote != null ? String(line[colNote] ?? '').trim() : '',
      colSid != null ? String(line[colSid] ?? '').trim() : '',
      sheetName && wbSheetHint_(sheetName) ? `sheet:${sheetName}` : '',
    ].filter(Boolean);

    rows.push({
      platformCode,
      mid,
      name: name || undefined,
      countryCode: countryCode || undefined,
      merchantUrl: merchantUrl || undefined,
      category: category || undefined,
      note: noteParts.length ? noteParts.join(' · ') : undefined,
    });
  }

  if (rows.length === 0) throw new Error('没有有效数据行');
  return rows;
}

function wbSheetHint_(sheetName: string) {
  return /[a-zA-Z\u4e00-\u9fff]/.test(sheetName);
}

function cleanMid_(value: unknown) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  // Excel 有时把 ID 读成科学计数或带小数
  if (/^\d+\.0+$/.test(text)) return text.replace(/\.0+$/, '');
  return text;
}

function normalizePlatform_(raw: string) {
  const key = raw.trim().toLowerCase().replace(/[\s_\-]/g, '');
  if (!key) return '';
  if (PLATFORM_ALIASES[key]) return PLATFORM_ALIASES[key];
  const withUnderscore = raw.trim().toLowerCase().replace(/\s+/g, '_');
  if (PLATFORM_ALIASES[withUnderscore]) return PLATFORM_ALIASES[withUnderscore];
  // chuizhan_cg 这类
  const bu = raw.trim().toLowerCase();
  if (PLATFORM_ALIASES[bu]) return PLATFORM_ALIASES[bu];
  return bu.slice(0, 50);
}

/**
 * 瑞士(CH) / US -> CH / US
 */
function extractCountry_(raw: string) {
  const text = raw.trim();
  if (!text) return '';
  const matched = text.match(/\(([A-Za-z]{2})\)\s*$/);
  if (matched) return matched[1].toUpperCase();
  if (/^[A-Za-z]{2}$/.test(text)) return text.toUpperCase();
  return text.slice(0, 32);
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
  const limit = Math.min(matrix.length, 40);
  let best: { index: number; score: number } | null = null;
  for (let r = 0; r < limit; r += 1) {
    const header = matrix[r].map((cell) => normalizeHeader_(cell));
    const hasMid = findCol_(header, MID_HEADERS) != null;
    if (!hasMid) continue;
    const hasPlatform = findCol_(header, PLATFORM_HEADERS) != null;
    const hasBu = findCol_(header, BU_HEADERS) != null;
    if (!hasPlatform && !hasBu) continue;
    const score =
      (hasMid ? 4 : 0)
      + (hasPlatform ? 3 : 0)
      + (hasBu ? 2 : 0)
      + (findCol_(header, NAME_HEADERS) != null ? 1 : 0)
      + (findCol_(header, URL_HEADERS) != null ? 1 : 0);
    if (!best || score > best.score) best = { index: r, score };
  }
  return best?.index ?? -1;
}
