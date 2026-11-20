/**
 * 促销节点日历（按自然年推算）。用于「节点推荐」时间轴。
 */

export interface PromoNodeDefinition {
  key: string;
  name: string;
  nameEn: string;
  description: string;
}

export interface PromoNodeOccurrence extends PromoNodeDefinition {
  date: string;
  daysUntil: number;
}

const NODE_DEFS: PromoNodeDefinition[] = [
  {
    key: 'thanksgiving',
    name: '感恩节',
    nameEn: 'Thanksgiving',
    description: '北美感恩节购物高峰，适合礼品、家居、服饰类提前备量。',
  },
  {
    key: 'black_friday',
    name: '黑色星期五',
    nameEn: 'Black Friday',
    description: '全年最大促销节点之一，建议提前确认商家活动与素材，抓住转化窗口。',
  },
  {
    key: 'cyber_monday',
    name: '网络星期一',
    nameEn: 'Cyber Monday',
    description: '线上折扣延续，电子、家居、服饰类仍有强需求。',
  },
  {
    key: 'christmas',
    name: '圣诞节',
    nameEn: 'Christmas',
    description: '礼品与季节性消费高峰，注意物流时效与礼品向文案。',
  },
  {
    key: 'new_year',
    name: '元旦',
    nameEn: "New Year's Day",
    description: '新年促销与清仓窗口，适合年货、生活用品与开年活动。',
  },
  {
    key: 'valentine',
    name: '情人节',
    nameEn: "Valentine's Day",
    description: '礼品、美妆、珠宝、鲜花等高转化节点。',
  },
  {
    key: 'easter',
    name: '复活节',
    nameEn: 'Easter',
    description: '春季礼品与家庭消费节点，欧美市场关注度高。',
  },
  {
    key: 'mothers_day',
    name: '母亲节',
    nameEn: "Mother's Day",
    description: '礼品、美妆、家居类需求旺盛。',
  },
  {
    key: 'fathers_day',
    name: '父亲节',
    nameEn: "Father's Day",
    description: '男士护理、数码、户外等品类机会较好。',
  },
  {
    key: 'singles_day',
    name: '双十一',
    nameEn: "Singles' Day",
    description: '亚洲购物大促，跨境与时尚品类可重点跟进。',
  },
  {
    key: 'halloween',
    name: '万圣节',
    nameEn: 'Halloween',
    description: '服饰、派对、家居装饰等季节性商品节点。',
  },
  {
    key: 'back_to_school',
    name: '返校季',
    nameEn: 'Back to School',
    description: '文具、服饰、电子产品等开学采购窗口。',
  },
];

/**
 * 列出从今天起一年内即将到来的促销节点（含今天），按日期升序。
 */
export function listUpcomingPromoNodes(now = new Date()): PromoNodeOccurrence[] {
  const today = utcDateOnly_(now);
  const years = [today.getUTCFullYear(), today.getUTCFullYear() + 1];
  const out: PromoNodeOccurrence[] = [];

  for (const year of years) {
    for (const def of NODE_DEFS) {
      const date = nodeDateForYear_(def.key, year);
      if (!date) continue;
      const daysUntil = diffUtcDays_(today, date);
      if (daysUntil < 0 || daysUntil > 400) continue;
      out.push({
        ...def,
        date: formatUtcDate_(date),
        daysUntil,
      });
    }
  }

  out.sort((a, b) => a.daysUntil - b.daysUntil || a.key.localeCompare(b.key));
  // 同年同节点只保留最近一次
  const seen = new Set<string>();
  return out.filter((row) => {
    if (seen.has(row.key)) return false;
    seen.add(row.key);
    return true;
  });
}

export function getPromoNodeDefinition(nodeKey: string): PromoNodeDefinition | null {
  const key = nodeKey.trim().toLowerCase();
  return NODE_DEFS.find((row) => row.key === key) ?? null;
}

export function listPromoNodeDefinitions(): PromoNodeDefinition[] {
  return NODE_DEFS.map((row) => ({ ...row }));
}

function nodeDateForYear_(key: string, year: number): Date | null {
  switch (key) {
    case 'thanksgiving':
      return nthWeekdayOfMonth_(year, 10, 4, 4); // Nov, Thursday, 4th
    case 'black_friday': {
      const thanks = nthWeekdayOfMonth_(year, 10, 4, 4);
      return thanks ? addUtcDays_(thanks, 1) : null;
    }
    case 'cyber_monday': {
      const thanks = nthWeekdayOfMonth_(year, 10, 4, 4);
      return thanks ? addUtcDays_(thanks, 4) : null;
    }
    case 'christmas':
      return utcYmd_(year, 11, 25);
    case 'new_year':
      return utcYmd_(year, 0, 1);
    case 'valentine':
      return utcYmd_(year, 1, 14);
    case 'easter':
      return westernEasterUtc_(year);
    case 'mothers_day':
      return nthWeekdayOfMonth_(year, 4, 0, 2); // May, Sunday, 2nd
    case 'fathers_day':
      return nthWeekdayOfMonth_(year, 5, 0, 3); // June, Sunday, 3rd
    case 'singles_day':
      return utcYmd_(year, 10, 11);
    case 'halloween':
      return utcYmd_(year, 9, 31);
    case 'back_to_school':
      return utcYmd_(year, 8, 1);
    default:
      return null;
  }
}

/** month 0-based；weekday 0=Sun…6=Sat；n 从 1 起 */
function nthWeekdayOfMonth_(year: number, month: number, weekday: number, n: number): Date {
  const first = utcYmd_(year, month, 1);
  const firstWeekday = first.getUTCDay();
  const offset = (weekday - firstWeekday + 7) % 7;
  return addUtcDays_(first, offset + (n - 1) * 7);
}

/** Anonymous Gregorian algorithm → UTC date */
function westernEasterUtc_(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utcYmd_(year, month, day);
}

function utcYmd_(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month, day));
}

function utcDateOnly_(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addUtcDays_(value: Date, days: number) {
  const next = new Date(value.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function diffUtcDays_(from: Date, to: Date) {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

function formatUtcDate_(value: Date) {
  return value.toISOString().slice(0, 10);
}
