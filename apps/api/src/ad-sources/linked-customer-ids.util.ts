/**
 * 解析广告数据源绑定的 Google 子账号 ID 列表
 */
export function parseLinkedCustomerIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0))];
}
