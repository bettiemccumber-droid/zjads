import { useState } from 'react';
import { Alert, Modal, Upload, message } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { api, type ApiResult } from '../api/client';
import {
  AFFILIATE_CLICK_CSV_TEMPLATE,
  parseAffiliateClickFile,
  type ImportClickRow,
} from '../utils/parseAffiliateClickImport';

interface Props {
  open: boolean;
  accountId: number;
  accountLabel: string;
  onClose: () => void;
}

/**
 * LinkBux 等联盟点击手动校准导入（历史数据补齐）
 */
export function AffiliateClickImportModal({ open, accountId, accountLabel, onClose }: Props) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<ImportClickRow[]>([]);

  const submit = async (rows: ImportClickRow[]) => {
    setUploading(true);
    try {
      const { data } = await api.post<
        ApiResult<{ imported: number; totalClicks: number; minDate: string | null; maxDate: string | null }>
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
      message.info(`已解析 ${rows.length} 行，请确认后导入`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '解析失败');
    }
    return false;
  };

  const downloadTemplate = () => {
    const blob = new Blob([AFFILIATE_CLICK_CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'affiliate-clicks-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal
      title={`点击校准导入 · ${accountLabel}`}
      open={open}
      onCancel={() => {
        setPreview([]);
        onClose();
      }}
      onOk={() => preview.length && void submit(preview)}
      okText={preview.length ? `导入 ${preview.length} 行` : '请先上传 CSV'}
      okButtonProps={{ disabled: !preview.length, loading: uploading }}
      width={640}
      destroyOnClose
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="历史数据补齐"
        description={
          <>
            从 LinkBux 后台 CPS Performance 导出 CSV 或 Excel（.xlsx）直接上传。
            导入后标记为「校准数据」，后续 API 采集不会覆盖。
            {' '}
            <a onClick={downloadTemplate}>下载模板</a>
          </>
        }
      />
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message="导入说明"
        description="支持 LinkBux 后台原样导出的 .xlsx（列：Merchant Name / MID / Date / Clicks），或 CSV。Total 汇总行会自动跳过。"
      />
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
        <p className="ant-upload-hint">LinkBux 导出 .xlsx 可直接上传；CSV 列名支持 MID、Date、Clicks</p>
      </Upload.Dragger>
      {preview.length > 0 && (
        <p style={{ marginTop: 12, color: '#666' }}>
          已解析 {preview.length} 行，合计 {preview.reduce((s, r) => s + r.clicks, 0)} 次点击
          {preview[0]?.clickDate && preview[preview.length - 1]?.clickDate
            ? `（${preview[0].clickDate} ~ ${preview[preview.length - 1].clickDate}）`
            : ''}
        </p>
      )}
    </Modal>
  );
}
