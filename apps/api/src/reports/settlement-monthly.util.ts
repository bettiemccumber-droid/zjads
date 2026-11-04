/**
 * 自然月 YYYY-MM → 闭区间日期（UTC 日历日，与现有报表一致）
 */
export function monthToDateRange(month: string): { startDate: string; endDate: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(month.trim());
  if (!m) {
    throw new Error('month 格式须为 YYYY-MM');
  }
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) throw new Error('month 月份无效');
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const mm = String(mon).padStart(2, '0');
  return {
    startDate: `${year}-${mm}-01`,
    endDate: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`,
  };
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 自然年 YYYY → 闭区间日期
 */
export function yearToDateRange(year: string): { startDate: string; endDate: string } {
  const m = /^(\d{4})$/.exec(year.trim());
  if (!m) {
    throw new Error('year 格式须为 YYYY');
  }
  const y = Number(m[1]);
  if (y < 2000 || y > 2100) throw new Error('year 年份无效');
  return { startDate: `${y}-01-01`, endDate: `${y}-12-31` };
}

/** UTC 日历月 YYYY-MM */
export function utcMonthKey(d: Date): string {
  const y = d.getUTCFullYear();
  const mon = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${mon}`;
}
