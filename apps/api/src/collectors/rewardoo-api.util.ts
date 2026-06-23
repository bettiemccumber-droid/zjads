import axios from 'axios';

/** Rewardoo 媒体 API 基址（CommissionSummary 等） */
export const RW_API_BASE = 'https://admin.rewardoo.com/api.php';

/** 文档：单次查询跨度不得超过 62 天 */
export const RW_MAX_DAYS_PER_REQUEST = 62;

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

/**
 * 将日期区间按 Rewardoo API 上限（62 天）切分
 */
export function buildRwDateChunks(
  startDate: string,
  endDate: string,
  maxDays = RW_MAX_DAYS_PER_REQUEST,
): { payment_begin: string; payment_end: string }[] {
  const slots: { payment_begin: string; payment_end: string }[] = [];
  let cursor = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);

  while (cursor <= end) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + maxDays - 1);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());

    slots.push({
      payment_begin: cursor.toISOString().slice(0, 10),
      payment_end: chunkEnd.toISOString().slice(0, 10),
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
} {
  const root = body as RwApiEnvelope;
  const code = root.status?.code ?? -1;
  const message = String(root.status?.msg ?? '').trim();

  if (Array.isArray(root.list)) {
    return { code, message, rows: root.list };
  }
  if (Array.isArray(root.data)) {
    return { code, message, rows: root.data };
  }
  if (Array.isArray(body)) {
    return { code, message, rows: body };
  }

  return { code, message, rows: [] };
}

/**
 * 调用 Rewardoo CommissionSummary API
 * @see mod=commission&op=summary
 */
export async function postRewardooCommissionSummary(
  apiToken: string,
  paymentBegin: string,
  paymentEnd: string,
): Promise<unknown[]> {
  await throttleRwRequest();

  const params = new URLSearchParams({
    token: apiToken,
    payment_begin: paymentBegin,
    payment_end: paymentEnd,
  });

  const { data } = await axios.post<RwApiEnvelope>(
    `${RW_API_BASE}?mod=commission&op=summary`,
    params.toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 120000,
      validateStatus: () => true,
    },
  );

  const parsed = parseRwApiEnvelope(data);
  if (parsed.code !== 0) {
    throw new Error(
      `Rewardoo API 错误 ${parsed.code}${parsed.message ? `: ${parsed.message}` : ''}`,
    );
  }

  return parsed.rows;
}

/**
 * 按 62 天窗口拉取 CommissionSummary 全量行
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
      chunk.payment_begin,
      chunk.payment_end,
    );
    all.push(...rows);
  }

  return all;
}
