import { useEffect, useState } from 'react';
import { Button, Card, Col, DatePicker, Descriptions, Row, Space, Statistic, Table, Tag } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { Link, useParams } from 'react-router-dom';
import { api, type ApiResult } from '../../api/client';

const { RangePicker } = DatePicker;

interface UserDetail {
  user: {
    id: number;
    username: string;
    email: string;
    isActive: boolean;
    createdAt: string;
  };
  channels: Array<{
    id: number;
    displayName: string;
    platformName: string;
    affiliateAlias: string;
    isActive: boolean;
  }>;
  adSources: Array<{ id: number; name: string; mainTab: string; updatedAt: string }>;
  stats: {
    orderCount: number;
    totalCommission: number;
    totalAdSpend: number;
    overallRoi: number;
    profit: number;
    pendingCommission: number;
    confirmedCommission: number;
    rejectedCommission: number;
  };
  merchantRows: Array<{
    merchantId: string;
    merchantName: string;
    orderCount: number;
    totalCommission: number;
    totalCost: number;
  }>;
}

function defaultRange(): [Dayjs, Dayjs] {
  return [dayjs().subtract(30, 'day'), dayjs().subtract(1, 'day')];
}

export default function AdminUserDetailPage() {
  const { id } = useParams();
  const userId = parseInt(id ?? '0', 10);
  const [range, setRange] = useState<[Dayjs, Dayjs]>(defaultRange);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const { data } = await api.get<ApiResult<UserDetail>>(`/admin/users/${userId}/detail`, {
        params: {
          startDate: range[0].format('YYYY-MM-DD'),
          endDate: range[1].format('YYYY-MM-DD'),
        },
      });
      if (data.success) setDetail(data.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [userId]);

  if (!userId) return null;

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Link to="/admin/users">← 返回用户列表</Link>
        {detail && (
          <Link
            to={`/dashboard?userId=${detail.user.id}&username=${encodeURIComponent(detail.user.username)}`}
          >
            打开完整工作台 →
          </Link>
        )}
      </Space>

      <Card title={detail ? `用户：${detail.user.username}` : '用户详情'} loading={loading}>
        <RangePicker value={range} onChange={(v) => v && setRange(v as [Dayjs, Dayjs])} />
        <Button type="primary" style={{ marginLeft: 12 }} onClick={load}>
          查询
        </Button>

        {detail && (
          <>
            <Descriptions style={{ marginTop: 16 }} column={3} size="small">
              <Descriptions.Item label="邮箱">{detail.user.email}</Descriptions.Item>
              <Descriptions.Item label="状态">
                {detail.user.isActive ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label="注册">
                {new Date(detail.user.createdAt).toLocaleDateString('zh-CN')}
              </Descriptions.Item>
            </Descriptions>

            <Row gutter={16} style={{ margin: '16px 0' }}>
              <Col span={4}>
                <Statistic title="订单" value={detail.stats.orderCount} />
              </Col>
              <Col span={5}>
                <Statistic title="佣金" prefix="$" value={detail.stats.totalCommission} precision={2} />
              </Col>
              <Col span={5}>
                <Statistic title="广告费" prefix="$" value={detail.stats.totalAdSpend} precision={2} />
              </Col>
              <Col span={4}>
                <Statistic title="ROI" value={detail.stats.overallRoi} precision={2} />
              </Col>
              <Col span={5}>
                <Statistic title="失效佣金" prefix="$" value={detail.stats.rejectedCommission} precision={2} />
              </Col>
            </Row>

            <Card type="inner" title="平台账号" size="small" style={{ marginBottom: 12 }}>
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={detail.channels}
                columns={[
                  { title: '名称', dataIndex: 'displayName' },
                  { title: '平台', dataIndex: 'platformName' },
                  { title: '联盟序号', dataIndex: 'affiliateAlias' },
                  {
                    title: '状态',
                    dataIndex: 'isActive',
                    render: (v: boolean) => (v ? '启用' : '停用'),
                  },
                ]}
              />
            </Card>

            <Card type="inner" title="广告数据源" size="small" style={{ marginBottom: 12 }}>
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={detail.adSources}
                columns={[
                  { title: '名称', dataIndex: 'name' },
                  { title: '工作表', dataIndex: 'mainTab' },
                  {
                    title: '更新时间',
                    dataIndex: 'updatedAt',
                    render: (v: string) => new Date(v).toLocaleString('zh-CN'),
                  },
                ]}
              />
            </Card>

            <Card type="inner" title="商家汇总（Top 50）" size="small">
              <Table
                size="small"
                rowKey={(r) => r.merchantId}
                pagination={false}
                dataSource={detail.merchantRows}
                columns={[
                  { title: '商家ID', dataIndex: 'merchantId' },
                  { title: '商家名', dataIndex: 'merchantName' },
                  { title: '订单', dataIndex: 'orderCount' },
                  {
                    title: '佣金',
                    dataIndex: 'totalCommission',
                    render: (v: number) => `$${Number(v).toFixed(2)}`,
                  },
                  {
                    title: '广告费',
                    dataIndex: 'totalCost',
                    render: (v: number) => `$${Number(v).toFixed(2)}`,
                  },
                ]}
              />
            </Card>
          </>
        )}
      </Card>
    </div>
  );
}
