/**
 * 平台日报：订单佣金/拒付 + 广告点击/花费按天合并（纯函数，便于单测）。
 */

export type PlatformDailyOrderInput = {
  orderDate: Date | string;
  /** 同日去重键：通常 channelAccountId|dedupeOrderId */
  orderKey: string;
  commission: number | string;
  /** 拒付佣金（默认 0） */
  rejected?: number | string;
};

export type PlatformDailyClickInput = {
  clickDate: Date | string;
  /** 联盟点击（平台日报主口径已改用广告点击，此字段仅 RW performance 旁路仍可带） */
  clicks?: number;
  /** RW Performance 口径订单/佣金（其它平台可省略） */
  performanceOrders?: number;
  performanceCommission?: number | string;
};

export type PlatformDailyAdInput = {
  date: Date | string;
  clicks: number;
  cost: number | string;
};

export type PlatformDailyDay = {
  date: string;
  clicks: number;
  orders: number;
  cost: number;
  commission: number;
  rejected: number;
  profit: number;
};

export type PlatformDailyTotals = {
  clicks: number;
  orders: number;
  cost: number;
  commission: number;
  rejected: number;
  profit: number;
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

function emptyDay(date: string): PlatformDailyDay {
  return {
    date,
    clicks: 0,
    orders: 0,
    cost: 0,
    commission: 0,
    rejected: 0,
    profit: 0,
  };
}

/**
 * 合并订单、拒付与广告点击/花费：按天补齐区间，新→旧。
 * @param usePerformanceMetrics true 时订单/佣金用 click 行的 performance*（RW）
 */
export function mergePlatformDaily(input: {
  startDate: string;
  endDate: string;
  orderRows?: PlatformDailyOrderInput[];
  clickRows?: PlatformDailyClickInput[];
  adRows?: PlatformDailyAdInput[];
  usePerformanceMetrics?: boolean;
}): { days: PlatformDailyDay[]; totals: PlatformDailyTotals } {
  const map = new Map<string, PlatformDailyDay>();
  const ensure = (date: string) => {
    const prev = map.get(date);
    if (prev) return prev;
    const next = emptyDay(date);
    map.set(date, next);
    return next;
  };

  for (const row of input.adRows ?? []) {
    const day = ensure(dateKey(row.date));
    day.clicks += Number(row.clicks) || 0;
    day.cost += Number(row.cost) || 0;
  }

  if (input.usePerformanceMetrics) {
    for (const row of input.clickRows ?? []) {
      const day = ensure(dateKey(row.clickDate));
      day.orders += Number(row.performanceOrders) || 0;
      day.commission += Number(row.performanceCommission) || 0;
    }
  }

  const seenOrderKeys = new Set<string>();
  for (const row of input.orderRows ?? []) {
    const date = dateKey(row.orderDate);
    const day = ensure(date);
    const rejected = Number(row.rejected) || 0;
    day.rejected += rejected;

    if (input.usePerformanceMetrics) {
      continue;
    }

    const commission = Number(row.commission) || 0;
    const dedupeKey = `${date}|${row.orderKey}`;
    if (!seenOrderKeys.has(dedupeKey)) {
      seenOrderKeys.add(dedupeKey);
      day.orders += 1;
    }
    day.commission += commission;
  }

  const days = listDatesInRange(input.startDate, input.endDate)
    .map((date) => {
      const hit = map.get(date);
      const commission = roundMoney(hit?.commission ?? 0);
      const rejected = roundMoney(hit?.rejected ?? 0);
      const cost = roundMoney(hit?.cost ?? 0);
      return {
        date,
        clicks: hit?.clicks ?? 0,
        orders: hit?.orders ?? 0,
        cost,
        commission,
        rejected,
        profit: roundMoney(commission - rejected - cost),
      };
    })
    .reverse();

  const totals = days.reduce<PlatformDailyTotals>(
    (acc, day) => ({
      clicks: acc.clicks + day.clicks,
      orders: acc.orders + day.orders,
      cost: roundMoney(acc.cost + day.cost),
      commission: roundMoney(acc.commission + day.commission),
      rejected: roundMoney(acc.rejected + day.rejected),
      profit: roundMoney(acc.profit + day.profit),
    }),
    { clicks: 0, orders: 0, cost: 0, commission: 0, rejected: 0, profit: 0 },
  );

  return { days, totals };
}

/**
 * @deprecated 兼容旧单测调用；请用 mergePlatformDaily
 */
export function aggregatePlatformDaily(
  rows: Array<{
    clickDate: Date | string;
    clicks: number;
    performanceOrders: number;
    performanceCommission: number | string;
  }>,
  startDate: string,
  endDate: string,
): { days: PlatformDailyDay[]; totals: PlatformDailyTotals } {
  return mergePlatformDaily({
    startDate,
    endDate,
    clickRows: rows,
    usePerformanceMetrics: true,
  });
}
