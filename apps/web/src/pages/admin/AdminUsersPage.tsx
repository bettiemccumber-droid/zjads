import { useEffect, useState } from 'react';
import { Button, Card, DatePicker, Input, Space, Table, Tag, message } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { Link } from 'react-router-dom';
import { api, type ApiResult } from '../../api/client';

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
        <Link to="/admin/users/manage">
          <Button type="primary">创建员工</Button>
        </Link>
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
        scroll={{ x: 1100 }}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 60 },
          { title: '用户名', dataIndex: 'username', width: 100 },
          { title: '邮箱', dataIndex: 'email', ellipsis: true },
          {
            title: '状态',
            dataIndex: 'isActive',
            width: 80,
            render: (v: boolean) => (v ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
          },
          { title: '平台账号', dataIndex: 'channelAccountCount', width: 90, align: 'center' },
          { title: '广告 Sheet', dataIndex: 'adSourceCount', width: 100, align: 'center' },
          { title: '订单数', dataIndex: 'orderCount', width: 80, align: 'right' },
          {
            title: '总佣金',
            dataIndex: 'totalCommission',
            width: 100,
            align: 'right',
            render: (v: number) => `$${v.toFixed(2)}`,
          },
          {
            title: '广告费',
            dataIndex: 'totalAdSpend',
            width: 100,
            align: 'right',
            render: (v: number) => `$${v.toFixed(2)}`,
          },
          {
            title: 'ROI',
            dataIndex: 'roi',
            width: 72,
            align: 'right',
            render: (v: number) => (
              <span style={{ color: v >= 0 ? '#16a34a' : '#dc2626' }}>{v.toFixed(2)}</span>
            ),
          },
          {
            title: '最近采集',
            width: 100,
            render: (_, r) =>
              r.lastSyncStatus ? (
                <Tag color={r.lastSyncStatus === 'completed' ? 'green' : 'default'}>
                  {r.lastSyncStatus}
                </Tag>
              ) : (
                '—'
              ),
          },
          {
            title: '操作',
            width: 160,
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
