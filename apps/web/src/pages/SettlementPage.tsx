import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Input,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
  Alert,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import { api, type ApiResult } from '../api/client';
import CommissionMonitor from '../components/CommissionMonitor';
import SettlementSyncCollect from '../components/SettlementSyncCollect';
import { useAuth } from '../hooks/useAuth';
import {
  adminDefaultDateRange,
  employeeDefaultDateRange,
  lastNDaysToYesterday,
} from '../utils/date-range.util';

const { RangePicker } = DatePicker;

interface PlatformSummaryRow {
  platformCode: string;
  platformName: string;
  collectorImplemented: boolean;
  channelAliases: string[];
  orderCount: number;
  totalCommission: number;
  rejectedCommission: number;
  rejectionRate: number;
  atRiskMerchantCount?: number;
}

interface ChannelSummaryRow {
  channelAccountId: number;
  displayName: string;
  affiliateAlias: string;
  platformCode: string;
  platformName: string;
  collectorImplemented: boolean;
  orderCount: number;
  totalCommission: number;
  rejectedCommission: number;
  rejectionRate: number;
}

interface SettlementStats {
  totalOrders: number;
  totalCommission: number;
  confirmedCommission: number;
  pendingCommission: number;
  rejectedCommission: number;
  settlementRate: number;
  pendingRate: number;
  rejectionRate: number;
}

interface SettlementEmployeeSummary {
  userId: number;
  username: string;
  stats: SettlementStats;
}

interface EmployeeOption {
  id: number;
  username: string;
}

interface SettlementRow {
  merchantId: string;
  merchantName: string;
  platformName: string;
  platformCode: string;
  affiliateAlias: string;
  channelAccountId?: number;
  channelDisplayName?: string;
  orderCount: number;
  totalCommission: number;
  confirmedCommission: number;
  pendingCommission: number;
  rejectedCommission: number;
  settlementRate: number;
  pendingRate: number;
  rejectionRate: number;
}

const DATE_PRESETS: { label: string; days: number }[] = [
  { label: '近7天', days: 7 },
  { label: '近14天', days: 14 },
  { label: '近30天', days: 30 },
];

function money(v: number) {
  return `$${Number(v).toFixed(2)}`;
}

function pct(v: number) {
  return `${Number(v).toFixed(1)}%`;
}

