import axios from 'axios';

/** Rewardoo 媒体 API 基址 */
export const RW_API_BASE = 'https://admin.rewardoo.com/api.php';

/** 文档：单次查询跨度不得超过 62 天 */
export const RW_MAX_DAYS_PER_REQUEST = 62;

/** TransactionDetails 默认分页大小（与 affiliate 现网一致） */
export const RW_PAGE_SIZE = 1000;

/** 订单明细主接口（affiliate 现网 / Rewardoo API Documents） */
export const RW_TRANSACTION_DETAILS_OP = 'transaction_details';

/** 按优先级尝试的佣金数据源（commission 模块，payment_begin/end） */
export const RW_COMMISSION_OPS = [
  'transaction',
  'performance',
  'merchant',
  'report',
  'list',
  'cpc',
  'cpc_performance',
] as const;

export type RwCommissionOp = (typeof RW_COMMISSION_OPS)[number];

/** performance 模块（begin/end，对齐后台 Performance 看板） */
export const RW_PERFORMANCE_OPS = [
  'report',
  'merchant',
  'summary',
  'transaction',
] as const;

export type RwPerformanceOp = (typeof RW_PERFORMANCE_OPS)[number];

/** 保守节流，避免 1002 调用频率过高 */
const MIN_REQUEST_INTERVAL_MS = 2200;

let lastRequestAt = 0;

export interface RwApiStatus {
  code: number;
  msg?: string;
}

export interface RwApiEnvelope {
  offset?: number | null;
  pageSize?: number | null;
  status?: RwApiStatus;
  list?: unknown[];
  data?: unknown[] | Record<string, unknown>;
}

export interface RwDateChunk {
  begin: string;
  end: string;
}

export interface RwFetchResult {
  source: string;
  rows: unknown[];
  triedSources: string[];
}

/**
 * 将日期区间按 Rewardoo API 上限（62 天）切分
 */
export function buildRwDateChunks(
  startDate: string,
  endDate: string,
  maxDays = RW_MAX_DAYS_PER_REQUEST,
): RwDateChunk[] {
  const slots: RwDateChunk[] = [];
  let cursor = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);

  while (cursor <= end) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + maxDays - 1);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());

    slots.push({
      begin: cursor.toISOString().slice(0, 10),
      end: chunkEnd.toISOString().slice(0, 10),
    });

    cursor = new Date(chunkEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return slots;
}

