import {
  forEachRewardooOffsetPage,
  forEachRewardooPageLimit,
} from './rewardoo-api.util';

/** RW Performance 看板按商家+交易日汇总的 Orders（与 Transaction Date 筛选一致） */
export interface RwMerchantPerformanceOrderAgg {
  merchantId: string;
  merchantName: string;
  statDate: string;
  orders: number;
}

interface RwPerformanceOrderSource {
  label: string;
  mod: string;
  op: string;
  dateParams: (day: string) => Record<string, string>;
  extra?: Record<string, string>;
}

/** 与 RW 后台 Performance（Transaction Date）对齐的数据源 */
const RW_PERFORMANCE_ORDER_SOURCES: RwPerformanceOrderSource[] = [
  {
    label: 'medium/performance',
    mod: 'medium',
    op: 'performance',
    dateParams: (day) => ({ begin_date: day, end_date: day }),
  },
  {
    label: 'medium/performance CPS',
    mod: 'medium',
    op: 'performance',
    dateParams: (day) => ({ begin_date: day, end_date: day, offer_type: 'CPS' }),
  },
  {
    label: 'performance/merchant',
    mod: 'performance',
    op: 'merchant',
    dateParams: (day) => ({ begin: day, end: day }),
  },
];

/**
 * 拉取 RW Performance Orders（按商家+自然日，对齐后台 Performance 看板）
 */
export async function fetchRewardooPerformanceOrderAggs(
  apiToken: string,
  startDate: string,
  endDate: string,
): Promise<RwMerchantPerformanceOrderAgg[]> {
  const map = new Map<string, RwMerchantPerformanceOrderAgg>();

  for (const day of listInclusiveDates(startDate, endDate)) {
    for (const spec of RW_PERFORMANCE_ORDER_SOURCES) {
      const filled = await fetchPerformanceOrdersForDay_(apiToken, spec, day, map);
      if (filled) break;
    }
  }

  return [...map.values()];
}

async function fetchPerformanceOrdersForDay_(
  apiToken: string,
  spec: RwPerformanceOrderSource,
  day: string,
  map: Map<string, RwMerchantPerformanceOrderAgg>,
): Promise<boolean> {
  const extraParams = { ...(spec.extra ?? {}), ...spec.dateParams(day) };
  let filled = false;

  const merge = (rows: unknown[]) => {
    for (const raw of rows) {
      if (mergePerformanceOrderRow_(raw as Record<string, unknown>, day, map)) {
        filled = true;
      }
    }
  };

  try {
    const pageResult = await forEachRewardooPageLimit(
      spec.mod,
      spec.op,
      apiToken,
      extraParams,
      merge,
      500,
    );
    if (!pageResult.skipped && filled) return true;

    if (!filled) {
      const offsetResult = await forEachRewardooOffsetPage(
        spec.mod,
        spec.op,
        apiToken,
        extraParams,
        merge,
        500,
      );
      if (!offsetResult.skipped && filled) return true;
    }
  } catch {
    return false;
  }

  return filled;
}

function mergePerformanceOrderRow_(
  row: Record<string, unknown>,
  defaultDate: string,
  map: Map<string, RwMerchantPerformanceOrderAgg>,
): boolean {
  const merchantId = resolveRwPerformanceMerchantId_(row);
  if (!merchantId) return false;

  const orders = parseRwPerformanceOrderCount_(row);
  if (orders <= 0) return false;

  const statDate = parseRwPerformanceRowDate_(row) || defaultDate;
  const key = `${merchantId}|${statDate}`;
  const existing = map.get(key);
  if (existing) {
    existing.orders = Math.max(existing.orders, orders);
    if (!existing.merchantName) {
      existing.merchantName = String(row.merchant_name ?? row.advertiser_name ?? '');
    }
  } else {
    map.set(key, {
      merchantId,
      merchantName: String(row.merchant_name ?? row.advertiser_name ?? ''),
      statDate,
      orders,
    });
  }
  return true;
}

function parseRwPerformanceOrderCount_(row: Record<string, unknown>): number {
  for (const key of ['orders', 'order', 'order_count'] as const) {
    const n = parsePositiveInt_(row[key]);
    if (n > 0) return n;
  }

  for (const nestedKey of ['stat', 'stats', 'summary', 'total'] as const) {
    const nested = row[nestedKey];
    if (!nested || typeof nested !== 'object') continue;
    const n = parseRwPerformanceOrderCount_(nested as Record<string, unknown>);
    if (n > 0) return n;
  }

  return 0;
}

function resolveRwPerformanceMerchantId_(row: Record<string, unknown>): string {
  for (const key of ['mid', 'm_id', 'merchant_id', 'brand_id', 'norm_id', 'mcid'] as const) {
    const raw = row[key];
    if (raw == null || String(raw).trim() === '') continue;
    const s = String(raw).trim();
    if (/^\d+$/.test(s)) return s;
  }

  const name = row.merchant_name ?? row.advertiser_name;
  if (name) {
    const paren = String(name).match(/\((\d+)\)/);
    if (paren) return paren[1];
  }

  for (const key of ['mid', 'm_id', 'merchant_id', 'brand_id', 'mcid'] as const) {
    const raw = row[key];
    if (raw == null || String(raw).trim() === '') continue;
    return String(raw).trim();
  }

  return '';
}

function parseRwPerformanceRowDate_(row: Record<string, unknown>): string {
  for (const key of [
    'transaction_date',
    'order_ymd',
    'order_date',
    'date',
    'ymd',
    'payment_ymd',
    'stat_date',
    'day',
    'report_date',
  ] as const) {
    const v = row[key];
    if (v == null || String(v).trim() === '' || String(v) === 'null') continue;
    const s = String(v).trim();
    const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
  }
  return '';
}

function parsePositiveInt_(raw: unknown): number {
  if (raw == null || raw === '') return 0;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw).replace(/,/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function listInclusiveDates(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  let cur = startDate;
  while (cur <= endDate) {
    out.push(cur);
    if (cur === endDate) break;
    cur = addCalendarDays(cur, 1);
  }
  return out;
}

function addCalendarDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
