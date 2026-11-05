import axios from 'axios';
import type { NetworkV2PaymentDetailRow } from './network-v2-payment-details.util';

/** V2 文档：每分钟最多 10 次 */
const MIN_REQUEST_INTERVAL_MS = 6500;
const throttleByHost = new Map<string, number>();

async function throttleV2PaymentRequest(hostKey: string) {
  const last = throttleByHost.get(hostKey) ?? 0;
  const now = Date.now();
  const wait = last + MIN_REQUEST_INTERVAL_MS - now;
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  throttleByHost.set(hostKey, Date.now());
}

/**
 * V2 Payment Detail 文档字段为 snake_case（paid_date_begin 等）
 */
export function toV2PaymentDetailRequestBody(
  body: Record<string, string | number>,
): Record<string, string | number> {
  const keyMap: Record<string, string> = {
    paidDateBegin: 'paid_date_begin',
    paidDateEnd: 'paid_date_end',
    validationDateBegin: 'validation_date_begin',
    validationDateEnd: 'validation_date_end',
    requestDateBegin: 'request_date_begin',
    requestDateEnd: 'request_date_end',
  };
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(body)) {
    out[keyMap[k] ?? k] = v;
  }
  return out;
}

function assertV2Success(body: unknown, context: string, networkLabel: string): void {
  const root = body as Record<string, unknown>;
  const code = root.code;
  if (code === 0 || code === '0') return;
  const msg = String(root.message ?? root.msg ?? `${networkLabel} API 错误`);
  throw new Error(`${context}: ${msg} (code=${String(code)})`);
}

function extractV2List(body: unknown): { list: NetworkV2PaymentDetailRow[]; totalPages: number } {
  const root = body as Record<string, unknown>;
  const data = root.data as Record<string, unknown> | undefined;
  const list = Array.isArray(data?.list) ? (data.list as NetworkV2PaymentDetailRow[]) : [];
  const totalItems = Number(data?.total_items ?? list.length);
  const perPage = Number(data?.limit ?? data?.per_page ?? 2000) || 2000;
  const totalPages = Math.max(1, Number(data?.total_page) || Math.ceil(totalItems / perPage) || 1);
  return { list, totalPages };
}

/**
 * 分页拉取 V2 Payment Detail（POST JSON）
 */
export async function fetchNetworkV2PaymentDetailAll(
  config: { detailUrl: string; source: string; networkLabel: string },
  token: string,
  body: Record<string, string | number>,
): Promise<NetworkV2PaymentDetailRow[]> {
  const hostKey = config.detailUrl;
  const all: NetworkV2PaymentDetailRow[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= 200) {
    await throttleV2PaymentRequest(hostKey);

    const payload = {
      source: config.source,
      token: token.trim(),
      curPage: page,
      perPage: 2000,
      ...toV2PaymentDetailRequestBody(body),
    };

    const { data } = await axios.post(config.detailUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000,
      validateStatus: () => true,
    });

    assertV2Success(data, 'Payment Detail', config.networkLabel);
    const result = extractV2List(data);
    all.push(...result.list);
    totalPages = result.totalPages;
    if (!result.list.length || result.list.length < 2000) break;
    page += 1;
  }

  return all;
}