async function throttleRwRequest() {
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
 * 解析 Rewardoo JSON 响应中的列表与状态码
 */
export function parseRwApiEnvelope(body: unknown): {
  code: number;
  message: string;
  rows: unknown[];
  offset: number | null;
  pageSize: number | null;
  totalPages: number | null;
} {
  const root = body as Record<string, unknown>;
  const statusRaw = root.status;
  let code = -1;
  if (root.code === 0 || root.code === '0' || root.code === 200 || root.code === '200') {
    code = 0;
  } else if (typeof statusRaw === 'number') {
    code = statusRaw === 200 ? 0 : statusRaw;
  } else if (statusRaw && typeof statusRaw === 'object') {
    const status = statusRaw as RwApiStatus;
    code = status.code ?? -1;
    if (code === 200) code = 0;
  } else if (statusRaw === 0 || statusRaw === '0') {
    code = 0;
  }

  const message = String(
    (statusRaw && typeof statusRaw === 'object'
      ? (statusRaw as RwApiStatus).msg
      : '') ||
      root.msg ||
      root.info ||
      '',
  ).trim();

  const rows = extractRwRowsWithSummaries(body);

  return {
    code,
    message,
    rows,
    offset: typeof root.offset === 'number' ? root.offset : null,
    pageSize: typeof root.pageSize === 'number' ? root.pageSize : null,
    totalPages: extractRwTotalPages(body),
  };
}

/** 从 data.total_page 等字段解析分页总数 */
function extractRwTotalPages(body: unknown): number | null {
  const root = body as Record<string, unknown>;
  if (root.total_page != null) {
    const n = Number(root.total_page);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  const data = root.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const nested = data as Record<string, unknown>;
    if (nested.total_page != null) {
      const n = Number(nested.total_page);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
  }

  const payload = root.payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const total = (payload as Record<string, unknown>).total;
    if (total && typeof total === 'object') {
      const tp = (total as Record<string, unknown>).total_page;
      if (tp != null) {
        const n = Number(tp);
        return Number.isFinite(n) && n > 0 ? n : null;
      }
    }
  }

  return null;
}

/** 从多种 JSON 结构中提取 list 数组 */
function extractRwRows(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;

  const root = body as Record<string, unknown>;
  if (Array.isArray(root.list)) return root.list;
  if (Array.isArray(root.data)) return root.data;

  const data = root.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const nested = data as Record<string, unknown>;
    if (Array.isArray(nested.list)) return nested.list;
    if (Array.isArray(nested.rows)) return nested.rows;
    if (Array.isArray(nested.items)) return nested.items;
    /** affiliate collectRWOrders：data.list || data.transactions */
    if (Array.isArray(nested.transactions)) return nested.transactions;
  }

  const result = root.result;
  if (result && typeof result === 'object') {
    const nested = result as Record<string, unknown>;
    if (Array.isArray(nested.list)) return nested.list;
  }

  const payload = root.payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const nested = payload as Record<string, unknown>;
    if (Array.isArray(nested.list)) return nested.list;
  }

  /** LinkBux/Rewardoo 部分站点 typo：payliad.list */
  const payliad = root.payliad;
  if (payliad && typeof payliad === 'object' && !Array.isArray(payliad)) {
    const nested = payliad as Record<string, unknown>;
    if (Array.isArray(nested.list)) return nested.list;
  }

  return [];
}

/**
 * 从 list 与 total/summary 等结构提取可解析行（LinkBux/RW 部分接口 list 为空但 total 有汇总）
 */
function extractRwRowsWithSummaries(body: unknown): unknown[] {
  const rows = extractRwRows(body);
  const root = body as Record<string, unknown>;
  const payload = (root.payliad ?? root.payload ?? root.data ?? root) as Record<
    string,
    unknown
  >;

  const extras: unknown[] = [];
  const total = payload.total;
  if (total && typeof total === 'object' && !Array.isArray(total)) {
    extras.push(total);
  }

  for (const key of ['summary', 'stat', 'stats'] as const) {
    const nested = payload[key] ?? root[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      extras.push(nested);
    }
  }

  if (rows.length === 0 && extras.length === 0 && payload !== root) {
    const hasMetric = ['clicks', 'orders', 'order', 'click', 'comm', 'commission'].some(
      (k) => payload[k] != null && String(payload[k]) !== '0',
    );
    if (hasMetric) extras.push(payload);
  }

  return [...rows, ...extras];
}

/**
 * 调用 Rewardoo API（POST x-www-form-urlencoded）
 */
export async function postRewardooApi(
  mod: string,
  op: string,
  params: Record<string, string>,
): Promise<ReturnType<typeof parseRwApiEnvelope>> {
  await throttleRwRequest();

  const { data } = await axios.post<RwApiEnvelope | string>(
    `${RW_API_BASE}?mod=${encodeURIComponent(mod)}&op=${encodeURIComponent(op)}`,
    new URLSearchParams(params).toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 120000,
      validateStatus: () => true,
    },
  );

  if (typeof data === 'string') {
    const msg = data.trim();
    if (/token error/i.test(msg)) {
      return { code: 1001, message: msg, rows: [], offset: null, pageSize: null, totalPages: null };
    }
    return { code: -1, message: msg, rows: [], offset: null, pageSize: null, totalPages: null };
  }

  return parseRwApiEnvelope(data);
}

/** @deprecated 使用 postRewardooApi('commission', op, params) */
export async function postRewardooCommissionApi(
  op: string,
  params: Record<string, string>,
): Promise<ReturnType<typeof parseRwApiEnvelope>> {
  return postRewardooApi('commission', op, params);
}

