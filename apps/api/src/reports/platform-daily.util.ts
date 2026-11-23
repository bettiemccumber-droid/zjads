/**
 * 平台日报：把商家×日行聚合成按天汇总（纯函数，便于单测）。
 */

export type PlatformDailyRowInput = {
  clickDate: Date | string;
  clicks: number;
  performanceOrders: number;
  performanceCommission: number | string;
};

export type PlatformDailyDay = {
  date: string;
  clicks: number;
  orders: number;
  commission: number;
};

export type PlatformDailyTotals = {
  clicks: number;
  orders: number;
  commission: number;
};

/** 生成闭区间内的 YYYY-MM-DD（UTC 日历日） */
export function listDatesInRange(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(cur.getTime()) || Number.isNaN(end.getTime()) || cur > end) return out;
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function dateKey(value: Date | string): string {
  if (typeof value === 'string') {
    return value.slice(0, 10);
  }
  return value.toISOString().slice(0, 10);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 按 clickDate 汇总；补齐区间内无数据日期为 0；返回新→旧。
 */
export function aggregatePlatformDaily(
  rows: PlatformDailyRowInput[],
  startDate: string,
  endDate: string,
): { days: PlatformDailyDay[]; totals: PlatformDailyTotals } {
  const map = new Map<string, PlatformDailyDay>();
  for (const row of rows) {
    const date = dateKey(row.clickDate);
    const prev = map.get(date) ?? { date, clicks: 0, orders: 0, commission: 0 };
    prev.clicks += Number(row.clicks) || 0;
    prev.orders += Number(row.performanceOrders) || 0;
    prev.commission += Number(row.performanceCommission) || 0;
    map.set(date, prev);
  }

  const days = listDatesInRange(startDate, endDate)
    .map((date) => {
      const hit = map.get(date);
      return {
        date,
        clicks: hit?.clicks ?? 0,
        orders: hit?.orders ?? 0,
        commission: roundMoney(hit?.commission ?? 0),
      };
    })
    .reverse();

  const totals = days.reduce<PlatformDailyTotals>(
    (acc, day) => ({
      clicks: acc.clicks + day.clicks,
      orders: acc.orders + day.orders,
      commission: roundMoney(acc.commission + day.commission),
    }),
    { clicks: 0, orders: 0, commission: 0 },
  );

  return { days, totals };
}
