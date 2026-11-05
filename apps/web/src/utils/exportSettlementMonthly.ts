import * as XLSX from 'xlsx';

export interface SettlementMonthlyExportPayload {
  month: string;
  usdCnyRate: number;
  rateNote: string;
  adSpendRows: Array<{
    mccLabel: string;
    currency: string;
    librarySpendUsd?: number;
    adjustmentUsd?: number;
    spendUsd: number;
  }>;
  adSpendTotalUsd: number;
  columns: Array<{ key: string; label: string; platformName: string }>;
  matrixRows: Array<{
    rowKey: string;
    label: string;
    rowType?: 'money' | 'text';
    values: Record<string, number>;
    textValues?: Record<string, string>;
    totalUsd: number;
  }>;
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
    '库内广告费': r.librarySpendUsd ?? r.spendUsd,
    '补充金额($)': r.adjustmentUsd ?? 0,
    '广告费(可改)': r.spendUsd,
    '折美金($)': r.spendUsd,
  }));
  adRows.push({
    MCC: '合计',
    币种: '',
    '库内广告费': 0,
    '补充金额($)': 0,
    '广告费(可改)': data.adSpendTotalUsd,
    '折美金($)': data.adSpendTotalUsd,
  });

  const matrixHeader = ['行', ...data.columns.map((c) => c.label), '合计(USD)'];
  const matrixBody = data.matrixRows.map((row) => [
    row.label,
    ...data.columns.map((c) =>
      row.rowType === 'text' ? (row.textValues?.[c.key] ?? '') : (row.values[c.key] ?? 0),
    ),
    row.rowType === 'text' ? '' : row.totalUsd,
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