/**
 * 拉取单段 Rewardoo commission 模块数据（payment_begin/end）
 */
export async function fetchRewardooOpChunk(
  op: RwCommissionOp,
  apiToken: string,
  begin: string,
  end: string,
  pageSize = RW_PAGE_SIZE,
): Promise<unknown[]> {
  return fetchRewardooPaged('commission', op, apiToken, { payment_begin: begin, payment_end: end }, pageSize);
}

/**
 * 拉取单段 Rewardoo performance 模块数据（begin/end）
 */
export async function fetchRewardooPerformanceChunk(
  op: RwPerformanceOp,
  apiToken: string,
  begin: string,
  end: string,
  pageSize = RW_PAGE_SIZE,
): Promise<unknown[]> {
  return fetchRewardooPaged('performance', op, apiToken, { begin, end }, pageSize);
}

/**
 * 按 page/limit 分页遍历（与 transaction_details / LinkBux performance 一致，含 type=json）。
 */
export async function forEachRewardooPageLimit(
  mod: string,
  op: string,
  apiToken: string,
  extraParams: Record<string, string>,
  onPage: (rows: unknown[], page: number) => void | Promise<void>,
  pageSize = RW_PAGE_SIZE,
): Promise<{ rowCount: number; skipped: boolean }> {
  let page = 1;
  let totalPages = 1;
  let rowCount = 0;

  for (; page <= totalPages && page <= 500; page += 1) {
    const parsed = await postRewardooApi(mod, op, {
      token: apiToken,
      type: 'json',
      ...extraParams,
      page: String(page),
      limit: String(pageSize),
    });

    if (parsed.code === 1002) {
      await sleep(65000);
      page -= 1;
      continue;
    }

    if (parsed.code === 1003 || parsed.code === 1004) {
      return { rowCount: 0, skipped: true };
    }

    if (parsed.code !== 0) {
      throw new Error(
        `Rewardoo ${mod}/${op} API 错误 ${parsed.code}${parsed.message ? `: ${parsed.message}` : ''}`,
      );
    }

    if (parsed.rows.length) {
      await onPage(parsed.rows, page);
      rowCount += parsed.rows.length;
    }

    totalPages = parsed.totalPages ?? 1;
    if (parsed.rows.length < pageSize) break;
  }

  return { rowCount, skipped: false };
}

/**
 * 按 offset/pageSize 分页遍历（commission/performance 部分站点仅此方式有效）。
 */
export async function forEachRewardooOffsetPage(
  mod: string,
  op: string,
  apiToken: string,
  extraParams: Record<string, string>,
  onPage: (rows: unknown[], pageIndex: number) => void | Promise<void>,
  pageSize = RW_PAGE_SIZE,
): Promise<{ rowCount: number; skipped: boolean }> {
  let offset = 0;
  let rowCount = 0;

  for (let pageIndex = 0; pageIndex < 500; pageIndex += 1) {
    const parsed = await postRewardooApi(mod, op, {
      token: apiToken,
      type: 'json',
      ...extraParams,
      offset: String(offset),
      pageSize: String(pageSize),
    });

    if (parsed.code === 1002) {
      await sleep(65000);
      pageIndex -= 1;
      continue;
    }

    if (parsed.code === 1003 || parsed.code === 1004) {
      return { rowCount: 0, skipped: true };
    }

    if (parsed.code !== 0) {
      throw new Error(
        `Rewardoo ${mod}/${op} API 错误 ${parsed.code}${parsed.message ? `: ${parsed.message}` : ''}`,
      );
    }

    if (parsed.rows.length) {
      await onPage(parsed.rows, pageIndex);
      rowCount += parsed.rows.length;
    }

    if (!parsed.rows.length || parsed.rows.length < pageSize) break;

    const nextOffset =
      parsed.offset != null && Number.isFinite(parsed.offset)
        ? Number(parsed.offset) + parsed.rows.length
        : offset + parsed.rows.length;
    if (nextOffset <= offset) break;
    offset = nextOffset;
  }

  return { rowCount, skipped: false };
}

