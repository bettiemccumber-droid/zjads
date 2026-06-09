import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';

export interface MerchantAnalysisExportItem {
  rank: number;
  merchantId: string;
  totalBudget: number;
  totalCost: number;
  totalCommission: number;
  totalOrders: number;
  roi: number;
  campaigns: Array<{
    username: string;
    campaignName: string;
    campaignId: string;
    affiliateAlias: string;
    dailyBudget: number;
    impressions: number;
    clicks: number;
    cost: number;
    orderCount: number;
    commission: number;
    cr: number;
    epc: number;
    cpc: number;
    roi: number;
  }>;
}

const MERCHANT_SHEET_COLS = 13;

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
};

const MONEY_FMT = '$#,##0.00';
const PCT_FMT = '0.00"%"';
const NUM_FMT = '#,##0';
const ROI_FMT = '0.00';

/** 汇总行深蓝底 */
const SUMMARY_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1E3A5F' },
};

/** ROI 正数绿色 */
function roiFont(roi: number): Partial<ExcelJS.Font> {
  if (roi >= 1) return { color: { argb: 'FF16A34A' }, bold: true };
  if (roi >= 0) return { color: { argb: 'FFCA8A04' } };
  return { color: { argb: 'FFDC2626' } };
}

/**
 * 写入单元格并应用边框
 */
function setCell(
  cell: ExcelJS.Cell,
  value: ExcelJS.CellValue,
  opts?: { font?: Partial<ExcelJS.Font>; fill?: ExcelJS.Fill; numFmt?: string; align?: 'left' | 'center' | 'right' },
) {
  cell.value = value;
  cell.border = THIN_BORDER;
  cell.alignment = { vertical: 'middle', horizontal: opts?.align ?? 'center' };
  if (opts?.font) cell.font = opts.font;
  if (opts?.fill) cell.fill = opts.fill;
  if (opts?.numFmt) cell.numFmt = opts.numFmt;
}

/**
 * 触发浏览器下载
 */