export default function SettlementPage() {
  const { isAdmin } = useAuth();
  const [range, setRange] = useState<[Dayjs, Dayjs]>(() =>
    isAdmin ? adminDefaultDateRange() : employeeDefaultDateRange(),
  );
  const [stats, setStats] = useState<SettlementStats>({
    totalOrders: 0,
    totalCommission: 0,
    confirmedCommission: 0,
    pendingCommission: 0,
    rejectedCommission: 0,
    settlementRate: 0,
    pendingRate: 0,
    rejectionRate: 0,
  });
  const [items, setItems] = useState<SettlementRow[]>([]);
  const [platformSummaries, setPlatformSummaries] = useState<PlatformSummaryRow[]>([]);
  const [channelSummaries, setChannelSummaries] = useState<ChannelSummaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [channelAccountFilter, setChannelAccountFilter] = useState<number | 'all'>('all');
  const [merchantSearch, setMerchantSearch] = useState('');
  const [highlightMerchantId, setHighlightMerchantId] = useState<string | null>(null);
  /** 管理员：null = 全公司，数字 = 指定员工 */
  const [scopeUserId, setScopeUserId] = useState<number | null>(null);
  const [employeeSummaries, setEmployeeSummaries] = useState<SettlementEmployeeSummary[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [dataScope, setDataScope] = useState<'company' | 'user'>('user');

  useEffect(() => {
    if (!isAdmin) return;
    void (async () => {
      const { data } = await api.get<
        ApiResult<Array<{ id: number; username: string; isActive: boolean }>>
      >('/admin/users/summary', {
        params: {
          startDate: range[0].format('YYYY-MM-DD'),
          endDate: range[1].format('YYYY-MM-DD'),
        },
      });
      if (data.success) {
        setEmployees(
          data.data.filter((u) => u.isActive).map((u) => ({ id: u.id, username: u.username })),
        );
      }
    })();
  }, [isAdmin, range]);

  const loadSettlement = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<
        ApiResult<{
          items: SettlementRow[];
          stats: SettlementStats;
          platformSummaries: PlatformSummaryRow[];
          channelSummaries?: ChannelSummaryRow[];
          scope?: 'company' | 'user';
          employeeSummaries?: SettlementEmployeeSummary[];
        }>
      >('/orders/settlement/merchant-summary', {
        params: {
          startDate: range[0].format('YYYY-MM-DD'),
          endDate: range[1].format('YYYY-MM-DD'),
          ...(platformFilter !== 'all' ? { platformCode: platformFilter } : {}),
          ...(channelAccountFilter !== 'all' ? { channelAccountId: channelAccountFilter } : {}),
          ...(isAdmin && scopeUserId != null ? { userId: scopeUserId } : {}),
        },
      });
      if (data.success) {
        setItems(data.data.items);
        setStats(data.data.stats);
        setPlatformSummaries(data.data.platformSummaries ?? []);
        setChannelSummaries(data.data.channelSummaries ?? []);
        setDataScope(data.data.scope ?? 'user');
        setEmployeeSummaries(data.data.employeeSummaries ?? []);
      }
    } catch {
      message.error('结算数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [range, platformFilter, channelAccountFilter, isAdmin, scopeUserId]);

  useEffect(() => {
    loadSettlement();
  }, [loadSettlement]);

  const channelAccountOptions = useMemo(() => {
    let rows = channelSummaries;
    if (platformFilter !== 'all') {
      rows = rows.filter((c) => c.platformCode === platformFilter);
    }
    return [
      { value: 'all' as const, label: '全部渠道账号' },
      ...rows.map((c) => ({
        value: c.channelAccountId,
        label: `${c.displayName}${c.affiliateAlias ? ` (${c.affiliateAlias})` : ''}`,
      })),
    ];
  }, [channelSummaries, platformFilter]);

  const filteredChannelSummaries = useMemo(() => {
    let rows = channelSummaries;
    if (platformFilter !== 'all') {
      rows = rows.filter((c) => c.platformCode === platformFilter);
    }
    return rows;
  }, [channelSummaries, platformFilter]);

  const platformOptions = useMemo(() => {
    const rows = platformSummaries.length
      ? platformSummaries
      : [...new Map(items.map((r) => [r.platformCode, r])).values()].map((r) => ({
          platformCode: r.platformCode,
          platformName: r.platformName,
          collectorImplemented: true,
        }));
    return [
      { value: 'all', label: '全部平台' },
      ...rows.map((p) => ({
        value: p.platformCode,
        label: `${p.platformName}${p.collectorImplemented === false ? '（未接入）' : ''}`,
      })),
    ];
  }, [items, platformSummaries]);

  const filteredItems = useMemo(() => {
    let rows = items;
    const q = merchantSearch.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) =>
          r.merchantName?.toLowerCase().includes(q) ||
          r.merchantId?.toLowerCase().includes(q) ||
          r.affiliateAlias?.toLowerCase().includes(q),
      );
    }
    return rows;
  }, [items, merchantSearch]);

  const applyPreset = (days: number) => {
    setRange(lastNDaysToYesterday(days));
  };

  const settlementColumns: ColumnsType<SettlementRow> = [
    { title: '商家ID', dataIndex: 'merchantId', width: 100 },
    {
      title: '商家名',
      dataIndex: 'merchantName',
      ellipsis: true,
      render: (name: string, r) => name || r.merchantId || '—',
    },
    {
      title: '渠道账号',
      dataIndex: 'channelDisplayName',
      width: 160,
      ellipsis: true,
      render: (name: string, r) =>
        name ? (
          <span>
            {name}
            {r.affiliateAlias ? (
              <Typography.Text type="secondary" style={{ marginLeft: 4 }}>
                ({r.affiliateAlias})
              </Typography.Text>
            ) : null}
          </span>
        ) : (
          r.platformName
        ),
    },
    {
      title: '平台',
      dataIndex: 'platformName',
      width: 100,
    },
    { title: '订单数', dataIndex: 'orderCount', width: 80, align: 'right' },
    {
      title: '总佣金',
      dataIndex: 'totalCommission',
      width: 100,
      align: 'right',
      render: (v: number) => money(v),
    },
    {
      title: '已确认',
      dataIndex: 'confirmedCommission',
      width: 100,
      align: 'right',
      render: (v: number) => <Typography.Text type="success">{money(v)}</Typography.Text>,
    },
    {
      title: '待确认',
      dataIndex: 'pendingCommission',
      width: 100,
      align: 'right',
      render: (v: number) => (v > 0 ? money(v) : '—'),
    },
    {
      title: '已拒绝',
      dataIndex: 'rejectedCommission',
      width: 100,
      align: 'right',
      render: (v: number) =>
        v > 0 ? <Typography.Text type="danger">{money(v)}</Typography.Text> : '—',
    },
    {
      title: '结算率',
      dataIndex: 'settlementRate',
      width: 88,
      align: 'right',
      render: (v: number) => pct(v),
    },
    {
      title: '拒付率',
      dataIndex: 'rejectionRate',
      width: 88,
      align: 'right',
      render: (v: number, r) =>
        v >= 25 || r.rejectedCommission > 0 ? (
          <Typography.Text type={v >= 25 ? 'danger' : undefined}>{pct(v)}</Typography.Text>
        ) : (
          pct(v)
        ),
    },
  ];

  return (
    <div>
      {isAdmin && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={scopeUserId == null ? '全公司结算汇总' : `员工「${employees.find((e) => e.id === scopeUserId)?.username ?? scopeUserId}」结算`}
          description={
            scopeUserId == null
              ? '汇总所有活跃员工的联盟订单；下方可按员工下钻。失效监控使用管理员统一规则，便于在员工未察觉时提前干预。'
              : '仅显示该员工的联盟订单与失效佣金；可切回「全公司汇总」查看整体。'
          }
        />
      )}
      <Space wrap style={{ marginBottom: 16 }}>
        {isAdmin && (
          <Select
            style={{ width: 180 }}
            value={scopeUserId ?? 'all'}
            options={[
              { value: 'all', label: '全公司汇总' },
              ...employees.map((e) => ({ value: e.id, label: e.username })),
            ]}
            onChange={(v) => setScopeUserId(v === 'all' ? null : (v as number))}
          />
        )}
        <RangePicker value={range} onChange={(v) => v && setRange(v as [Dayjs, Dayjs])} />
        {DATE_PRESETS.map((p) => (
          <Button key={p.days} size="small" onClick={() => applyPreset(p.days)}>
            {p.label}
          </Button>
        ))}
      </Space>

      <CommissionMonitor
        range={range}
        platformFilter={platformFilter}
        onPlatformFilterChange={setPlatformFilter}
        scopeUserId={isAdmin ? scopeUserId : undefined}
        onScopeUserChange={isAdmin ? setScopeUserId : undefined}
        onFocusMerchant={(merchantId, platformCode) => {
          setMerchantSearch(merchantId);
          setHighlightMerchantId(merchantId);
          if (platformCode) setPlatformFilter(platformCode);
        }}
      />

      {isAdmin && dataScope === 'company' && employeeSummaries.length > 0 && (
        <Card title="分员工结算概览" style={{ marginBottom: 16 }} size="small">
          <Table
            rowKey="userId"
            size="small"
            pagination={false}
            dataSource={employeeSummaries}
            columns={[
              { title: '员工', dataIndex: 'username' },
              { title: '订单', dataIndex: ['stats', 'totalOrders'], align: 'right' as const },
              {
                title: '总佣金',
                align: 'right' as const,
                render: (_, r) => money(r.stats.totalCommission),
              },
              {
                title: '已拒绝',
                align: 'right' as const,
                render: (_, r) =>
                  r.stats.rejectedCommission > 0 ? (
                    <Typography.Text type="danger">{money(r.stats.rejectedCommission)}</Typography.Text>
                  ) : (
                    '—'
                  ),
              },
              {
                title: '拒付率',
                align: 'right' as const,
                render: (_, r) => pct(r.stats.rejectionRate),
              },
              {
                title: '操作',
                width: 120,
                render: (_, r) => (
                  <Button type="link" size="small" onClick={() => setScopeUserId(r.userId)}>
                    查看明细
                  </Button>
                ),
              },
            ]}
          />
        </Card>
      )}

      <Card title={scopeUserId == null && isAdmin ? '结算查询（全公司）' : '结算查询'}>
        <SettlementSyncCollect
          startDate={range[0].format('YYYY-MM-DD')}
          endDate={range[1].format('YYYY-MM-DD')}
          platformCode={platformFilter}
          channelAccountId={channelAccountFilter}
          targetUserId={isAdmin ? scopeUserId : undefined}
          isAdmin={isAdmin}
          companyWideScope={scopeUserId == null && isAdmin}
          onCompleted={loadSettlement}
        />
        <Space wrap style={{ marginBottom: 16 }}>
          <Select
            style={{ width: 160 }}
            value={platformFilter}
            options={platformOptions}
            onChange={(v) => {
              setPlatformFilter(v);
              setChannelAccountFilter('all');
            }}
          />
          <Select
            style={{ width: 220 }}
            value={channelAccountFilter}
            options={channelAccountOptions}
            onChange={(v) => setChannelAccountFilter(v)}
          />
          <Input.Search
            allowClear
            placeholder="搜索商家名 / ID"
            style={{ width: 200 }}
            value={merchantSearch}
            onChange={(e) => {
              setMerchantSearch(e.target.value);
              setHighlightMerchantId(null);
            }}
          />
          <Button type="primary" loading={loading} onClick={loadSettlement}>
            刷新结算
          </Button>
        </Space>

        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          按联盟订单 <Tag>orderDate</Tag> 与订单号去重汇总；拒付/待确认等状态以<strong>最后一次采集</strong>
          为准，「刷新结算」不重拉联盟 API，历史月份状态变更请用上方「重新采集」。
          {platformFilter !== 'all' ? (
            <Typography.Text type="warning" style={{ marginLeft: 8 }}>
              当前筛选：
              {platformOptions.find((o) => o.value === platformFilter)?.label ?? platformFilter}
            </Typography.Text>
          ) : null}
          {' '}
          下方按绑定的渠道账号分列，商家明细与统计卡片随筛选收窄。
        </Typography.Paragraph>

        {filteredChannelSummaries.length > 0 && (
          <Table
            size="small"
            style={{ marginBottom: 16 }}
            rowKey="channelAccountId"
            pagination={false}
            dataSource={filteredChannelSummaries}
            columns={[
              {
                title: '渠道账号',
                dataIndex: 'displayName',
                ellipsis: true,
                render: (name: string, r: ChannelSummaryRow) => (
                  <span>
                    {name}
                    {r.affiliateAlias ? (
                      <Typography.Text type="secondary" style={{ marginLeft: 4 }}>
                        ({r.affiliateAlias})
                      </Typography.Text>
                    ) : null}
                  </span>
                ),
              },
              {
                title: '平台',
                dataIndex: 'platformName',
                width: 120,
                render: (name: string, r: ChannelSummaryRow) => (
                  <span>
                    {name}
                    {r.collectorImplemented === false ? (
                      <Tag color="default" style={{ marginLeft: 6 }}>
                        未接入
                      </Tag>
                    ) : null}
                  </span>
                ),
              },
              { title: '订单', dataIndex: 'orderCount', width: 72, align: 'right' },
              {
                title: '总佣金',
                dataIndex: 'totalCommission',
                width: 96,
                align: 'right',
                render: (v: number) => (v > 0 ? money(v) : '—'),
              },
              {
                title: '已拒绝',
                dataIndex: 'rejectedCommission',
                width: 96,
                align: 'right',
                render: (v: number) =>
                  v > 0 ? <Typography.Text type="danger">{money(v)}</Typography.Text> : '—',
              },
              {
                title: '拒付率',
                dataIndex: 'rejectionRate',
                width: 80,
                align: 'right',
                render: (v: number) =>
                  v >= 25 ? (
                    <Typography.Text type="danger">{pct(v)}</Typography.Text>
                  ) : (
                    pct(v)
                  ),
              },
              {
                title: '操作',
                width: 72,
                render: (_, r: ChannelSummaryRow) => (
                  <Button
                    type="link"
                    size="small"
                    onClick={() => {
                      setPlatformFilter(r.platformCode);
                      setChannelAccountFilter(r.channelAccountId);
                    }}
                  >
                    筛选
                  </Button>
                ),
              },
            ]}
          />
        )}

        {platformSummaries.length > 0 && filteredChannelSummaries.length === 0 && (
          <Table
            size="small"
            style={{ marginBottom: 16 }}
            rowKey="platformCode"
            pagination={false}
            dataSource={platformSummaries}
            columns={[
              {
                title: '平台',
                dataIndex: 'platformName',
                width: 160,
                render: (name: string, r: PlatformSummaryRow) => (
                  <span>
                    {name}
                    {r.collectorImplemented === false ? (
                      <Tag color="default" style={{ marginLeft: 6 }}>
                        未接入
                      </Tag>
                    ) : null}
                  </span>
                ),
              },
              {
                title: '渠道',
                render: (_, r: PlatformSummaryRow) => r.channelAliases?.join(', ') || '—',
              },
              { title: '订单', dataIndex: 'orderCount', width: 72, align: 'right' },
              {
                title: '总佣金',
                dataIndex: 'totalCommission',
                width: 96,
                align: 'right',
                render: (v: number) => (v > 0 ? money(v) : '—'),
              },
              {
                title: '已拒绝',
                dataIndex: 'rejectedCommission',
                width: 96,
                align: 'right',
                render: (v: number) =>
                  v > 0 ? <Typography.Text type="danger">{money(v)}</Typography.Text> : '—',
              },
              {
                title: '拒付率',
                dataIndex: 'rejectionRate',
                width: 80,
                align: 'right',
                render: (v: number) =>
                  v >= 25 ? (
                    <Typography.Text type="danger">{pct(v)}</Typography.Text>
                  ) : (
                    pct(v)
                  ),
              },
              {
                title: '操作',
                width: 72,
                render: (_, r: PlatformSummaryRow) => (
                  <Button
                    type="link"
                    size="small"
                    onClick={() => setPlatformFilter(r.platformCode)}
                  >
                    筛选
                  </Button>
                ),
              },
            ]}
          />
        )}

        <Row gutter={[16, 16]}>
          <Col xs={12} sm={8} md={6} lg={4}>
            <Statistic title="总订单" value={stats.totalOrders} />
          </Col>
          <Col xs={12} sm={8} md={6} lg={4}>
            <Statistic title="总佣金" prefix="$" value={stats.totalCommission} precision={2} />
          </Col>
          <Col xs={12} sm={8} md={6} lg={4}>
            <Statistic
              title="已确认"
              prefix="$"
              value={stats.confirmedCommission}
              precision={2}
              valueStyle={{ color: '#3f8600' }}
            />
          </Col>
          <Col xs={12} sm={8} md={6} lg={4}>
            <Statistic title="待确认" prefix="$" value={stats.pendingCommission} precision={2} />
          </Col>
          <Col xs={12} sm={8} md={6} lg={4}>
            <Statistic
              title="已拒绝"
              prefix="$"
              value={stats.rejectedCommission}
              precision={2}
              valueStyle={{ color: '#cf1322' }}
            />
          </Col>
          <Col xs={12} sm={8} md={6} lg={4}>
            <Statistic title="整体结算率" suffix="%" value={stats.settlementRate} precision={1} />
          </Col>
          <Col xs={12} sm={8} md={6} lg={4}>
            <Statistic title="整体拒付率" suffix="%" value={stats.rejectionRate} precision={1} />
          </Col>
        </Row>

        <Table
          style={{ marginTop: 16 }}
          rowKey={(r) => `${r.merchantId}|${r.platformCode}|${r.affiliateAlias}`}
          loading={loading}
          dataSource={filteredItems}
          columns={settlementColumns}
          scroll={{ x: 1000 }}
          rowClassName={(r) =>
            highlightMerchantId && r.merchantId === highlightMerchantId ? 'settlement-row-risk' : ''
          }
          locale={{
            emptyText: (
              <Empty description="所选日期暂无联盟订单，请调整日期或先完成数据采集" />
            ),
          }}
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 个商家`,
          }}
        />
      </Card>

      <style>{`
        .settlement-row-risk td {
          background: #fff2f0 !important;
        }
      `}</style>
    </div>
  );
}
