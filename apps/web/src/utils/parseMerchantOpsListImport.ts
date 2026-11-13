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
  'bumerchantid',
  'bumid',
  '商家id',
  '商家mid',
  '商家编号',
];
const NAME_HEADERS = [
  'name',
  'merchant',
  'merchantname',
  'merchant_name',
  'bumerchant',
  'advertiser',
  'advertisername',
  '商家名称',
  '商家名',
  '广告主名称',
  '广告主',
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
  '商家地区',
  'merchantbase',
  'base',
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
const SID_HEADERS = ['sid', '商家sid', '商家cid', 'icid', 'lcid', 'mcid'];

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

/** 从文件名 / 标题 / sheet 名推断平台（如「PM推荐商家表」） */
const PLATFORM_HINTS: Array<{ re: RegExp; code: string }> = [
  { re: /linkhaitao|chuizhan[_\s-]?lh|\blh推荐|\blh\b/i, code: 'linkhaitao' },
  { re: /rewardoo|rewardme|chuizhan[_\s-]?rw|\brw推荐|\brw\b/i, code: 'rewardoo' },
  { re: /partnermatic|chuizhan[_\s-]?pm|pm推荐|\bpm\b/i, code: 'partnermatic' },
  { re: /linkbux|linkbuy|chuizhan[_\s-]?lb|\blb推荐|\blb\b/i, code: 'linkbux' },
  { re: /shoplooks|shoplookz|chuizhan[_\s-]?bsh|\bbsh\b/i, code: 'shoplooks' },
  { re: /collabglow|chuizhan[_\s-]?cg|\bcg推荐|\bcg\b/i, code: 'collabglow' },
  { re: /ultrainfluence|chuizhan[_\s-]?ui|\bui推荐|\bui\b/i, code: 'ultrainfluence' },
  { re: /famesta|chuizhan[_\s-]?fs|\bfs推荐|\bfs\b/i, code: 'famesta' },
];

/**
 * 从 Excel/CSV 解析违规或推荐商家名单。
 * 支持多 sheet；兼容平台列 / BU 列，以及标题里带 PM/LH 等平台暗示、仅有 MID 的推荐表。
 */
export function parseMerchantOpsListImport(
  file: ArrayBuffer,
  fileName?: string,
): MerchantOpsListImportRow[] {
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
      const parsed = parseSheet_(matrix, sheetName, fileName);
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
        || '未解析到有效商家行。请包含 MID，以及平台/BU 列；或文件名/标题标明平台（如 PM推荐商家表）。',
    );
  }
  return rows;
}

function parseSheet_(
  matrix: unknown[][],
  sheetName: string,
  fileName?: string,
): MerchantOpsListImportRow[] {
  const fallbackPlatform = inferPlatformFromContext_(matrix, sheetName, fileName);
  const headerIndex = findHeaderRow_(matrix);
  if (headerIndex < 0) {
    throw new Error('未找到表头（需要 MID / 商家ID）');
  }

  const header = matrix[headerIndex].map((cell) => normalizeHeader_(cell));
  const colMid = findMidCol_(header);
  const colPlatform = findCol_(header, PLATFORM_HEADERS);
  const colBu = findCol_(header, BU_HEADERS);
  if (colMid == null) throw new Error('缺少商家ID / MID / Merchant ID 列');
  if (colPlatform == null && colBu == null && !fallbackPlatform) {
    throw new Error('缺少平台列或 BU 列；也可在文件名/标题写平台（如 PM推荐商家表）');
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
          : fallbackPlatform;
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

function inferPlatformFromContext_(
  matrix: unknown[][],
  sheetName: string,
  fileName?: string,
): string {
  const chunks: string[] = [sheetName, fileName ?? ''];
  const limit = Math.min(matrix.length, 6);
  for (let r = 0; r < limit; r += 1) {
    for (const cell of matrix[r] ?? []) {
      const text = String(cell ?? '').trim();
      if (text) chunks.push(text);
    }
  }
  const blob = chunks.join(' ');
  for (const hint of PLATFORM_HINTS) {
    if (hint.re.test(blob)) return hint.code;
  }
  return '';
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
  const bu = raw.trim().toLowerCase();
  if (PLATFORM_ALIASES[bu]) return PLATFORM_ALIASES[bu];
  return bu.slice(0, 50);
}

/**
 * 瑞士(CH) / US / FR -> CH / US / FR
 */
function extractCountry_(raw: string) {
  const text = raw.trim();
  if (!text) return '';
  if (/^other$/i.test(text)) return '';
  const matched = text.match(/\(([A-Za-z]{2})\)\s*$/);
  if (matched) return matched[1].toUpperCase();
  if (/^[A-Za-z]{2}$/.test(text)) return text.toUpperCase();
  return text.slice(0, 32);
}

function normalizeHeader_(cell: unknown) {
  return String(cell ?? '')
    .trim()
    .toLowerCase()
    // 表里常见拼写：Mercahnt → Merchant
    .replace(/mercahnt/g, 'merchant')
    .replace(/[\s_\-／/|（）()]/g, '');
}

function findCol_(header: string[], candidates: string[]) {
  const normalized = candidates.map((item) =>
    item.toLowerCase().replace(/mercahnt/g, 'merchant').replace(/[\s_\-／/|（）()]/g, ''),
  );
  // 先精确匹配，避免「平均佣金…」等长表头误伤
  for (let i = 0; i < header.length; i += 1) {
    const cell = header[i];
    if (cell && normalized.includes(cell)) return i;
  }
  for (let i = 0; i < header.length; i += 1) {
    const cell = header[i];
    if (!cell) continue;
    // 「BU Merchant ID」→ bumerchantid 仍应命中 merchantid；跳过过短后缀
    if (normalized.some((item) => item.length >= 4 && cell.endsWith(item))) return i;
  }
  return null;
}

/**
 * MID 列：兼容 mid / Merchant ID / BU Merchant ID / BU Mercahnt ID（拼写错误）等。
 */
function findMidCol_(header: string[]) {
  const exact = findCol_(header, MID_HEADERS);
  if (exact != null) return exact;
  for (let i = 0; i < header.length; i += 1) {
    const cell = header[i];
    if (!cell) continue;
    if (cell === 'mid') return i;
    // 含 id，且像 merchant / 商家
    if (cell.includes('id') && (cell.includes('merchant') || cell.includes('商家'))) return i;
  }
  return null;
}

function findHeaderRow_(matrix: unknown[][]) {
  const limit = Math.min(matrix.length, 40);
  let best: { index: number; score: number } | null = null;
  for (let r = 0; r < limit; r += 1) {
    const header = matrix[r].map((cell) => normalizeHeader_(cell));
    const hasMid = findMidCol_(header) != null;
    if (!hasMid) continue;
    const hasPlatform = findCol_(header, PLATFORM_HEADERS) != null;
    const hasBu = findCol_(header, BU_HEADERS) != null;
    // 允许仅有 MID（平台由文件名/标题推断，如 PM 推荐表）
    const score =
      (hasMid ? 4 : 0)
      + (hasPlatform ? 3 : 0)
      + (hasBu ? 2 : 0)
      + (findCol_(header, NAME_HEADERS) != null ? 1 : 0)
      + (findCol_(header, URL_HEADERS) != null ? 1 : 0)
      + (findCol_(header, SID_HEADERS) != null ? 1 : 0);
    if (!best || score > best.score) best = { index: r, score };
  }
  return best?.index ?? -1;
}
