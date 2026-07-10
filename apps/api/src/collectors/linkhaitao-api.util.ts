import axios from 'axios';

/** LinkHaitao 媒体 API 基址（见 click-report-api / commission-report-api 文档） */
export const LH_API_BASE = 'https://www.linkhaitao.com/api.php';

/** 点击 API：60 秒内最多 15 次；佣金 cashback2 实际更严，保守 4.2s */
const MIN_REQUEST_INTERVAL_MS = 4200;

let lastRequestAt = 0;

/**
 * 按文档生成按自然日切片（begin/end 间隔不得超过 1 天，用于 user_click2）
 */
export function buildLhDailySlots(startDate: string, endDate: string): { begin: string; end: string }[] {
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

/**
 * 佣金 cashback2 单次请求最多 31 天
 */
export function buildLhCommissionSlots(startDate: string, endDate: string, maxDays = 31): { begin: string; end: string }[] {
  const slots: { begin: string; end: string }[] = [];
  const cur = new Date(`${startDate}T00:00:00`);
  const last = new Date(`${endDate}T00:00:00`);
  while (cur <= last) {
    const begin = formatYmd(cur);
    const chunkEnd = new Date(cur);
    chunkEnd.setDate(chunkEnd.getDate() + maxDays - 1);
    const end = chunkEnd <= last ? formatYmd(chunkEnd) : formatYmd(last);
    slots.push({ begin, end });
    cur.setTime(chunkEnd.getTime());
    cur.setDate(cur.getDate() + 1);
  }
  return slots;
}

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function throttleLhRequest() {
  const now = Date.now();
  const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - now;
  if (wait > 0) {
    await sleep(wait);
  }
  lastRequestAt = Date.now();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 解析 LH 列表与分页（兼容 click 与 cashback2 两种 JSON 结构）
 */
function extractLhListAndPages(body: unknown): {
  list: unknown[];
  totalPages: number;
  totalItems: number;
} {
  const root = body as Record<string, unknown>;

  if (Array.isArray(root.list)) {
    const total = root.total as Record<string, unknown> | undefined;
    return {
      list: root.list,
      totalPages: Number(total?.total_page) || 1,
      totalItems: Number(total?.total_items) || 0,
    };
  }

  const data = (root.data ?? root) as Record<string, unknown>;
  if (Array.isArray(data.list)) {
    return {
      list: data.list,
      totalPages: Number(data.total_page) || 1,
      totalItems: Number(data.total_items) || 0,
    };
  }

  return { list: [], totalPages: 1, totalItems: 0 };
}

/**
 * 解析 LH API 返回码（click: status=200/0；cashback2: status.code=0）
 */
export function assertLhApiSuccess(body: unknown, context: string): void {
  const root = body as Record<string, unknown>;

  if (typeof root.status === 'number') {
    if (root.status === 0 || root.status === 200) return;
    throwLhError(root.status, String(root.msg ?? ''), context);
  }

  const status = root.status as Record<string, unknown> | undefined;
  if (status && typeof status === 'object' && 'code' in status) {
    const code = status.code;
    if (code === 0 || code === '0' || code === 200 || code === '200') return;
    throwLhError(code, String(status.msg ?? root.msg ?? ''), context);
  }

  const code = root.code ?? root.status_code;
  if (code === 200 || code === '200' || code === 0 || code === '0') return;

  if (code != null) {
    throwLhError(code, String(root.msg ?? root.message ?? ''), context);
  }
}

function throwLhError(code: unknown, msg: string, context: string): never {
  const codeNum = typeof code === 'number' ? code : parseInt(String(code), 10);
  const hints: Record<number, string> = {
    1000: '缺少 token',
    1001: 'token 无效',
    1002: '缺少 begin_date 或 end_date / 请求过于频繁',
    1003: '开始日期大于结束日期',
    1004: '查询区间不能超过 1 天',
    1005: '请求过于频繁（60 秒内最多 15 次）',
    1006: '日期超出允许范围（如早于 2023/1/1 或超过 31 天）',
    9998: '请求过于频繁',
    9999: '请求频率限制',
  };
  const hint = hints[codeNum] ?? msg;
  throw new Error(`LinkHaitao ${context} 失败 (${code}): ${hint}`);
}

/**
 * 调用 LH 分页列表 API
 */
export async function fetchLhPagedList<T>(
  op: string,
  token: string,
  beginDate: string,
  endDate: string,
  context: string,
  perPage = 500,
): Promise<T[]> {
  const all: T[] = [];
  let page = 1;
  let totalPages = 1;
  let totalItems = 0;
  const pageSize = Math.max(100, Math.min(perPage, 40000));

  while (page <= totalPages && page <= 500) {
    await throttleLhRequest();

    const response = await axios.get(LH_API_BASE, {
      params: {
        mod: 'medium',
        op,
        token,
        begin_date: beginDate,
        end_date: endDate,
        page,
        per_page: pageSize,
      },
      timeout: 120000,
      validateStatus: () => true,
    });

    assertLhApiSuccess(response.data, context);

    const parsed = extractLhListAndPages(response.data);
    totalPages = parsed.totalPages || 1;
    if (parsed.totalItems > 0) totalItems = parsed.totalItems;
    const list = parsed.list as T[];
    all.push(...list);

    if (!list.length) break;
    if (list.length < pageSize) break;
    if (totalItems > 0 && all.length >= totalItems) break;
    page += 1;
  }

  return all;
}

/**
 * 按自然日循环拉取（user_click2，遵守 1 天区间限制）
 */
export async function fetchLhByDailySlots<T>(
  op: string,
  token: string,
  startDate: string,
  endDate: string,
  context: string,
  onProgress?: (current: number, total: number) => void | Promise<void>,
): Promise<T[]> {
  const slots = buildLhDailySlots(startDate, endDate);
  const all: T[] = [];

  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i];
    const rows = await fetchLhPagedList<T>(
      op,
      token,
      slot.begin,
      slot.end,
      context,
    );
    all.push(...rows);
    if (onProgress) {
      await onProgress(i + 1, slots.length);
    }
  }

  return all;
}

/**
 * 按最多 31 天切片拉取佣金（cashback2）
 */
export async function fetchLhByCommissionSlots<T>(
  token: string,
  startDate: string,
  endDate: string,
  onProgress?: (current: number, total: number) => void | Promise<void>,
): Promise<T[]> {
  const slots = buildLhCommissionSlots(startDate, endDate);
  const all: T[] = [];

  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i];
    const rows = await fetchLhPagedList<T>(
      'cashback2',
      token,
      slot.begin,
      slot.end,
      '佣金报表',
      2000,
    );
    all.push(...rows);
    if (onProgress) {
      await onProgress(i + 1, slots.length);
    }
  }

  return all;
}
