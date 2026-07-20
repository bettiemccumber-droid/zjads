import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Popconfirm,
  Space,
  Table,
  Tag,
  message,
} from 'antd';
import type { Dayjs } from 'dayjs';
import { Link } from 'react-router-dom';
import { api, type ApiResult } from '../../api/client';
import {
  AffiliateCollectionCell,
  SheetCollectionCell,
} from '../../components/CollectionStatusCells';
import { adminDefaultDateRange } from '../../utils/date-range.util';

const { RangePicker } = DatePicker;

interface CollectionRow {
  userId: number;
  username: string;
  channelAccountCount: number;
  adSourceCount: number;
  lastSyncStatus: string | null;
  lastSyncAt: string | null;
  lastSyncDateRange: string | null;
  lastSyncStartedAt: string | null;
  lastSyncProgress: string | null;
  lastSyncError: string | null;
  lastSyncJobId: number | null;
  lastSheetImportAt: string | null;
  lastSheetName: string | null;
  sheetNames?: string[];
  lastSheetNameSummary?: string | null;
}

interface BatchImportResponse {
  userCount: number;
  userSuccess: number;
  userFailed: number;
  sheetSuccess: number;
  sheetFailed: number;
  totalUpserted: number;
  success: number;
  failed: number;
  byUser: Array<{
    userId: number;
    username: string;
    sheetCount: number;
    success: number;
    failed: number;
    totalUpserted: number;
    ok: boolean;
    message?: string;
  }>;
}

function defaultRange(): [Dayjs, Dayjs] {
  return adminDefaultDateRange();
}

