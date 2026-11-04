import * as XLSX from 'xlsx';
import type { SettlementMonthlyExportPayload } from './exportSettlementMonthly';

export interface SettlementYearlyExportPayload extends SettlementMonthlyExportPayload {
  year: string;
  monthlyRows: Array<{
    month: string;
    adSpendUsd: number;
    bookCommissionUsd: number;
    rejectedCommissionUsd: number;
    receivableCommissionUsd: number;
    distributableProfitUsd: number;
  }>;
}

/**
 * 导出年度结算报表（月度趋势 + 整年广告费/佣金矩阵）
 */
export function exportSettlementYearlyExcel(data: SettlementYearlyExportPayload): void {
  const trendRows = data.monthlyRows.map((r) => ({
    月份: r.month,
    '广告费(USD)': r.adSpendUsd,
    '账面佣金(USD)': r.bookCommissionUsd,
    '失效佣金(USD)': r.rejectedCommissionUsd,
    '应收佣金(USD)': r.receivableCommissionUsd,
    '可分配利润(USD)': r.distributableProfitUsd,
  }));

  const adRows = data.adSpendRows.map((r) => ({
    MCC: r.mccLabel,
    币种: r.currency,
    '广告费(USD)': r.spendUsd,
  }));
  adRows.push({
    MCC: '年度合计',
    币种: '',
    '广告费(USD)': data.adSpendTotalUsd,
  });

  const matrixHeader = ['行', ...data.columns.map((c) => c.label), '合计(USD)'];
  const matrixBody = data.matrixRows.map((row) => [
    row.label,
    ...data.columns.map((c) => row.values[c.key] ?? 0),
    row.totalUsd,
  ]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(trendRows), '月度趋势');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(adRows), '广告费');
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([matrixHeader, ...matrixBody]),
    '佣金矩阵',
  );
  XLSX.writeFile(wb, `结算报表_${data.year}年度.xlsx`);
}
