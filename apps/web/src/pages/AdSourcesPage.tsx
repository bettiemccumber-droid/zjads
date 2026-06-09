import { useCallback, useEffect, useState } from 'react';

import {
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  message,
  Modal,
  Popconfirm,
  Space,
  Table,
  Typography,
} from 'antd';

import dayjs, { type Dayjs } from 'dayjs';

import { api, type ApiResult } from '../api/client';

/** 与 Google Ads 脚本 lookback 对齐：默认回溯天数（含昨天） */
const DEFAULT_LOOKBACK_DAYS = 14;

interface AdDataSourceRow {
  id: number;
  name: string;
  sheetUrl: string;
  mainTab: string;
  description: string | null;
  isActive: boolean;
  updatedAt: string;
}

interface ImportResult {
  upserted: number;
  dateFrom: string;
  dateTo: string;
  campaignCount: number;
}

/**
 * 计算导入日期区间：结束日为昨天（与脚本日常模式一致），向前含 lookbackDays 个自然日
 */
function getImportDateRange(lookbackDays: number): { start: string; end: string } {
  const end = dayjs().subtract(1, 'day').startOf('day');
  const start = end.subtract(lookbackDays - 1, 'day');
  return {
    start: start.format('YYYY-MM-DD'),
    end: end.format('YYYY-MM-DD'),
  };
}