export default function AdminSyncPage() {
  const [range, setRange] = useState<[Dayjs, Dayjs]>(defaultRange);
  const [rows, setRows] = useState<CollectionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncingUserId, setSyncingUserId] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [importingUserId, setImportingUserId] = useState<number | null>(null);
  const [includeClicks, setIncludeClicks] = useState(false);
  const [purging, setPurging] = useState(false);

  const purgeSyncHistory = async () => {
    setPurging(true);
    try {
      const { data } = await api.post<
        ApiResult<{ deletedJobs: number; keptJobs: number; keepPerUser: number }>
      >('/admin/sync-jobs/purge', { keepPerUser: 30 });
      if (data.success) {
        message.success(data.message);
        void load();
      } else {
        message.error(data.message);
      }
    } finally {
      setPurging(false);
    }
  };

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

  const batchSync = async (userIds?: number[]) => {
    const isSingle = userIds?.length === 1;
    if (isSingle) setSyncingUserId(userIds![0]);
    else setSyncing(true);
    try {
      const { data } = await api.post<
        ApiResult<{ started: number; failed: number; results: unknown[] }>
      >('/admin/sync/batch', {
        startDate: range[0].format('YYYY-MM-DD'),
        endDate: range[1].format('YYYY-MM-DD'),
        includeClicks,
        ...(userIds?.length ? { userIds } : {}),
      });
      if (data.success) {
        message.success(`已创建 ${data.data.started} 个采集任务，失败 ${data.data.failed} 个`);
        void load();
      } else message.error(data.message);
    } finally {
      setSyncing(false);
      setSyncingUserId(null);
    }
  };

  const showBatchImportResult = (data: BatchImportResponse, singleUsername?: string) => {
    const { userSuccess, userFailed, sheetSuccess, sheetFailed, totalUpserted, byUser } = data;
    if (singleUsername) {
      const row = byUser[0];
      if (!row?.ok) {
        message.error(row?.message ?? `${singleUsername} Sheet 导入失败`);
        return;
      }
      if (row.failed > 0) {
        message.warning(
          `${singleUsername}：${row.success}/${row.sheetCount} 个 Sheet 成功，共 ${row.totalUpserted} 条`,
        );
      } else {
        message.success(
          `${singleUsername}：已导入 ${row.sheetCount} 个 Sheet，共 ${row.totalUpserted} 条`,
        );
      }
      return;
    }

    if (sheetFailed === 0) {
      message.success(
        `Sheet 导入完成：${userSuccess} 人共 ${sheetSuccess} 个 Sheet，${totalUpserted} 条数据`,
      );
    } else {
      message.warning(
        `Sheet 导入：${userSuccess} 人成功，${sheetFailed} 个 Sheet 失败${userFailed ? `，${userFailed} 人未导入` : ''}`,
        6,
      );
    }
  };

  const batchImportSheets = async (userIds?: number[]) => {
    const isSingle = userIds?.length === 1;
    const singleUsername = isSingle
      ? rows.find((r) => r.userId === userIds![0])?.username
      : undefined;
    if (isSingle) setImportingUserId(userIds![0]);
    else setImporting(true);
    try {
      const { data } = await api.post<ApiResult<BatchImportResponse>>(
        '/admin/import/sheets/batch',
        {
          startDate: range[0].format('YYYY-MM-DD'),
          endDate: range[1].format('YYYY-MM-DD'),
          ...(userIds?.length ? { userIds } : {}),
        },
      );
      if (data.success) {
        showBatchImportResult(data.data, singleUsername);
        void load();
      } else message.error(data.message);
    } finally {
      setImporting(false);
      setImportingUserId(null);
    }
  };

  const withChannels = rows.filter((r) => r.channelAccountCount > 0).length;
  const withSheets = rows.filter((r) => r.adSourceCount > 0).length;
  const staleCount = rows.filter((r) => {
    if (!r.lastSyncAt) return r.channelAccountCount > 0;
    const days = (Date.now() - new Date(r.lastSyncAt).getTime()) / (86400000);
    return days > 2 && r.channelAccountCount > 0;
  }).length;

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="管理员批量采集"
        description="各员工订单采集完成后，平台会自动导入其全部 Google Sheet 广告费（同日期区间）。下方表格仍可单独操作。"
      />

      <Card title="快速操作" style={{ marginBottom: 16 }}>
        <Space wrap align="center">
          <span>订单采集区间：</span>
          <RangePicker value={range} onChange={(v) => v && setRange(v as [Dayjs, Dayjs])} />
          <Checkbox checked={includeClicks} onChange={(e) => setIncludeClicks(e.target.checked)}>
            含联盟点击（LB 仅最后一天）
          </Checkbox>
          <Button type="primary" loading={syncing} onClick={() => void batchSync()}>
            批量采集（含自动导入 Sheet）
          </Button>
          <Button loading={importing} onClick={() => void batchImportSheets()}>
            批量导入全部 Sheet
          </Button>
          <Link to="/admin/ad-sources">管理员工 Sheet →</Link>
        </Space>
        <p style={{ color: '#666', marginTop: 12, marginBottom: 0 }}>
          Sheet 导入使用上方日期区间过滤，每人会依次导入其全部广告 Sheet；无日期则导入 Sheet 内全部行。
        </p>
      </Card>

      <Card title="用户数据状态">
        <Space style={{ marginBottom: 12 }} wrap>
          <Tag color="blue">有平台账号 {withChannels} 人</Tag>
          <Tag color="green">有广告 Sheet {withSheets} 人</Tag>
          {staleCount > 0 && (
            <Tag color="orange">超过 2 天未采集 {staleCount} 人</Tag>
          )}
          <Button size="small" onClick={load}>
            刷新
          </Button>
          <Popconfirm
            title="清理历史采集记录？"
            description="仅删除任务日志（sync_jobs），联盟订单、Sheet 广告费不受影响。每人保留最近 30 条，进行中的任务不删。"
            okText="确认清理"
            cancelText="取消"
            onConfirm={() => void purgeSyncHistory()}
          >
            <Button size="small" danger loading={purging}>
              清理历史采集记录
            </Button>
          </Popconfirm>
        </Space>
        <Table
          rowKey="userId"
          loading={loading}
          dataSource={rows}
          scroll={{ x: 900 }}
          columns={[
            { title: '用户', dataIndex: 'username', width: 100 },
            { title: '平台账号', dataIndex: 'channelAccountCount', width: 90, align: 'center' },
            { title: '广告 Sheet', dataIndex: 'adSourceCount', width: 100, align: 'center' },
            {
              title: '最近联盟采集',
              width: 200,
              render: (_, r) => (
                <AffiliateCollectionCell
                  row={r}
                  userId={r.userId}
                  username={r.username}
                />
              ),
            },
            {
              title: '最近 Sheet 导入',
              width: 160,
              render: (_, r) => <SheetCollectionCell row={r} />,
            },
            {
              title: '操作',
              width: 280,
              fixed: 'right',
              render: (_, r) => (
                <Space size="small" wrap>
                  <Button
                    size="small"
                    loading={syncingUserId === r.userId}
                    disabled={r.channelAccountCount === 0}
                    onClick={() => void batchSync([r.userId])}
                  >
                    采集订单
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    loading={importingUserId === r.userId}
                    disabled={r.adSourceCount === 0}
                    onClick={() => void batchImportSheets([r.userId])}
                  >
                    导入全部 Sheet{r.adSourceCount > 1 ? ` (${r.adSourceCount})` : ''}
                  </Button>
                  <Link
                    to={`/admin/ad-sources?userId=${r.userId}&username=${encodeURIComponent(r.username)}`}
                  >
                    Sheet
                  </Link>
                  <Link
                    to={`/dashboard?userId=${r.userId}&username=${encodeURIComponent(r.username)}`}
                  >
                    工作台
                  </Link>
                </Space>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
