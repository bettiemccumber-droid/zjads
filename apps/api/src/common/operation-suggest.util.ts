/**
 * 根据 ROI / 花费 / 订单给出操作建议（对齐徐版 Sheet 习惯）
 */
export function suggestOperation(roi: number, orderCount: number, adCost: number): string {
  if (adCost > 0 && orderCount === 0) {
    return '考虑暂停';
  }
  if (roi >= 1) {
    return '维持现状';
  }
  if (roi >= 0) {
    return '观察优化';
  }
  return '考虑暂停';
}
