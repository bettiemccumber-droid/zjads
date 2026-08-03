import ExcelJS from 'exceljs';

export interface MerchantStatusExportRow {
  queryKey: string;
  merchantId: string | null;
  mcid: string | null;
  merchantName: string | null;
  siteUrl: string | null;
  platformName: string;
  channelDisplayName: string;
  affiliateAlias: string;
  ownerUsername?: string;
  relationshipStatus: string;
  relationshipRaw: string | null;
  merchantAvailability: string;
  availabilityRaw: string | null;
  actionLabel: string;
  error: string | null;
  queriedAt: string;
}

/**
 * 导出商家状态查询结果
 */
export async function exportMerchantStatusExcel(
  rows: MerchantStatusExportRow[],
  filenamePrefix: string,
  includeOwner: boolean,
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('商家状态查询');

  const headers = [
    '查询键',
    '商家ID',
    'mcid',
    '商家名',
    '网址',
    ...(includeOwner ? ['员工'] : []),
    '平台',
    '渠道账号',
    '联盟序号',
    '账号关系',
    '关系(原始)',
    '上架状态',
    '状态(原始)',
    '投前建议',
    '错误信息',
    '查询时间',
  ];

  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };

  for (const r of rows) {
    ws.addRow([
      r.queryKey,
      r.merchantId ?? '',
      r.mcid ?? '',
      r.merchantName ?? '',
      r.siteUrl ?? '',
      ...(includeOwner ? [r.ownerUsername ?? ''] : []),
      r.platformName,
      r.channelDisplayName,
      r.affiliateAlias,
      r.relationshipStatus,
      r.relationshipRaw ?? '',
      r.merchantAvailability,
      r.availabilityRaw ?? '',
      r.actionLabel,
      r.error ?? '',
      r.queriedAt,
    ]);
  }

  ws.columns.forEach((col) => {
    col.width = 16;
  });

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filenamePrefix}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
  return buffer;
}
