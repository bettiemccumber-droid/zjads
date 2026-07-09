/** 联盟后台订单日期统一按 UTC+8 自然日入库（与 PartnerMatic / LinkBux API 一致） */
const UTC8_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 解析联盟订单日期：秒级时间戳转 UTC+8 自然日；`YYYY-MM-DD` 字符串按 UTC 零点存
 */
export function parseAffiliateOrderDateUtc8(
  orderTime: string | number | undefined | null,
): Date {
  if (orderTime == null || orderTime === '') return new Date();

  if (typeof orderTime === 'string' && orderTime.includes('-')) {
    const day = orderTime.split(' ')[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return new Date(`${day}T00:00:00.000Z`);
    }
  }

  const ts =
    (typeof orderTime === 'number' ? orderTime : parseInt(String(orderTime), 10)) * 1000;
  if (!Number.isFinite(ts)) return new Date();

  const d = new Date(ts + UTC8_OFFSET_MS);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Rewardoo transaction_details：时间戳按 UTC 自然日（与 affiliate 现网一致，不用 UTC+8）
 */
export function parseAffiliateOrderDateUtc(
  orderTime: string | number | undefined | null,
): Date {
  if (orderTime == null || orderTime === '') return new Date();

  if (typeof orderTime === 'string' && orderTime.includes('-')) {
    const day = orderTime.split(' ')[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return new Date(`${day}T00:00:00.000Z`);
    }
  }

  const raw = typeof orderTime === 'number' ? orderTime : parseInt(String(orderTime), 10);
  if (!Number.isFinite(raw) || raw <= 0) return new Date();

  const ts = raw < 1e12 ? raw * 1000 : raw;
  const day = new Date(ts).toISOString().slice(0, 10);
  return new Date(`${day}T00:00:00.000Z`);
}

/**
 * Rewardoo Performance Transaction Date → YYYY-MM-DD（东八区自然日，与 RW 后台 Daily 一致）
 */
export function parseRwPerformanceCalendarDay(
  value: string | number | undefined | null,
): string | null {
  if (value == null || value === '') return null;

  if (typeof value === 'string' && value.includes('-')) {
    const day = value.split(' ')[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  }

  const d = parseAffiliateOrderDateUtc8(value);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const out = `${y}-${m}-${day}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null;
}

/**
 * PostgreSQL @db.Date 等日期字段格式化为 YYYY-MM-DD（避免 toISOString 时区偏移）
 */
export function formatCalendarDateUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 订单日期是否落在报表查询区间（与 merchantSummary / campaignSummary 一致）
 */
export function isOrderDateInReportRange(
  orderDate: Date,
  startDate: string,
  endDate: string,
): boolean {
  const d = orderDate.toISOString().slice(0, 10);
  return d >= startDate && d <= endDate;
}
