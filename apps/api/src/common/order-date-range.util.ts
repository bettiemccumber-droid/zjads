/**
 * 联盟订单查询日期范围（含结束日全天，与报表一致）
 */
export function buildOrderDateRangeFilter(
  startDate?: string,
  endDate?: string,
): { gte?: Date; lte?: Date } | undefined {
  if (!startDate && !endDate) return undefined;
  const range: { gte?: Date; lte?: Date } = {};
  if (startDate) range.gte = new Date(`${startDate}T00:00:00.000Z`);
  if (endDate) range.lte = new Date(`${endDate}T23:59:59.999Z`);
  return range;
}
