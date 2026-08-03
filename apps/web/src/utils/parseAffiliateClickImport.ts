import * as XLSX from 'xlsx';

/** 手动导入的单条 Performance 校准行 */
export interface ImportClickRow {
  merchantId: string;
  clickDate: string;
  clicks: number;
  merchantName?: string;
  /** RW Performance Orders（可选） */
  performanceOrders?: number;
}

const HEADER_ALIASES: Record<string, keyof ImportClickRow | 'skip'> = {
  merchantid: 'merchantId',
  mid: 'merchantId',
  merchant_id: 'merchantId',
  m_id: 'merchantId',
  clickdate: 'clickDate',
  date: 'clickDate',
  click_date: 'clickDate',
  day: 'clickDate',
  transaction_date: 'clickDate',
  clicks: 'clicks',
  click: 'clicks',
  total_clicks: 'clicks',
  merchantname: 'merchantName',
  merchant_name: 'merchantName',
  name: 'merchantName',
  advertiser_name: 'merchantName',
  sitename: 'merchantName',
  orders: 'performanceOrders',
  order: 'performanceOrders',
  order_count: 'performanceOrders',
  order_counts: 'performanceOrders',
  total_orders: 'performanceOrders',
};

/** LB 点击校准 CSV 模板（不含订单） */
export const AFFILIATE_CLICK_CSV_TEMPLATE = `merchantId,merchantName,clickDate,clicks
388783,Divani.Store DE,2026-06-01,1071
388783,Divani.Store DE,2026-06-02,3124`;

/** RW 按日导出（后台已筛商家，无 MID 列） */
export const RW_DAILY_ONLY_CSV_TEMPLATE = `Date,Clicks,Orders
2026-07-27,61,7
2026-07-28,71,11`;

/** 解析选项：RW 后台「先筛商家 + Group by Daily」导出时无 MID 列 */
export interface ParseAffiliateClickOptions {
  /** 导入弹窗填写的商家 MID（与广告系列 merchantId 一致） */
  defaultMerchantId?: string;
  defaultMerchantName?: string;
}

/**
 * 规范化表头键（LinkBux 导出：Merchant Name / MID / Date / Clicks）
 */
function normalizeHeader(header: string): keyof ImportClickRow | 'skip' | null {
  const key = header.trim().replace(/^"|"$/g, '').toLowerCase().replace(/\s+/g, '_');
  const mapped = HEADER_ALIASES[key];
  if (mapped) return mapped;
  return null;
}

/**
 * 解析点击数（支持 2,287、22706）
 */
