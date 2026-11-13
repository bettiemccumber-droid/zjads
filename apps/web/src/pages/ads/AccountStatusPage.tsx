import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Input, Row, Space, Statistic, Switch, Table, Tag, Tooltip, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { api, type ApiResult } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { formatCustomerId } from './ad-launch-settings';

interface AccountRow {
  id: string;
  mccCustomerId: string;
  mccLabel: string;
  customerId: string;
  googleStatus: string;
  availability: string;
  activeCampaignCount: number;
  updatedAt: string;
}

interface Board {
  summary: { total: number; enabled: number; suspended: number; closed: number; unknown: number };
  rows: AccountRow[];
}

const AVAILABILITY: Record<string, { label: string; color: string; tip: string }> = {
  disabled: { label: '禁用', color: 'error', tip: '账户已暂停、取消或关闭' },
  occupied: { label: '占用', color: 'processing', tip: '有在投系列' },
  idle: { label: '空闲', color: 'success', tip: '没有在投系列' },
};

const STATUS_LABEL: Record<string, string> = {
  ENABLED: '已启用',
  SUSPENDED: '已暂停',
  CANCELED: '已取消',
  CLOSED: '已关闭',
  UNKNOWN: '未回传',
};

/**
 * 暂停、取消、关闭的子账号算异常，不能拿来投放。
 */
function isAbnormal(row: AccountRow) {
  return row.availability === 'disabled' || row.googleStatus === 'SUSPENDED' || row.googleStatus === 'CANCELED' || row.googleStatus === 'CLOSED';
}

/**
 * 当前员工名下的子账号。空闲和占用可以投放，禁用是异常。
 * 名单和「未回传」来自广告日报。接入 Google Ads API 时改成 MCC 当前子账号和真实账户状态。
 */
export default function AccountStatusPage() {
  const { user } = useAuth();
  const [board, setBoard] = useState<Board>({
    summary: { total: 0, enabled: 0, suspended: 0, closed: 0, unknown: 0 },
    rows: [],
  });
  const [keyword, setKeyword] = useState('');
  const [abnormalOnly, setAbnormalOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const res = await api.get<ApiResult<Board>>('/google-ads/accounts');
    if (res.data.success) setBoard(res.data.data);
  }, []);

  useEffect(() => {
    void load().catch(() => message.error('加载账户状态失败'));
  }, [load]);

  const abnormalCount = useMemo(() => board.rows.filter(isAbnormal).length, [board.rows]);
  const visibleRows = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return board.rows.filter((row) => {
      if (abnormalOnly && !isAbnormal(row)) return false;
      if (!query) return true;
      const owner = (user?.username ?? '').toLowerCase();
      const cid = formatCustomerId(row.customerId).toLowerCase();
      const mcc = (row.mccLabel || row.mccCustomerId).toLowerCase();
      return cid.includes(query) || row.customerId.includes(query) || mcc.includes(query) || owner.includes(query);
    });
  }, [abnormalOnly, board.rows, keyword, user?.username]);

  return (
    <>
      <Typography.Title level={4} style={{ marginTop: 0 }}>账户状态</Typography.Title>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="空闲和占用的子账号可以投放，禁用的是异常。在投系列按该 CID 最新一天里启用的系列计算。Google 账户状态还没从 MCC 回传时显示「未回传」。"
      />
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card><Statistic title="账户点数" value={board.summary.total} /></Card></Col>
        <Col span={6}><Card><Statistic title="正常" value={board.summary.enabled} valueStyle={{ color: '#3f8600' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="已暂停" value={board.summary.suspended} valueStyle={{ color: '#cf1322' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="已取消/关闭" value={board.summary.closed} /></Card></Col>
      </Row>
      <Card>
        <Space style={{ marginBottom: 12 }} wrap>
          <Input.Search
            allowClear
            placeholder="CID / MCC / 归属人"
            style={{ width: 280 }}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <span>只看异常</span>
          <Switch checked={abnormalOnly} onChange={setAbnormalOnly} />
          <Tag>{abnormalCount} 个异常</Tag>
          <Button
            icon={<ReloadOutlined />}
            loading={refreshing}
            onClick={() => {
              setRefreshing(true);
              void load().catch(() => message.error('刷新失败')).finally(() => setRefreshing(false));
            }}
          >
            刷新
          </Button>
        </Space>
        <Table
          rowKey="id"
          size="small"
          pagination={{ pageSize: 20, showSizeChanger: false }}
          dataSource={visibleRows}
          columns={[
            {
              title: 'MCC',
              dataIndex: 'mccLabel',
              render: (value: string, row: AccountRow) => value || (row.mccCustomerId ? formatCustomerId(row.mccCustomerId) : '—'),
            },
            { title: '归属人', render: () => user?.username || '—' },
            { title: '账户 CID', dataIndex: 'customerId', render: (value: string) => formatCustomerId(value) },
            {
              title: 'Google 状态',
              dataIndex: 'googleStatus',
              render: (value: string) => <Tag color={value === 'ENABLED' ? 'success' : value === 'SUSPENDED' ? 'error' : 'default'}>{STATUS_LABEL[value] ?? value}</Tag>,
            },
            {
              title: '可用性',
              dataIndex: 'availability',
              render: (value: string) => {
                const item = AVAILABILITY[value];
                if (!item) return '—';
                return <Tooltip title={item.tip}><Tag color={item.color}>{item.label}</Tag></Tooltip>;
              },
            },
            { title: '在投系列', dataIndex: 'activeCampaignCount' },
            { title: '最近同步', dataIndex: 'updatedAt', render: (value: string) => value?.replace('T', ' ').slice(0, 10) || '—' },
          ]}
        />
      </Card>
    </>
  );
}
