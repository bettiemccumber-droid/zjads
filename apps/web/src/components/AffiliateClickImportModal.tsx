import { useState } from 'react';
import { Alert, Modal, Upload, message } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { api, type ApiResult } from '../api/client';
import {
  AFFILIATE_CLICK_CSV_TEMPLATE,
  RW_PERFORMANCE_CSV_TEMPLATE,
  parseAffiliateClickFile,
  type ImportClickRow,
} from '../utils/parseAffiliateClickImport';

interface Props {
  open: boolean;
  accountId: number;
  accountLabel: string;
  /** linkbux | rewardoo */
  platformCode?: string;
  onClose: () => void;
}

/**
 * 联盟 Performance 手动校准导入（LB 点击 / RW 点击+订单；不覆盖佣金）
 */
export function AffiliateClickImportModal({
  open,
  accountId,
  accountLabel,
  platformCode = 'linkbux',
  onClose,
}: Props) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<ImportClickRow[]>([]);
  const isRw = platformCode === 'rewardoo';

  const submit = async (rows: ImportClickRow[]) => {
    setUploading(true);
    try {
      const { data } = await api.post<
        ApiResult<{
          imported: number;
          totalClicks: number;
          totalOrders: number;
          minDate: string | null;
          maxDate: string | null;
        }>
      >(`/channel-accounts/${accountId}/clicks/import`, { rows });
      if (data.success) {
        message.success(data.message ?? '导入成功');
        setPreview([]);
        onClose();
      } else {
        message.error(data.message);
      }
    } finally {
      setUploading(false);
    }
  };

  const handleFile = async (file: File) => {
    try {
      const rows = await parseAffiliateClickFile(file);
      setPreview(rows);
      const orderTotal = rows.reduce((s, r) => s + (r.performanceOrders ?? 0), 0);
      message.info(
        `已解析 ${rows.length} 行${orderTotal > 0 ? `，合计 ${orderTotal} 单` : ''}`,
      );
    } catch (e) {
      message.error(e instanceof Error ? e.message : '解析失败');
    }
    return false;
  };

  const downloadTemplate = () => {
    const content = isRw ? RW_PERFORMANCE_CSV_TEMPLATE : AFFILIATE_CLICK_CSV_TEMPLATE;
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = isRw ? 'rw-performance-calibration-template.csv' : 'affiliate-clicks-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const previewOrders = preview.reduce((s, r) => s + (r.performanceOrders ?? 0), 0);
  const previewClicks = preview.reduce((s, r) => s + r.clicks, 0);

  return (
    <Modal
      title={`Performance 校准导入 · ${accountLabel}`}
      open={open}
      onCancel={() => {
        setPreview([]);
        onClose();
      }}
      onOk={() => preview.length && void submit(preview)}
      okText={preview.length ? `导入 ${preview.length} 行` : '请先上传文件'}
      okButtonProps={{ disabled: !preview.length, loading: uploading }}
      width={680}
      destroyOnClose
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={isRw ? 'Rewardoo Performance 校准' : 'LinkBux 点击校准'}
        description={
          isRw ? (
            <>
              从 RW 后台 Performance（Group by Daily，按商家筛选）导出 CSV/Excel，须含
              <strong> Date、Clicks、Orders、MID</strong>
              （若导出无 MID，请在 Excel 加一列 merchantId）。
              仅校准<strong>联盟点击与订单数</strong>，<strong>不会修改佣金</strong>。
              导入后标记为「校准数据」，后续 API 采集不会覆盖。{' '}
              <a onClick={downloadTemplate}>下载模板</a>
            </>
          ) : (
            <>
              从 LinkBux 后台 CPS Performance 导出 CSV 或 Excel（.xlsx）直接上传。
              导入后标记为「校准数据」，后续 API 采集不会覆盖。{' '}
              <a onClick={downloadTemplate}>下载模板</a>
            </>
          )
        }
      />
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message="导入说明"
        description={
          isRw
            ? '支持 RW 后台导出的 .xlsx（列：Date / Clicks / Orders / MID 等），或 CSV。Total 汇总行会自动跳过。日期支持 YYYY-MM-DD 与 MM/DD/YYYY。'
            : '支持 LinkBux 后台原样导出的 .xlsx（列：Merchant Name / MID / Date / Clicks），或 CSV。Total 汇总行会自动跳过。'
        }
      />
      {isRw ? (
        <p style={{ marginBottom: 12, color: '#666', fontSize: 13 }}>
          提示：Halfords 等单商家系列，导出时在后台先筛选该 Merchant，再在表格中补一列 MID（与广告系列
          merchantId 一致）。
        </p>
      ) : null}
      <Upload.Dragger
        accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        multiple={false}
        beforeUpload={handleFile}
        showUploadList={false}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">点击或拖拽 CSV / Excel 文件</p>
        <p className="ant-upload-hint">
          {isRw
            ? '须含 Date、Clicks、Orders、MID（佣金无需导入）'
            : 'LinkBux 导出 .xlsx 可直接上传；CSV 列名支持 MID、Date、Clicks'}
        </p>
      </Upload.Dragger>
      {preview.length > 0 && (
        <p style={{ marginTop: 12, color: '#666' }}>
          已解析 {preview.length} 行，点击 {previewClicks} 次
          {previewOrders > 0 ? `，订单 ${previewOrders} 单` : ''}
          {preview[0]?.clickDate && preview[preview.length - 1]?.clickDate
            ? `（${preview[0].clickDate} ~ ${preview[preview.length - 1].clickDate}）`
            : ''}
        </p>
      )}
    </Modal>
  );
}
