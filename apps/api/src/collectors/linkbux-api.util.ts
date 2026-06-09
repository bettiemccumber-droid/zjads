import axios from 'axios';

/** LinkBux 媒体 API（订单 transaction_v2、点击 user_click 共用） */
export const LB_API = 'https://www.linkbux.com/api.php';

/** Click API：1006 需等待 1 分钟；保守节流 */
const MIN_REQUEST_INTERVAL_MS = 2500;

let lastRequestAt = 0;

/**
 * 按自然日切片（begin/end 均为 YYYY-MM-DD，单日或间隔 ≤24 小时）
 */
export function buildLbDailySlots(startDate: string, endDate: string): { begin: string; end: string }[] {
  const slots: { begin: string; end: string }[] = [];
  const cur = new Date(`${startDate}T00:00:00`);
  const last = new Date(`${endDate}T00:00:00`);
  while (cur <= last) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    const day = `${y}-${m}-${d}`;
    slots.push({ begin: day, end: day });
    cur.setDate(cur.getDate() + 1);
  }
  return slots;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttleLbRequest() {
  const now = Date.now();
  const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - now;
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

/**
 * 解析 Click API 列表（官方 JSON 使用 payliad 字段名）
 */
export function extractLbClickListAndPages(body: unknown): {
  list: unknown[];
  totalPages: number;
  totalItems: number;
} {
  const root = body as Record<string, unknown>;
  const payload = (root.payliad ?? root.payload ?? root.data ?? root) as Record<string, unknown>;

  const total = (payload.total ?? payload) as Record<string, unknown>;
  const totalPages = Number(total.total_page ?? payload.total_page ?? root.total_page) || 1;
  const totalItems = Number(total.total_items ?? payload.total_items ?? root.total_items) || 0;

  if (Array.isArray(payload.list)) {
    let pages = totalPages;
    if (totalItems > 0 && payload.list.length > 0) {
      pages = Math.max(pages, Math.ceil(totalItems / payload.list.length));
    }
    return { list: payload.list, totalPages: pages, totalItems };
  }

  if (Array.isArray(root.list)) {
    return {
      list: root.list,
      totalPages: Number(root.total_page) || 1,
      totalItems: Number(root.total_items) || 0,
    };
  }

  return { list: [], totalPages: 1, totalItems: 0 };
}

/**
 * 解析 LinkBux Click API 返回码（status=200 为成功；列表在 payliad）
 */
export function assertLbClickApiSuccess(body: unknown, context: string): void {
  const root = body as Record<string, unknown>;
  const status = root.status;
  const errorCode = root.code ?? (typeof status === 'number' || typeof status === 'string' ? status : undefined);
  const errorMsg = String(root.msg ?? '');

  if (
    errorCode === 1006 ||
    errorCode === '1006' ||
    errorMsg.toLowerCase().includes('minute')
  ) {
    throw new LbClickRateLimitError(context);
  }

  if (status === 200 || status === '200') return;
  if (root.code === 0 || root.code === '0') return;

  const hints: Record<string, string> = {
    '1001': '缺少 token',
    '1002': 'token 无效',
    '1003': '缺少 begin_date 或 end_date',
    '1004': '开始日期大于结束日期',
    '1005': '查询区间不能超过 24 小时',
    '1007': '日期格式须为 YYYY-MM-DD',
    '1014': '日期早于 2023/1/1',
  };

  if (errorCode != null && errorCode !== 200 && errorCode !== '200') {
    const hint = hints[String(errorCode)] ?? errorMsg ?? '未知';
    throw new Error(`LinkBux ${context} 失败 (${errorCode}): ${hint}`);
  }

  if (root.payliad != null || root.payload != null || root.data != null) return;

  throw new Error(
    `LinkBux ${context} 响应异常: status=${String(status)} msg=${errorMsg.slice(0, 120)}`,
  );
}

export class LbClickRateLimitError extends Error {
  constructor(context: string) {
    super(`LinkBux ${context}: 请求过于频繁，请 1 分钟后重试 (1006)`);
    this.name = 'LbClickRateLimitError';
  }
}

/**
 * 分页拉取 Click API（op=user_click，日期 YYYY-MM-DD）
 */
export interface LbClickDayResult<T> {
  rows: T[];
  /** API 返回的当日点击总数（与 LB 后台 CPS Total Clicks 一致） */
  totalItems: number;
}

/**
 * 拉取单日 Click API 首页明细。
 * LinkBux 第 2 页起与第 1 页重复，故只拉首页并用 total_items 补全总量。
 */
export async function fetchLbClickDayFirstPage<T>(
  token: string,
  day: string,
  context: string,
  limit = 2000,
): Promise<LbClickDayResult<T>> {
  await throttleLbRequest();

  let response;
  let rateRetries = 0;
  while (true) {
    try {
      response = await axios.get(LB_API, {
        params: {
          mod: 'medium',
          op: 'user_click',
          token,
          begin_date: day,
          end_date: day,
          type: 'json',
          page: '1',
          limit: String(limit),
        },
        timeout: 120000,
        validateStatus: () => true,
      });
      assertLbClickApiSuccess(response.data, context);
      break;
    } catch (e) {
      if (e instanceof LbClickRateLimitError && rateRetries < 3) {
        rateRetries += 1;
        await sleep(62000);
        continue;
      }
      throw e;
    }
  }

  const parsed = extractLbClickListAndPages(response!.data);
  const list = parsed.list as T[];
  const totalItems = parsed.totalItems > 0 ? parsed.totalItems : list.length;
  return { rows: list, totalItems };
}

/**
 * @deprecated LinkBux 分页无效，请用 {@link fetchLbClickDayFirstPage}
 */
export async function fetchLbClickPagedList<T>(
  token: string,
  beginDate: string,
  endDate: string,
  context: string,
  limit = 2000,
): Promise<T[]> {
  if (beginDate !== endDate) {
    throw new Error('LinkBux user_click 仅支持单日查询，请使用 fetchLbClickDayFirstPage');
  }
  const { rows } = await fetchLbClickDayFirstPage<T>(token, beginDate, context, limit);
  return rows;
}