function downloadExcelBuffer(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * 导出商家分析：单表层级结构（商家汇总行 + 系列明细行），样式对齐参考后台
 */
export async function exportMerchantAnalysisExcel(
  items: MerchantAnalysisExportItem[],
  startDate: string,
  endDate: string,
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('平台商家分析', {
    views: [{ state: 'frozen', ySplit: 3, activeCell: 'A4' }],
  });

  ws.mergeCells(1, 1, 1, MERCHANT_SHEET_COLS);
  setCell(ws.getCell(1, 1), '平台商家分析', {
    font: { bold: true, size: 16 },
    align: 'center',
  });
  ws.getRow(1).height = 32;

  ws.mergeCells(2, 1, 2, MERCHANT_SHEET_COLS);
  setCell(ws.getCell(2, 1), `日期范围: ${startDate} 至 ${endDate}`, { align: 'center' });
  ws.getRow(2).height = 22;

  const headers = ['商家ID', '用户', '广告系列', '预算', '展示', '点击', '广告费', '订单', '佣金', 'CR', 'EPC', 'CPC', 'ROI'];
  const headerRow = ws.getRow(3);
  headerRow.height = 24;
  headers.forEach((label, i) => {
    setCell(headerRow.getCell(i + 1), label, {
      font: { bold: true, color: { argb: 'FF1E293B' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } },
    });
  });

  let rowIdx = 4;

  for (const m of items) {
    const totalImpressions = m.campaigns.reduce((s, c) => s + c.impressions, 0);
    const totalClicks = m.campaigns.reduce((s, c) => s + c.clicks, 0);
    const cr = totalClicks > 0 ? (m.totalOrders / totalClicks) * 100 : 0;
    const epc = totalClicks > 0 ? m.totalCommission / totalClicks : 0;
    const cpc = totalClicks > 0 ? m.totalCost / totalClicks : 0;

    const sumRow = ws.getRow(rowIdx);
    sumRow.height = 26;
    ws.mergeCells(rowIdx, 1, rowIdx, 3);
    setCell(sumRow.getCell(1), `商家ID: ${m.merchantId} 汇总`, {
      font: { bold: true, color: { argb: 'FFFFFFFF' } },
      fill: SUMMARY_FILL,
      align: 'left',
    });
    for (let c = 2; c <= 3; c++) {
      sumRow.getCell(c).fill = SUMMARY_FILL;
      sumRow.getCell(c).border = THIN_BORDER;
    }

    const summaryMetrics: Array<{ col: number; value: number; fmt: string; roi?: boolean }> = [
      { col: 4, value: m.totalBudget, fmt: MONEY_FMT },
      { col: 5, value: totalImpressions, fmt: NUM_FMT },
      { col: 6, value: totalClicks, fmt: NUM_FMT },
      { col: 7, value: m.totalCost, fmt: MONEY_FMT },
      { col: 8, value: m.totalOrders, fmt: NUM_FMT },
      { col: 9, value: m.totalCommission, fmt: MONEY_FMT },
      { col: 10, value: cr, fmt: PCT_FMT },
      { col: 11, value: epc, fmt: MONEY_FMT },
      { col: 12, value: cpc, fmt: MONEY_FMT },
      { col: 13, value: m.roi, fmt: ROI_FMT, roi: true },
    ];

    for (const metric of summaryMetrics) {
      const cell = sumRow.getCell(metric.col);
      const font = metric.roi
        ? { bold: true, ...roiFont(metric.value) }
        : { bold: true, color: { argb: 'FFFFFFFF' } };
      setCell(cell, metric.value, {
        font,
        fill: SUMMARY_FILL,
        numFmt: metric.fmt,
      });
    }

    rowIdx++;

    for (const c of m.campaigns) {
      const detailRow = ws.getRow(rowIdx);
      detailRow.height = 22;
      const userLabel = c.affiliateAlias ? `${c.username}, ${c.affiliateAlias}` : c.username;

      setCell(detailRow.getCell(1), m.merchantId, { align: 'center' });
      setCell(detailRow.getCell(2), userLabel, { align: 'left' });
      setCell(detailRow.getCell(3), c.campaignName || c.campaignId, { align: 'left' });
      setCell(detailRow.getCell(4), c.dailyBudget, { numFmt: MONEY_FMT });
      setCell(detailRow.getCell(5), c.impressions, { numFmt: NUM_FMT });
      setCell(detailRow.getCell(6), c.clicks, { numFmt: NUM_FMT });
      setCell(detailRow.getCell(7), c.cost, { numFmt: MONEY_FMT });
      setCell(detailRow.getCell(8), c.orderCount, { numFmt: NUM_FMT });
      setCell(detailRow.getCell(9), c.commission, { numFmt: MONEY_FMT });
      setCell(detailRow.getCell(10), c.cr, { numFmt: PCT_FMT });
      setCell(detailRow.getCell(11), c.epc, { numFmt: MONEY_FMT });
      setCell(detailRow.getCell(12), c.cpc, { numFmt: MONEY_FMT });
      setCell(detailRow.getCell(13), c.roi, { numFmt: ROI_FMT, font: roiFont(c.roi) });

      rowIdx++;
    }
  }

  ws.columns = [
    { width: 14 },
    { width: 16 },
    { width: 42 },
    { width: 10 },
    { width: 10 },
    { width: 10 },
    { width: 11 },
    { width: 8 },
    { width: 11 },
    { width: 10 },
    { width: 10 },
    { width: 10 },
    { width: 8 },
  ];

  const buffer = await wb.xlsx.writeBuffer();
  downloadExcelBuffer(buffer, `平台商家分析_${startDate}_${endDate}.xlsx`);
}

export interface PlatformOverviewExportData {
  users: {
    total: number;
    active: number;
    channelAccountCount: number;
    adSourceCount: number;
  };
  orders: {
    orderCount: number;
    totalCommission: number;
    pendingCommission: number;
    rejectedCommission: number;
  };
  ads: {
    totalAdSpend: number;
    impressions: number;
    clicks: number;
    overallRoi: number;
  };
  revenue: {
    totalCommission: number;
    totalAdSpend: number;
    profit: number;
  };
  byEmployee: Array<{
    username: string;
    orderCount: number;
    totalCommission: number;
    totalAdSpend: number;
    profit: number;
    roi: number;
    rejectedCommission: number;
  }>;
}

/**
 * 导出平台概览为 Excel（汇总指标 + 员工对比）
 */
export function exportPlatformOverviewExcel(
  data: PlatformOverviewExportData,
  startDate: string,
  endDate: string,
): void {
  const summaryRows = [
    { 指标: '总用户', 数值: data.users.total },
    { 指标: '活跃员工', 数值: data.users.active },
    { 指标: '平台账号', 数值: data.users.channelAccountCount },
    { 指标: '广告 Sheet', 数值: data.users.adSourceCount },
    { 指标: '总订单', 数值: data.orders.orderCount },
    { 指标: '总佣金', 数值: data.orders.totalCommission },
    { 指标: '待确认佣金', 数值: data.orders.pendingCommission },
    { 指标: '失效/拒绝佣金', 数值: data.orders.rejectedCommission },
    { 指标: '总广告费', 数值: data.ads.totalAdSpend },
    { 指标: '展示', 数值: data.ads.impressions },
    { 指标: '点击', 数值: data.ads.clicks },
    { 指标: '整体 ROI', 数值: data.ads.overallRoi },
    { 指标: '净利润', 数值: data.revenue.profit },
  ];

  const employeeRows = data.byEmployee.map((e) => ({
    员工: e.username,
    订单: e.orderCount,
    佣金: e.totalCommission,
    广告费: e.totalAdSpend,
    利润: e.profit,
    ROI: e.roi,
    失效佣金: e.rejectedCommission,
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), '平台汇总');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(employeeRows), '员工对比');
  XLSX.writeFile(wb, `平台统计_${startDate}_${endDate}.xlsx`);
}
