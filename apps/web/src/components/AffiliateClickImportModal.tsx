import { useState } from 'react';
import { Alert, Form, Input, Modal, Upload, message } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { api, type ApiResult } from '../api/client';
import {
  AFFILIATE_CLICK_CSV_TEMPLATE,
  RW_DAILY_ONLY_CSV_TEMPLATE,
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
  const [merchantId, setMerchantId] = useState('');
  const [merchantName, setMerchantName] = useState('');
  const isRw = platformCode === 'rewardoo';

  const resetAndClose = () => {
    setPreview([]);
    setMerchantId('');
    setMerchantName('');
    onClose();
  };

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
        resetAndClose();
      } else {
        message.error(data.message);
      }
    } finally {
      setUploading(false);
    }
  };

  const handleFile = async (file: File) => {
    if (isRw && !/^\d+$/.test(merchantId.trim())) {
      message.warning('请先填写商家 MID（与广告系列 merchantId 一致）');
      return false;
    }
    try {
      const rows = await parseAffiliateClickFile(file, {
        defaultMerchantId: isRw ? merchantId.trim() : undefined,
        defaultMerchantName: isRw ? merchantName.trim() : undefined,
      });
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
    const content = isRw ? RW_DAILY_ONLY_CSV_TEMPLATE : AFFILIATE_CLICK_CSV_TEMPLATE;
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = isRw ? 'rw-daily-calibration-template.csv' : 'affiliate-clicks-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const previewOrders = preview.reduce((s, r) => s + (r.performanceOrders ?? 0), 0);
  const previewClicks = preview.reduce((s, r) => s + r.clicks, 0);

  return (
    <Modal
      title={`Performance 校准导入 · ${accountLabel}`}
      open={open}
      onCancel={resetAndClose}
      onOk={() => preview.length && void submit(preview)}
      okText={preview.length ? `导入 ${preview.length} 行` : '请先上传文件'}
      okButtonProps={{ disabled: !preview.length, loading: uploading }}
      width={720}
      destroyOnClose
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={isRw ? 'Rewardoo Performance 校准（点击 + 订单）' : 'LinkBux 点击校准'}
        description={
          isRw ? (
            <>
              RW 后台无法一次导出「商家 × 按日」：请<strong>先筛 Merchant</strong>，再 Group by
              <strong> Daily</strong> 导出，在下方填 MID 后上传（Date / Clicks / Orders）。
              <br />
              与 LB 相同：导入标记为校准数据，<strong>后续采集不会覆盖</strong>；佣金仍由采集写入，本导入<strong>不改佣金</strong>。{' '}
              <a onClick={downloadTemplate}>下载按日模板</a>
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
      {isRw ? (
        <Form layout="vertical" style={{ marginBottom: 12 }}>
          <Form.Item
            label="商家 MID（必填）"
            required
            extra="广告系列名中的 merchantId，如 Halfords 对应数字 MID"
          >
            <Input
              placeholder="如 104911"
              value={merchantId}
              onChange={(e) => {
                setMerchantId(e.target.value.replace(/\D/g, ''));
                setPreview([]);
              }}
            />
          </Form.Item>
          <Form.Item label="商家名称（可选）" extra="便于渠道账号列表识别">
            <Input
              placeholder="如 Halfords Autocentres"
              value={merchantName}
              onChange={(e) => setMerchantName(e.target.value)}
            />
          </Form.Item>
        </Form>
      ) : null}
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message="导入说明"
        description={
          isRw
            ? '支持 RW 导出的 .xlsx（列 Date / Clicks / Orders）。日期支持 2026/8/2、2026-08-02 等。勿用「按商家」汇总导出（无按日明细）。'
            : '支持 LinkBux 后台原样导出的 .xlsx（列：Merchant Name / MID / Date / Clicks），或 CSV。Total 汇总行会自动跳过。'
        }
      />
      <Upload.Dragger
        accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        multiple={false}
        beforeUpload={handleFile}
        showUploadList={false}
        disabled={isRw && !merchantId.trim()}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">点击或拖拽 CSV / Excel 文件</p>
        <p className="ant-upload-hint">
          {isRw
            ? merchantId.trim()
              ? '上传已筛商家的 Daily 导出（Date + Clicks + Orders）'
              : '请先填写商家 MID'
            : 'LinkBux 导出 .xlsx 可直接上传；CSV 列名支持 MID、Date、Clicks'}
        </p>
      </Upload.Dragger>
      {preview.length > 0 && (
        <p style={{ marginTop: 12, color: '#666' }}>
          MID {preview[0]?.merchantId}：{preview.length} 天，点击 {previewClicks} 次
          {previewOrders > 0 ? `，订单 ${previewOrders} 单` : ''}
          {preview[0]?.clickDate && preview[preview.length - 1]?.clickDate
            ? `（${preview[0].clickDate} ~ ${preview[preview.length - 1].clickDate}）`
            : ''}
        </p>
      )}
    </Modal>
  );
}
