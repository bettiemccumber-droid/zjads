/** 上海时区自然日 YYYY-MM-DD */
export function shanghaiDateYmd(base = new Date()): string {
  return base.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
}

/** 在上海日历上偏移 days 天 */
export function shanghaiDateYmdAddDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
  const utc = Date.UTC(y, m - 1, d);
  const next = new Date(utc + days * 86400000);
  return next.toISOString().slice(0, 10);
}

/**
 * 定时采集默认区间：近 lookbackDays 个自然日（含今天，上海时区）
 */
export function scheduledSyncDateRange(lookbackDays: number): {
  startDate: string;
  endDate: string;
} {
  const safeDays = Math.min(Math.max(lookbackDays, 1), 120);
  const endDate = shanghaiDateYmd();
  const startDate = shanghaiDateYmdAddDays(endDate, -(safeDays - 1));
  return { startDate, endDate };
}
