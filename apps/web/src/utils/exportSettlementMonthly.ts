import * as XLSX from 'xlsx';

export interface SettlementMonthlyExportPayload {
  month: string;
  usdCnyRate: number;
  rateNote: string;
  adSpendRows: Array<{ mccLabel: string; currency: string; spendUsd: number }>;
  adSpendTotalUsd: number;
  columns: Array<{ key: string; label: string; platformName: string }>;
  matrixRows: Array<{ rowKey: string; label: string; values: Record<string, number>; totalUsd: number }>;
  distributableProfitBookUsd: number;
  distributableProfitBookCny: number;
}

/**
 * 导出月度结算报表为 Excel（广告费 + 佣金矩阵两个 Sheet）
 */
export function exportSettlementMonthlyExcel(data: SettlementMonthlyExportPayload): void {
  const adRows = data.adSpendRows.map((r) => ({
    MCC: r.mccLabel,
    币种: r.currency,
    '广告费(USD)': r.spendUsd,
  }));
  adRows.push({
    MCC: '合计',
    币种: '',
    '广告费(USD)': data.adSpendTotalUsd,
  });

  const matrixHeader = ['行', ...data.columns.map((c) => c.label), '合计(USD)'];
  const matrixBody = data.matrixRows.map((row) => [
    row.label,
    ...data.columns.map((c) => row.values[c.key] ?? 0),
    row.totalUsd,
  ]);
  matrixBody.push([
    '可分配利润(账面佣金-广告费)',
    ...data.columns.map(() => ''),
    data.distributableProfitBookUsd,
  ]);
  matrixBody.push([
    `可分配利润(CNY, 汇率 ${data.usdCnyRate})`,
    ...data.columns.map(() => ''),
    data.distributableProfitBookCny,
  ]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(adRows), '广告费');
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([matrixHeader, ...matrixBody]),
    '佣金矩阵',
  );
  XLSX.writeFile(wb, `结算报表_${data.month}.xlsx`);
}