/**
 * 按页遍历 commission 模块数据（payment_begin/end + offset/pageSize），不累积全量 rows。
 * 1003/1004 视为参数/区间无效，静默跳过（由调用方尝试下一数据源）。
 */
export async function forEachRewardooCommissionPage(
  op: RwCommissionOp,
  apiToken: string,
  paymentBegin: string,
  paymentEnd: string,
  onPage: (rows: unknown[], pageIndex: number) => void | Promise<void>,
  pageSize = RW_PAGE_SIZE,
): Promise<void> {
  let offset = 0;

  for (let pageIndex = 0; pageIndex < 500; pageIndex += 1) {
    const parsed = await postRewardooApi('commission', op, {
      token: apiToken,
      payment_begin: paymentBegin,
      payment_end: paymentEnd,
      offset: String(offset),
      pageSize: String(pageSize),
    });

    if (parsed.code === 1002) {
      await sleep(65000);
      continue;
    }

    if (parsed.code === 1003 || parsed.code === 1004) {
      return;
    }

    if (parsed.code !== 0) {
      throw new Error(
        `Rewardoo commission/${op} API 错误 ${parsed.code}${parsed.message ? `: ${parsed.message}` : ''}`,
      );
    }

    const rows = parsed.rows;
    if (rows.length) {
      await onPage(rows, pageIndex);
    }

    if (!rows.length || rows.length < pageSize) break;

    const nextOffset =
      parsed.offset != null && Number.isFinite(parsed.offset)
        ? Number(parsed.offset) + rows.length
        : offset + rows.length;
    if (nextOffset <= offset) break;
    offset = nextOffset;
  }
}

/**
 * 按页遍历 performance 数据（offset/pageSize），不累积全量 rows，供点击汇总等低内存场景使用。
 */
export async function forEachRewardooPerformancePage(
  op: RwPerformanceOp,
  apiToken: string,
  begin: string,
  end: string,
  onPage: (rows: unknown[], pageIndex: number) => void | Promise<void>,
  pageSize = RW_PAGE_SIZE,
): Promise<void> {
  let offset = 0;

  for (let pageIndex = 0; pageIndex < 500; pageIndex += 1) {
    const parsed = await postRewardooApi('performance', op, {
      token: apiToken,
      begin,
      end,
      offset: String(offset),
      pageSize: String(pageSize),
    });

    if (parsed.code === 1002) {
      await sleep(65000);
      continue;
    }

    if (parsed.code === 1003 || parsed.code === 1004) {
      return;
    }

    if (parsed.code !== 0) {
      throw new Error(
        `Rewardoo performance/${op} API 错误 ${parsed.code}${parsed.message ? `: ${parsed.message}` : ''}`,
      );
    }

    const rows = parsed.rows;
    if (rows.length) {
      await onPage(rows, pageIndex);
    }

    if (!rows.length || rows.length < pageSize) break;

    const nextOffset =
      parsed.offset != null && Number.isFinite(parsed.offset)
        ? Number(parsed.offset) + rows.length
        : offset + rows.length;
    if (nextOffset <= offset) break;
    offset = nextOffset;
  }
}

async function fetchRewardooPaged(
  mod: string,
  op: string,
  apiToken: string,
  dateParams: Record<string, string>,
  pageSize: number,
): Promise<unknown[]> {
  const all: unknown[] = [];
  let offset = 0;

  for (let page = 0; page < 500; page += 1) {
    const parsed = await postRewardooApi(mod, op, {
      token: apiToken,
      ...dateParams,
      offset: String(offset),
      pageSize: String(pageSize),
    });

    if (parsed.code === 1002) {
      await sleep(65000);
      continue;
    }

    if (parsed.code !== 0) {
      throw new Error(
        `Rewardoo ${mod}/${op} API 错误 ${parsed.code}${parsed.message ? `: ${parsed.message}` : ''}`,
      );
    }

    const rows = parsed.rows;
    all.push(...rows);

    if (!rows.length || rows.length < pageSize) break;

    const nextOffset =
      parsed.offset != null && Number.isFinite(parsed.offset)
        ? Number(parsed.offset) + rows.length
        : offset + rows.length;
    if (nextOffset <= offset) break;
    offset = nextOffset;
  }

  return all;
}

