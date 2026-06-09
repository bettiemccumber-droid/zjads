import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Space,
  Table,
  Tag,
  message,
} from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { api, type ApiResult } from '../../api/client';

const { RangePicker } = DatePicker;

interface CollectionRow {
  userId: number;
  username: string;
  channelAccountCount: number;
  adSourceCount: number;
  lastSyncStatus: string | null;
  lastSyncAt: string | null;
  lastSheetImportAt: string | null;
  lastSheetName: string | null;
}

function defaultRange(): [Dayjs, Dayjs] {
  return [dayjs().subtract(14, 'day'), dayjs().subtract(1, 'day')];
}

export default function AdminSyncPage() {
  const [range, setRange] = useState<[Dayjs, Dayjs]>(defaultRange);
  const [rows, setRows] = useState<CollectionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [includeClicks, setIncludeClicks] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get<ApiResult<CollectionRow[]>>('/admin/collection-status');
      if (data.success) setRows(data.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const batchSync = async () => {
    setSyncing(true);
    try {
      const { data } = await api.post<
        ApiResult<{ started: number; failed: number; results: unknown[] }>
      >('/admin/sync/batch', {
        startDate: range[0].format('YYYY-MM-DD'),
        endDate: range[1].format('YYYY-MM-DD'),
        includeClicks,
      });
      if (data.success) {
        message.success(`已创建 ${data.data.started} 个采集任务，失败 ${data.data.failed} 个`);
        void load();
      } else message.error(data.message);
    } finally {
      setSyncing(false);
    }
  };

  const batchImportSheets = async () => {
    setImporting(true);
    try {
      const { data } = await api.post<
        ApiResult<{ success: number; failed: number; results: unknown[] }>
      >('/admin/import/sheets/batch', {
        startDate: range[0].format('YYYY-MM-DD'),
        endDate: range[1].format('YYYY-MM-DD'),
      });
      if (data.success) {
        message.success(`Sheet 导入成功 ${data.data.success} 个，失败 ${data.data.failed} 个`);
        void load();
      } else message.error(data.message);
    } finally {
      setImporting(false);
    }
  };

  const withChannels = rows.filter((r) => r.channelAccountCount > 0).length;
  const withSheets = rows.filter((r) => r.adSourceCount > 0).length;

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="管理员批量采集"
        description="将使用各员工已配置的平台 Token 与 Google Sheet，无需管理员重复添加账号。"
      />

      <Card title="快速操作" style={{ marginBottom: 16 }}>
        <Space wrap align="center">
          <span>订单采集区间：</span>
          <RangePicker value={range} onChange={(v) => v && setRange(v as [Dayjs, Dayjs])} />
          <Checkbox checked={includeClicks} onChange={(e) => setIncludeClicks(e.target.checked)}>
            含联盟点击（LB 仅最后一天）
          </Checkbox>
          <Button type="primary" loading={syncing} onClick={batchSync}>
            批量采集联盟订单
          </Button>
          <Button loading={importing} onClick={batchImportSheets}>
            批量导入 Google Sheet
          </Button>
        </Space>
        <p style={{ color: '#666', marginTop: 12, marginBottom: 0 }}>
          Sheet 导入使用上方日期区间过滤；无日期则导入 Sheet 内全部行。
        </p>
      </Card>

      <Card title="用户数据状态">
        <Space style={{ marginBottom: 12 }}>
          <Tag color="blue">有平台账号 {withChannels} 人</Tag>
          <Tag color="green">有广告 Sheet {withSheets} 人</Tag>
          <Button size="small" onClick={load}>
            刷新
          </Button>
        </Space>
        <Table
          rowKey="userId"
          loading={loading}
          dataSource={rows}
          columns={[
            { title: '用户', dataIndex: 'username' },
            { title: '平台账号', dataIndex: 'channelAccountCount', width: 90, align: 'center' },
            { title: '广告 Sheet', dataIndex: 'adSourceCount', width: 100, align: 'center' },
            {
              title: '最近联盟采集',
              render: (_, r) =>
                r.lastSyncAt
                  ? `${r.lastSyncStatus ?? '—'} · ${new Date(r.lastSyncAt).toLocaleString('zh-CN')}`
                  : '—',
            },
            {
              title: '最近 Sheet 导入',
              render: (_, r) =>
                r.lastSheetImportAt
                  ? `${r.lastSheetName ?? ''} · ${new Date(r.lastSheetImportAt).toLocaleString('zh-CN')}`
                  : '—',
            },
          ]}
        />
      </Card>
    </div>
  );
}
