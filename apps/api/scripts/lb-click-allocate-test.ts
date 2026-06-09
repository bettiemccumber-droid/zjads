/**
 * allocateLbDayClickCounts 单元测试（无需 API）
 */
import { allocateLbDayClickCounts } from '../src/collectors/linkbux-clicks';
import type { PmMerchantClickAgg } from '../src/collectors/partnermatic-clicks';

function assertEq(label: string, actual: number, expected: number) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function sum(rows: PmMerchantClickAgg[]) {
  return rows.reduce((s, r) => s + r.clicks, 0);
}

function testDivaniCompleteInSample() {
  const rows: PmMerchantClickAgg[] = [
    { merchantId: '388783', merchantName: 'Divani', clickDate: '2026-06-01', clicks: 1071 },
    { merchantId: '100', merchantName: 'Other', clickDate: '2026-06-01', clicks: 929 },
  ];
  allocateLbDayClickCounts(rows, 3440, '2026-06-01');
  assertEq('divani', rows.find((r) => r.merchantId === '388783')!.clicks, 1071);
  assertEq('total', sum(rows), 3440);
}

function testDivaniDominantInSample() {
  const rows: PmMerchantClickAgg[] = [
    { merchantId: '388783', merchantName: 'Divani', clickDate: '2026-06-06', clicks: 1595 },
    { merchantId: '100', merchantName: 'Other', clickDate: '2026-06-06', clicks: 405 },
  ];
  allocateLbDayClickCounts(rows, 3974, '2026-06-06');
  const divani = rows.find((r) => r.merchantId === '388783')!.clicks;
  if (divani < 3140 || divani > 3190) {
    throw new Error(`06-06 divani out of range: ${divani}`);
  }
}

testDivaniCompleteInSample();
testDivaniDominantInSample();
console.log('allocateLbDayClickCounts tests ok');