/**
 * 按 62 天窗口拉取指定 op 全量行
 */
export async function fetchRewardooOpPages(
  op: RwCommissionOp,
  apiToken: string,
  startDate: string,
  endDate: string,
  onProgress?: (chunkIndex: number, totalChunks: number) => void | Promise<void>,
): Promise<unknown[]> {
  const chunks = buildRwDateChunks(startDate, endDate);
  const all: unknown[] = [];

  for (let i = 0; i < chunks.length; i += 1) {
    await onProgress?.(i + 1, chunks.length);
    const chunk = chunks[i];
    const rows = await fetchRewardooOpChunk(op, apiToken, chunk.begin, chunk.end);
    all.push(...rows);
  }

  return all;
}

/**
 * 按 62 天窗口拉取 performance 模块全量行
 */
export async function fetchRewardooPerformancePages(
  op: RwPerformanceOp,
  apiToken: string,
  startDate: string,
  endDate: string,
  onProgress?: (chunkIndex: number, totalChunks: number) => void | Promise<void>,
): Promise<unknown[]> {
  const chunks = buildRwDateChunks(startDate, endDate);
  const all: unknown[] = [];

  for (let i = 0; i < chunks.length; i += 1) {
    await onProgress?.(i + 1, chunks.length);
    const chunk = chunks[i];
    const rows = await fetchRewardooPerformanceChunk(op, apiToken, chunk.begin, chunk.end);
    all.push(...rows);
  }

  return all;
}

/**
 * 拉取 Rewardoo 订单明细（mod=medium&op=transaction_details，与 affiliate 现网一致）
 */
export async function fetchRewardooTransactionDetailPages(
  apiToken: string,
  startDate: string,
  endDate: string,
  onProgress?: (chunkIndex: number, totalChunks: number) => void | Promise<void>,
): Promise<unknown[]> {
  const chunks = buildRwDateChunks(startDate, endDate);
  const all: unknown[] = [];

  for (let i = 0; i < chunks.length; i += 1) {
    await onProgress?.(i + 1, chunks.length);
    const chunk = chunks[i];
    const rows = await fetchRewardooTransactionDetailChunk(
      apiToken,
      chunk.begin,
      chunk.end,
    );
    all.push(...rows);
  }

  return all;
}

async function fetchRewardooTransactionDetailChunk(
  apiToken: string,
  beginDate: string,
  endDate: string,
): Promise<unknown[]> {
  const all: unknown[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= 1000) {
    const parsed = await postRewardooApi('medium', RW_TRANSACTION_DETAILS_OP, {
      token: apiToken,
      begin_date: beginDate,
      end_date: endDate,
      page: String(page),
      limit: String(RW_PAGE_SIZE),
    });

    if (parsed.code === 1002) {
      await sleep(65000);
      continue;
    }

    if (parsed.code !== 0) {
      throw new Error(
        `Rewardoo medium/${RW_TRANSACTION_DETAILS_OP} API 错误 ${parsed.code}${parsed.message ? `: ${parsed.message}` : ''}`,
      );
    }

    const rows = parsed.rows;
    all.push(...rows);

    if (parsed.totalPages != null) {
      totalPages = parsed.totalPages;
    } else if (!rows.length || rows.length < RW_PAGE_SIZE) {
      break;
    }

    if (page >= totalPages) break;
    page += 1;
  }

  return all;
}

/**
 * 依次尝试 medium/transaction_details，再回退 commission / performance 模块
 */