export default function AdSourcesPage() {
  const [list, setList] = useState<AdDataSourceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [importingId, setImportingId] = useState<number | null>(null);
  const [rangeModalOpen, setRangeModalOpen] = useState(false);
  const [rangeTargetId, setRangeTargetId] = useState<number | null>(null);
  const [customRange, setCustomRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<ApiResult<AdDataSourceRow[]>>('/ad-sources');
      if (data.success) setList(data.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onCreate = async (values: { name: string; sheetUrl: string; mainTab?: string }) => {
    const { data } = await api.post<ApiResult<AdDataSourceRow>>('/ad-sources', {
      name: values.name,
      sheetUrl: values.sheetUrl,
      mainTab: values.mainTab || 'raw_daily_report',
    });
    if (data.success) {
      message.success('已添加广告数据源');
      form.resetFields();
      void load();
    } else {
      message.error(data.message);
    }
  };

  const runImport = async (
    id: number,
    startDate?: string,
    endDate?: string,
    label?: string,
  ) => {
    setImportingId(id);
    try {
      const params: Record<string, string> = {};
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      const { data } = await api.post<ApiResult<ImportResult>>(
        `/ad-sources/${id}/import`,
        null,
        { params },
      );

      if (data.success) {
        const rangeLabel =
          label ??
          (data.data.dateFrom && data.data.dateTo
            ? `${data.data.dateFrom} ~ ${data.data.dateTo}`
            : '全量');
        message.success(
          `导入完成：${data.data.upserted} 条日数据，${data.data.campaignCount} 个系列（${rangeLabel}）`,
        );
      } else {
        message.error(data.message);
      }
    } catch {
      message.error('导入失败，请确认 Sheet 已公开可读');
    } finally {
      setImportingId(null);
    }
  };

  const onImportRecent = async (id: number) => {
    const { start, end } = getImportDateRange(DEFAULT_LOOKBACK_DAYS);
    await runImport(id, start, end, `${start} ~ ${end}`);
  };

  const onImportAll = async (id: number) => {
    await runImport(id, undefined, undefined, 'Sheet 全量');
  };

  const openRangeModal = (id: number) => {
    const { start, end } = getImportDateRange(DEFAULT_LOOKBACK_DAYS);
    setRangeTargetId(id);
    setCustomRange([dayjs(start), dayjs(end)]);
    setRangeModalOpen(true);
  };

  const onConfirmRangeImport = async () => {
    if (!rangeTargetId || !customRange) return;
    const [start, end] = customRange;
    setRangeModalOpen(false);
    await runImport(
      rangeTargetId,
      start.format('YYYY-MM-DD'),
      end.format('YYYY-MM-DD'),
    );
    setRangeTargetId(null);
  };

  const onDelete = async (id: number) => {
    const { data } = await api.delete<ApiResult<{ deleted: boolean }>>(`/ad-sources/${id}`);
    if (data.success) {
      message.success('已删除');
      void load();
    }
  };

  const defaultRange = getImportDateRange(DEFAULT_LOOKBACK_DAYS);

  return (
    <div>
      <Card title="添加 Google Sheet（徐版 raw_daily_report）" style={{ marginBottom: 16 }}>
        <Form form={form} layout="inline" onFinish={onCreate} style={{ flexWrap: 'wrap', gap: 8 }}>
          <Form.Item name="name" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="名称，如：我的 MCC 报表" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="sheetUrl" rules={[{ required: true, message: '请输入 Sheet URL' }]}>
            <Input placeholder="Google Sheet 链接" style={{ width: 360 }} />
          </Form.Item>
          <Form.Item name="mainTab" initialValue="raw_daily_report">
            <Input placeholder="工作表名" style={{ width: 160 }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit">
              保存
            </Button>
          </Form.Item>
        </Form>
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          Sheet 需设置为「知道链接的任何人可查看」。导入后可在「数据采集 → 广告系列」查看。
          默认导入 <strong>昨天起回溯 {DEFAULT_LOOKBACK_DAYS} 天</strong>（{defaultRange.start} ~{' '}
          {defaultRange.end}），与脚本日常 lookback 对齐；停投较早的系列请用「自定义日期」或「全量导入」。
        </Typography.Paragraph>
      </Card>

      <Card title="我的广告数据源">
        <Table
          rowKey="id"
          loading={loading}
          dataSource={list}
          pagination={false}
          scroll={{ x: 900 }}
          columns={[
            { title: '名称', dataIndex: 'name', width: 120 },
            { title: '工作表', dataIndex: 'mainTab', width: 140 },
            {
              title: 'Sheet',
              dataIndex: 'sheetUrl',
              ellipsis: true,
              render: (url: string) => (
                <a href={url} target="_blank" rel="noreferrer">
                  打开
                </a>
              ),
            },
            {
              title: '更新时间',
              dataIndex: 'updatedAt',
              width: 170,
              render: (v: string) => new Date(v).toLocaleString('zh-CN'),
            },
            {
              title: '操作',
              width: 320,
              fixed: 'right',
              render: (_: unknown, r: AdDataSourceRow) => (
                <Space wrap size="small">
                  <Button
                    type="primary"
                    size="small"
                    loading={importingId === r.id}
                    onClick={() => onImportRecent(r.id)}
                  >
                    导入近 {DEFAULT_LOOKBACK_DAYS} 天
                  </Button>
                  <Button
                    size="small"
                    loading={importingId === r.id}
                    onClick={() => openRangeModal(r.id)}
                  >
                    自定义日期
                  </Button>
                  <Popconfirm
                    title="导入 Sheet 中全部日数据？"
                    description="数据量大时耗时较长，建议优先用自定义日期覆盖看板区间。"
                    onConfirm={() => onImportAll(r.id)}
                  >
                    <Button size="small" loading={importingId === r.id}>
                      全量
                    </Button>
                  </Popconfirm>
                  <Popconfirm title="确定删除？" onConfirm={() => onDelete(r.id)}>
                    <Button size="small" danger>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title="按日期导入广告数据"
        open={rangeModalOpen}
        onCancel={() => setRangeModalOpen(false)}
        onOk={() => void onConfirmRangeImport()}
        okText="开始导入"
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          建议区间<strong>不窄于</strong>数据采集页的查询日期；若系列在查询开始前已停投，需把导入起点再往前调（如
          Nina Shoes 跑量在 5/24~5/27，看板查 5/28 起也要导入 5/24 起的数据）。
        </Typography.Paragraph>
        <DatePicker.RangePicker
          value={customRange}
          onChange={(v) => setCustomRange(v as [Dayjs, Dayjs] | null)}
          style={{ width: '100%' }}
          allowClear={false}
        />
      </Modal>
    </div>
  );
}
