import axios from 'axios';

/** Rewardoo 媒体 API 基址 */
export const RW_API_BASE = 'https://admin.rewardoo.com/api.php';

/** 文档：单次查询跨度不得超过 62 天 */
export const RW_MAX_DAYS_PER_REQUEST = 62;

/** TransactionDetails 默认分页大小 */
export const RW_PAGE_SIZE = 500;

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
  data?: unknown[];
}

export interface RwDateChunk {
  begin: string;
  end: string;
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
} {
  const root = body as RwApiEnvelope;
  const code = root.status?.code ?? -1;
  const message = String(root.status?.msg ?? '').trim();

  if (Array.isArray(root.list)) {
    return {
      code,
      message,
      rows: root.list,
      offset: root.offset ?? null,
      pageSize: root.pageSize ?? null,
    };
  }
  if (Array.isArray(root.data)) {
    return {
      code,
      message,
      rows: root.data,
      offset: root.offset ?? null,
      pageSize: root.pageSize ?? null,
    };
  }
  if (Array.isArray(body)) {
    return { code, message, rows: body, offset: null, pageSize: null };
  }

  return { code, message, rows: [], offset: null, pageSize: null };
}

/**
 * 调用 Rewardoo API（POST x-www-form-urlencoded）
 */
export async function postRewardooApi(
  op: string,
  params: Record<string, string>,
): Promise<ReturnType<typeof parseRwApiEnvelope>> {
  await throttleRwRequest();

  const { data } = await axios.post<RwApiEnvelope>(
    `${RW_API_BASE}?mod=commission&op=${encodeURIComponent(op)}`,
    new URLSearchParams(params).toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 120000,
      validateStatus: () => true,
    },
  );

  return parseRwApiEnvelope(data);
}

/**
 * 调用 Rewardoo CommissionSummary API（结算/付款日期口径）
 * @see mod=commission&op=summary
 */
export async function postRewardooCommissionSummary(
  apiToken: string,
  paymentBegin: string,
  paymentEnd: string,
): Promise<unknown[]> {
  const parsed = await postRewardooApi('summary', {
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
 * 拉取单段 TransactionDetails（分页）
 * 参数名 payment_begin/end 为文档字段；与 Performance「Transaction Date」口径一致
 * @see mod=commission&op=transaction
 */
export async function fetchRewardooTransactionChunk(
  apiToken: string,
  begin: string,
  end: string,
  pageSize = RW_PAGE_SIZE,
): Promise<unknown[]> {
  const all: unknown[] = [];
  let offset = 0;

  for (let page = 0; page < 500; page += 1) {
    const parsed = await postRewardooApi('transaction', {
      token: apiToken,
      payment_begin: begin,
      payment_end: end,
      offset: String(offset),
      pageSize: String(pageSize),
    });

    if (parsed.code === 1002) {
      await sleep(65000);
      continue;
    }

    if (parsed.code !== 0) {
      throw new Error(
        `Rewardoo Transaction API 错误 ${parsed.code}${parsed.message ? `: ${parsed.message}` : ''}`,
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
 * 按 62 天窗口拉取 TransactionDetails 全量行
 */
export async function fetchRewardooTransactionPages(
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
    const rows = await fetchRewardooTransactionChunk(
      apiToken,
      chunk.begin,
      chunk.end,
    );
    all.push(...rows);
  }

  return all;
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