function parseClickCount(raw: unknown): number {
  if (raw == null || raw === '') return 0;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  const s = String(raw).replace(/,/g, '').trim();
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/**
 * 解析日期为 YYYY-MM-DD
 */
function parseClickDate(raw: unknown): string {
  if (raw == null || raw === '') return '';
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  if (typeof raw === 'number' && raw > 40000) {
    const d = XLSX.SSF.parse_date_code(raw);
    if (d) {
      const m = String(d.m).padStart(2, '0');
      const day = String(d.d).padStart(2, '0');
      return `${d.y}-${m}-${day}`;
    }
  }
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const ymdSlash = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (ymdSlash) {
    const month = ymdSlash[2].padStart(2, '0');
    const day = ymdSlash[3].padStart(2, '0');
    return `${ymdSlash[1]}-${month}-${day}`;
  }
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const month = mdy[1].padStart(2, '0');
    const day = mdy[2].padStart(2, '0');
    return `${mdy[3]}-${month}-${day}`;
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return '';
}

/**
 * 跳过汇总行、无效行
 */
function shouldSkipRow(merchantId: string, merchantName: string, clickDate: string): boolean {
  if (!merchantId || !clickDate) return true;
  const name = merchantName.trim().toLowerCase();
  if (name === 'total' || merchantId.toLowerCase() === 'total') return true;
  return !/^\d+$/.test(merchantId);
}

function parseOrderCount(raw: unknown): number {
  return parseClickCount(raw);
}

/**
 * 从「表头 → 值」记录列表解析导入行
 */
function rowsFromHeaderRecords(
  records: Record<string, unknown>[],
  options?: ParseAffiliateClickOptions,
): ImportClickRow[] {
  if (!records.length) throw new Error('文件中没有数据');

  const defaultMid = String(options?.defaultMerchantId ?? '').trim();
  const defaultName = String(options?.defaultMerchantName ?? '').trim();

  const sampleKeys = Object.keys(records[0]);
  const fieldMap = new Map<keyof ImportClickRow, string>();
  for (const key of sampleKeys) {
    const mapped = normalizeHeader(key);
    if (mapped && mapped !== 'skip') fieldMap.set(mapped, key);
  }

  if (!fieldMap.has('clickDate')) {
    throw new Error('须包含 Date/clickDate 列');
  }
  if (!fieldMap.has('merchantId') && !defaultMid) {
    throw new Error(
      '导出文件无 MID 列：请先在 RW 后台筛选 Merchant 后 Group by Daily 导出，并在上方填写商家 MID',
    );
  }
  if (!fieldMap.has('clicks') && !fieldMap.has('performanceOrders')) {
    throw new Error('须包含 Clicks/clicks 和/或 Orders/orders 列');
  }
  if (defaultMid && !/^\d+$/.test(defaultMid)) {
    throw new Error('商家 MID 须为数字');
  }

  const midKey = fieldMap.get('merchantId');
  const dateKey = fieldMap.get('clickDate')!;
  const clicksKey = fieldMap.get('clicks');
  const ordersKey = fieldMap.get('performanceOrders');
  const nameKey = fieldMap.get('merchantName');

  const rows: ImportClickRow[] = [];
  for (const rec of records) {
    const merchantId = midKey ? String(rec[midKey] ?? '').trim() : defaultMid;
    const merchantName = nameKey
      ? String(rec[nameKey] ?? '').trim()
      : defaultName;
    const clickDate = parseClickDate(rec[dateKey]);
    const clicks = clicksKey ? parseClickCount(rec[clicksKey]) : 0;
    const performanceOrders = ordersKey ? parseOrderCount(rec[ordersKey]) : undefined;
    if (shouldSkipRow(merchantId, merchantName, clickDate)) continue;
    if (clicks === 0 && (performanceOrders === undefined || performanceOrders === 0)) continue;
    rows.push({
      merchantId,
      merchantName: merchantName || undefined,
      clickDate,
      clicks,
      ...(performanceOrders !== undefined ? { performanceOrders } : {}),
    });
  }

  if (!rows.length) {
    throw new Error('未解析到有效数据行（已跳过 Total 汇总行；请确认已填写 MID 且文件含 Date/Clicks）');
  }
  return rows;
}

/**
 * 解析 CSV（UTF-8，首行为表头）
 */
export function parseAffiliateClickCsv(
  text: string,
  options?: ParseAffiliateClickOptions,
): ImportClickRow[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    throw new Error('CSV 至少需要表头与一行数据');
  }

  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const records: Record<string, unknown>[] = [];

  for (let li = 1; li < lines.length; li += 1) {
    const cols = lines[li].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const rec: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      rec[h] = cols[i] ?? '';
    });
    records.push(rec);
  }

  return rowsFromHeaderRecords(records, options);
}

/**
 * 解析 LinkBux / RW 后台导出的 Excel（.xlsx）
 */
export async function parseAffiliateClickExcel(
  buffer: ArrayBuffer,
  options?: ParseAffiliateClickOptions,
): Promise<ImportClickRow[]> {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('Excel 中没有工作表');

  const sheet = wb.Sheets[sheetName];
  const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false,
  });

  return rowsFromHeaderRecords(records, options);
}

/**
 * 按扩展名解析 CSV 或 Excel
 */
export async function parseAffiliateClickFile(
  file: File,
  options?: ParseAffiliateClickOptions,
): Promise<ImportClickRow[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    return parseAffiliateClickExcel(await file.arrayBuffer(), options);
  }
  if (name.endsWith('.csv')) {
    return parseAffiliateClickCsv(await file.text(), options);
  }
  throw new Error('仅支持 .csv、.xlsx 文件');
}
