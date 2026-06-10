import { useEffect, useState } from 'react';
import { Button, Card, DatePicker, Input, Space, Table, Tag, message } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { Link } from 'react-router-dom';
import { api, type ApiResult } from '../../api/client';
import {
  AffiliateCollectionCell,
  SheetCollectionCell,
} from '../../components/CollectionStatusCells';
import { formatCollectionTime, formatRelativeTime } from '../../utils/collection-display';

const { RangePicker } = DatePicker;

interface UserSummaryRow {
  id: number;
  username: string;
  email: string;
  role: string;
  isActive: boolean;
  channelAccountCount: number;
  adSourceCount: number;
  orderCount: number;
  totalCommission: number;
  totalAdSpend: number;
  roi: number;
  profit: number;
  lastSyncStatus: string | null;
  lastSyncAt: string | null;
  lastSyncDateRange: string | null;
  lastSyncStartedAt: string | null;
  lastSyncProgress: string | null;
  lastSyncError: string | null;
  lastSyncJobId: number | null;
  lastSheetName: string | null;
  lastSheetImportAt: string | null;
  lastOrderCollectedAt: string | null;
}

function defaultRange(): [Dayjs, Dayjs] {
  return [dayjs().subtract(30, 'day'), dayjs().subtract(1, 'day')];
}

export default function AdminUsersPage() {
  const [range, setRange] = useState<[Dayjs, Dayjs]>(defaultRange);
  const [rows, setRows] = useState<UserSummaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get<ApiResult<UserSummaryRow[]>>('/admin/users/summary', {
        params: {
          startDate: range[0].format('YYYY-MM-DD'),
          endDate: range[1].format('YYYY-MM-DD'),
        },
      });
      if (data.success) setRows(data.data);
      else message.error(data.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = rows.filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return r.username.toLowerCase().includes(q) || r.email.toLowerCase().includes(q);
  });

  return (
    <Card
      title="用户管理"
      extra={
        <Space>
          <Link to="/admin/sync">
            <Button>数据采集中心</Button>
          </Link>
          <Link to="/admin/users/manage">
            <Button type="primary">员工账号</Button>
          </Link>
        </Space>
      }
    >
      <Space wrap style={{ marginBottom: 16 }}>
        <RangePicker value={range} onChange={(v) => v && setRange(v as [Dayjs, Dayjs])} />
        <Button type="primary" onClick={load}>
          刷新
        </Button>
        <Input.Search
          placeholder="搜索用户名或邮箱"
          allowClear
          style={{ width: 240 }}
          onSearch={setSearch}
          onChange={(e) => setSearch(e.target.value)}
        />
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={filtered}
        scroll={{ x: 1280 }}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 56, fixed: 'left' },
          { title: '用户名', dataIndex: 'username', width: 88, fixed: 'left' },
          { title: '邮箱', dataIndex: 'email', width: 160, ellipsis: true },
          {
            title: '状态',
            dataIndex: 'isActive',
            width: 72,
            render: (v: boolean) => (v ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
          },
          { title: '平台账号', dataIndex: 'channelAccountCount', width: 82, align: 'center' },
          { title: '广告 Sheet', dataIndex: 'adSourceCount', width: 92, align: 'center' },
          { title: '订单数', dataIndex: 'orderCount', width: 76, align: 'right' },
          {
            title: '总佣金',
            dataIndex: 'totalCommission',
            width: 96,
            align: 'right',
            render: (v: number) => `$${v.toFixed(2)}`,
          },
          {
            title: '广告费',
            dataIndex: 'totalAdSpend',
            width: 96,
            align: 'right',
            render: (v: number) => `$${v.toFixed(2)}`,
          },
          {
            title: 'ROI',
            dataIndex: 'roi',
            width: 68,
            align: 'right',
            render: (v: number) => (
              <span style={{ color: v >= 0 ? '#16a34a' : '#dc2626' }}>{v.toFixed(2)}</span>
            ),
          },
          {
            title: '联盟采集',
            width: 168,
            render: (_, r) => (
              <AffiliateCollectionCell row={r} userId={r.id} username={r.username} />
            ),
          },
          {
            title: 'Sheet 导入',
            width: 140,
            render: (_, r) => <SheetCollectionCell row={r} />,
          },
          {
            title: '最新订单入库',
            width: 130,
            render: (_, r) =>
              r.lastOrderCollectedAt ? (
                <span
                  style={{ fontSize: 12, color: '#666' }}
                  title={formatCollectionTime(r.lastOrderCollectedAt)}
                >
                  {formatRelativeTime(r.lastOrderCollectedAt)}
                </span>
              ) : (
                <span style={{ color: '#999' }}>—</span>
              ),
          },
          {
            title: '操作',
            width: 140,
            fixed: 'right',
            render: (_, r) => (
              <Space>
                <Link to={`/admin/users/${r.id}`}>查看</Link>
                <Link to={`/dashboard?userId=${r.id}&username=${encodeURIComponent(r.username)}`}>
                  工作台
                </Link>
              </Space>
            ),
          },
        ]}
      />
    </Card>
  );
}
