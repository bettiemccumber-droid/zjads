import * as XLSX from 'xlsx';

export interface MerchantQueryImportItem {
  merchantId?: string;
  mcid?: string;
  domain?: string;
}

/** MID 列名候选（优先精确匹配） */
const MID_HEADERS = ['mid', 'merchantid', 'merchant_id', '商家id'];
/** mcid 列名候选 */
const MCID_HEADERS = ['mcid', 'slug', 'brand', '商家slug'];
/** 网址 / 域名列名候选 */
const DOMAIN_HEADERS = ['website', 'url', 'siteurl', 'domain', '网址', '域名', 'site_url'];

const MAX_HEADER_SCAN_ROWS = 30;

/**
 * 从 Excel/CSV 解析商家查询项（兼容联盟推荐表：标题行 + 双语表头）
 */
export function parseMerchantStatusImport(file: ArrayBuffer): MerchantQueryImportItem[] {
  const wb = XLSX.read(file, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('文件中没有工作表');

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
  if (matrix.length === 0) throw new Error('文件中没有数据行');

  const detected = detectHeaderRow_(matrix);
  if (!detected) {
    throw new Error('未找到 MID / mcid / 网址 列，请检查表头（推荐表需含 mcid、MID 或 Website 列）');
  }

  const { dataStartRow, colMid, colMcid, colDomain } = detected;
  const items: MerchantQueryImportItem[] = [];
  const seen = new Set<string>();

  for (let r = dataStartRow; r < matrix.length; r += 1) {
    const row = matrix[r];
    if (!row || row.every((c) => !cleanCell_(c))) continue;

    const merchantId = colMid != null ? cleanMid_(row[colMid]) : '';
    const mcid = colMcid != null ? cleanMcid_(row[colMcid]) : '';
    const domainRaw = colDomain != null ? cleanCell_(row[colDomain]) : '';
    const domain = domainRaw ? normalizeDomain_(domainRaw) : '';

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

interface DetectedHeader {
  headerRowIndex: number;
  dataStartRow: number;
  colMid?: number;
  colMcid?: number;
  colDomain?: number;
}

/**
 * 扫描前若干行，定位推荐表真实表头（支持单行或相邻双行双语表头）
 */
function detectHeaderRow_(matrix: unknown[][]): DetectedHeader | null {
  let best: (DetectedHeader & { score: number }) | null = null;

  for (let r = 0; r < Math.min(matrix.length - 1, MAX_HEADER_SCAN_ROWS); r += 1) {
    const single = matrix[r].map((c) => String(c ?? ''));
    const merged = mergeHeaderCells_(matrix[r], matrix[r + 1] ?? []);

    for (const [headers, headerRowIndex, dataStartRow] of [
      [single, r, r + 1] as const,
      [merged, r, r + 2] as const,
    ]) {
      const cols = mapColumns_(headers);
      const score = scoreColumns_(cols);
      if (score <= 0) continue;
      if (!best || score > best.score) {
        best = { headerRowIndex, dataStartRow, ...cols, score };
      }
    }
  }

  if (!best || best.score < 2) return null;
  const { score: _s, ...result } = best;
  return result;
}

/** 合并相邻两行表头（中文行 + 英文行） */
function mergeHeaderCells_(rowA: unknown[], rowB: unknown[]): string[] {
  const len = Math.max(rowA.length, rowB.length);
  const merged: string[] = [];
  for (let i = 0; i < len; i += 1) {
    const a = cleanCell_(rowA[i]);
    const b = cleanCell_(rowB[i]);
    if (a && b && a !== b) merged.push(`${a} ${b}`);
    else merged.push(a || b);
  }
  return merged;
}

function mapColumns_(headers: string[]): Pick<DetectedHeader, 'colMid' | 'colMcid' | 'colDomain'> {
  return {
    colMid: findColumnIndex_(headers, MID_HEADERS),
    colMcid: findColumnIndex_(headers, MCID_HEADERS),
    colDomain: findColumnIndex_(headers, DOMAIN_HEADERS),
  };
}

function scoreColumns_(cols: Pick<DetectedHeader, 'colMid' | 'colMcid' | 'colDomain'>): number {
  let score = 0;
  if (cols.colMid != null) score += 3;
  if (cols.colMcid != null) score += 3;
  if (cols.colDomain != null) score += 1;
  return score;
}

/**
 * 表头单元格拆成多个 token（兼容「网址 / Website」）
 */
function headerTokens_(raw: string): string[] {
  const tokens = new Set<string>();
  for (const part of raw.split(/[/／|]/)) {
    const t = part.trim().toLowerCase().replace(/\s+/g, '');
    if (t) tokens.add(t);
  }
  const whole = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (whole) tokens.add(whole);
  return [...tokens];
}

function findColumnIndex_(headers: string[], candidates: string[]): number | undefined {
  const normalizedCandidates = candidates.map((c) => c.toLowerCase().replace(/\s+/g, ''));

  for (let i = 0; i < headers.length; i += 1) {
    const tokens = headerTokens_(headers[i]);
    for (const token of tokens) {
      for (const c of normalizedCandidates) {
        if (token === c) return i;
        if (c.length >= 6 && (token.includes(c) || c.includes(token))) return i;
      }
    }
  }
  return undefined;
}

function cleanCell_(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s || s === '#REF!' || s === '#N/A' || s === '#VALUE!' || s === '-') return '';
  return s;
}

function cleanMid_(v: unknown): string {
  const s = cleanCell_(v);
  if (!s) return '';
  const digits = s.replace(/[^\d]/g, '');
  return /^\d+$/.test(digits) ? digits : '';
}

function cleanMcid_(v: unknown): string {
  const s = cleanCell_(v).toLowerCase();
  if (!s) return '';
  if (!/^[a-z0-9][a-z0-9_-]{0,80}$/i.test(s)) return '';
  return s;
}

function normalizeDomain_(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
    .split('/')[0]
    .split('?')[0];
}