export async function fetchRewardooCommissionData(
  apiToken: string,
  startDate: string,
  endDate: string,
  onProgress?: (message: string) => void | Promise<void>,
): Promise<RwFetchResult> {
  const triedSources: string[] = [];

  const primaryLabel = `medium/${RW_TRANSACTION_DETAILS_OP}`;
  triedSources.push(primaryLabel);
  await onProgress?.(`RW ${primaryLabel} 拉取中…`);
  try {
    const rows = await fetchRewardooTransactionDetailPages(
      apiToken,
      startDate,
      endDate,
      async (chunkIndex, totalChunks) => {
        await onProgress?.(`RW ${primaryLabel} ${chunkIndex}/${totalChunks} 段…`);
      },
    );
    if (rows.length) {
      return { source: primaryLabel, rows, triedSources };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await onProgress?.(`RW ${primaryLabel} 跳过: ${msg.slice(0, 80)}`);
  }

  for (const op of RW_COMMISSION_OPS) {
    const label = `commission/${op}`;
    triedSources.push(label);
    await onProgress?.(`RW ${label} 拉取中…`);
    try {
      const rows = await fetchRewardooOpPages(
        op,
        apiToken,
        startDate,
        endDate,
        async (chunkIndex, totalChunks) => {
          await onProgress?.(`RW ${label} ${chunkIndex}/${totalChunks} 段…`);
        },
      );
      if (rows.length) {
        return { source: label, rows, triedSources };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await onProgress?.(`RW ${label} 跳过: ${msg.slice(0, 80)}`);
    }
  }

  for (const op of RW_PERFORMANCE_OPS) {
    const label = `performance/${op}`;
    triedSources.push(label);
    await onProgress?.(`RW ${label} 拉取中…`);
    try {
      const rows = await fetchRewardooPerformancePages(
        op,
        apiToken,
        startDate,
        endDate,
        async (chunkIndex, totalChunks) => {
          await onProgress?.(`RW ${label} ${chunkIndex}/${totalChunks} 段…`);
        },
      );
      if (rows.length) {
        return { source: label, rows, triedSources };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await onProgress?.(`RW ${label} 跳过: ${msg.slice(0, 80)}`);
    }
  }

  return { source: 'none', rows: [], triedSources };
}

/** @deprecated 使用 fetchRewardooOpChunk('transaction', ...) */
export async function fetchRewardooTransactionChunk(
  apiToken: string,
  begin: string,
  end: string,
  pageSize = RW_PAGE_SIZE,
): Promise<unknown[]> {
  return fetchRewardooOpChunk('transaction', apiToken, begin, end, pageSize);
}

/** @deprecated 使用 fetchRewardooOpPages('transaction', ...) */
export async function fetchRewardooTransactionPages(
  apiToken: string,
  startDate: string,
  endDate: string,
  onProgress?: (chunkIndex: number, totalChunks: number) => void | Promise<void>,
): Promise<unknown[]> {
  return fetchRewardooOpPages('transaction', apiToken, startDate, endDate, onProgress);
}

/**
 * 调用 Rewardoo CommissionSummary API（结算/付款日期口径）
 */
export async function postRewardooCommissionSummary(
  apiToken: string,
  paymentBegin: string,
  paymentEnd: string,
): Promise<unknown[]> {
  const parsed = await postRewardooApi('commission', 'summary', {
    token: apiToken,
    payment_begin: paymentBegin,
    payment_end: paymentEnd,
  });

  if (parsed.code !== 0) {
    throw new Error(
      `Rewardoo Summary API 错误 ${parsed.code}${parsed.message ? `: ${parsed.message}` : ''}`,
    );
  }

  return parsed.rows;
}

/**
 * 按 62 天窗口拉取 CommissionSummary 全量行（结算口径，非 Performance）
 */
export async function fetchRewardooCommissionSummaryPages(
  apiToken: string,
  startDate: string,
  endDate: string,
  onProgress?: (chunkIndex: number, totalChunks: number) => void | Promise<void>,
): Promise<unknown[]> {
  const chunks = buildRwDateChunks(startDate, endDate);
  const all: unknown[] = [];

  for (let i = 0; i < chunks.length; i += 1) {
    await onProgress?.(i + 1, chunks.length);
    const chunk = chunks[i];
    const rows = await postRewardooCommissionSummary(
      apiToken,
      chunk.begin,
      chunk.end,
    );
    all.push(...rows);
  }

  return all;
}
