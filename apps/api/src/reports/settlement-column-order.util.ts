/** 竞品常见联盟序号列顺序（未出现的 alias 排在后面按字母序） */
const DEFAULT_ALIAS_ORDER = ['rw1', 'rw2', 'lh', 'cg', 'lb1', 'lb2', 'pm'];

/**
 * 解析环境变量 SETTLEMENT_ALIAS_ORDER（逗号分隔）或使用默认顺序
 */
export function resolveSettlementAliasOrder(): string[] {
  const raw = process.env.SETTLEMENT_ALIAS_ORDER?.trim();
  if (!raw) return DEFAULT_ALIAS_ORDER;
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * 按竞品列序排序 matrix 列
 */
export function sortSettlementColumns<T extends { key: string; affiliateAlias: string }>(
  columns: T[],
): T[] {
  const order = resolveSettlementAliasOrder();
  const rank = (alias: string) => {
    const i = order.indexOf(alias.toLowerCase());
    return i >= 0 ? i : order.length + 1;
  };
  return [...columns].sort((a, b) => {
    const ra = rank(a.affiliateAlias);
    const rb = rank(b.affiliateAlias);
    if (ra !== rb) return ra - rb;
    return a.key.localeCompare(b.key);
  });
}
