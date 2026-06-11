import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Empty,
  Form,
  InputNumber,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  AlertOutlined,
  CheckCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api, type ApiResult } from '../api/client';

interface MonitorOverview {
  window: { startDate: string; endDate: string };
  rule: {
    isEnabled: boolean;
    rejectedAmountThreshold: number;
    rejectedRateThreshold: number;
    minRejectedOrders: number;
    minOrdersForRate: number;
    minRejectedForRate: number;
    autoCheckOnSync: boolean;
  };
  summary: {
    totalOrders: number;
    totalCommission: number;
    rejectedCommission: number;
    pendingCommission: number;
    overallRejectionRate: number;
    atRiskMerchantCount: number;
    openAlertCount: number;
    ackAlertCount: number;
  };
  watchlist: WatchlistRow[];
  platformSummaries: PlatformSummaryRow[];
  platformFilter: string | null;
  scope?: 'company' | 'user';
  selectedUserId?: number | null;
  employeeSummaries?: EmployeeMonitorSummary[];
}

interface EmployeeMonitorSummary {
  userId: number;
  username: string;
  rejectedCommission: number;
  rejectionRate: number;
  atRiskMerchantCount: number;
  openAlertCount: number;
}

interface PlatformSummaryRow {
  platformCode: string;
  platformName: string;
  collectorImplemented: boolean;
  channelAccountCount: number;
  channelAliases: string[];
  orderCount: number;
  totalCommission: number;
  rejectedCommission: number;
  rejectionRate: number;
  atRiskMerchantCount: number;
}

interface WatchlistRow {
  merchantId: string;
  merchantName: string;
  platformName: string;
  platformCode: string;
  affiliateAlias: string;
  orderCount: number;
  rejectedOrderCount: number;
  rejectedCommission: number;
  rejectionRate: number;
  pendingCommission: number;
  severity: string;
  reasons: string[];
  alertMerchantKey: string;
  userId?: number;
  username?: string;
}

interface CommissionAlertRow {
  id: number;
  merchantId: string;
  merchantName: string;
  rejectedCommission: number;
  pendingCommission: number;
  rejectedOrderCount: number;
  totalOrderCount: number;
  rejectionRate: number;
  severity: string;
  triggerReason: string;
  windowStart: string;
  windowEnd: string;
  status: string;
  lastTriggeredAt: string;
  username?: string;
  ownerUserId?: number;
}

interface CommissionMonitorProps {
  range: [Dayjs, Dayjs];
  platformFilter: string;
  onPlatformFilterChange: (code: string) => void;
  onFocusMerchant?: (merchantId: string, platformCode?: string) => void;
  /** 管理员：null/undefined 表示全公司 */
  scopeUserId?: number | null;
  onScopeUserChange?: (userId: number | null) => void;
}

function money(v: number) {
  return `$${Number(v).toFixed(2)}`;
}

function pct(v: number) {
  return `${Number(v).toFixed(1)}%`;
}

function severityTag(severity: string) {
  if (severity === 'critical') {
    return <Tag color="error">严重</Tag>;
  }
  return <Tag color="warning">警告</Tag>;
}

/**
 * 失效/拒绝佣金监控面板
 */
function collectorTag(implemented: boolean) {
  return implemented ? (
    <Tag color="success">已接入</Tag>
  ) : (
    <Tag color="default">未接入采集</Tag>
  );
}

export default function CommissionMonitor({
  range,
  platformFilter,
  onPlatformFilterChange,
  onFocusMerchant,
  scopeUserId,
  onScopeUserChange,
}: CommissionMonitorProps) {
  const [overview, setOverview] = useState<MonitorOverview | null>(null);
  const [alerts, setAlerts] = useState<CommissionAlertRow[]>([]);
  const [historyAlerts, setHistoryAlerts] = useState<CommissionAlertRow[]>([]);
  const [ruleForm] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [alertTab, setAlertTab] = useState('platforms');
  /** 表单是否与服务器已保存规则不一致 */
  const [ruleDirty, setRuleDirty] = useState(false);

  const startDate = range[0].format('YYYY-MM-DD');
  const endDate = range[1].format('YYYY-MM-DD');
  const showEmployeeCol = overview?.scope === 'company' && scopeUserId == null;

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<ApiResult<MonitorOverview>>('/commission-alerts/overview', {
        params: {
          startDate,
          endDate,
          ...(platformFilter !== 'all' ? { platformCode: platformFilter } : {}),
          ...(scopeUserId != null ? { userId: scopeUserId } : {}),
        },
      });
      if (data.success) setOverview(data.data);
    } catch {
      message.error('监控概览加载失败');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, platformFilter, scopeUserId]);

  useEffect(() => {
    if (!overview?.rule || ruleDirty) return;
    ruleForm.setFieldsValue({
      isEnabled: overview.rule.isEnabled,
      rejectedAmountThreshold: overview.rule.rejectedAmountThreshold,
      rejectedRateThreshold: overview.rule.rejectedRateThreshold,
      minRejectedOrders: overview.rule.minRejectedOrders,
      minOrdersForRate: overview.rule.minOrdersForRate,
      minRejectedForRate: overview.rule.minRejectedForRate,
      autoCheckOnSync: overview.rule.autoCheckOnSync,
    });
  }, [overview, ruleDirty, ruleForm]);

  const loadRule = async () => {
    const { data } = await api.get<ApiResult<Record<string, unknown>>>('/commission-alerts/rule');
    if (data.success) {
      ruleForm.setFieldsValue(data.data);
      setRuleDirty(false);
    }
  };

  const loadAlerts = useCallback(async () => {
    const params = {
      startDate,
      endDate,
      limit: 100,
      ...(platformFilter !== 'all' ? { platformCode: platformFilter } : {}),
      ...(scopeUserId != null ? { userId: scopeUserId } : {}),
    };
    const [openRes, histRes] = await Promise.all([
      api.get<ApiResult<CommissionAlertRow[]>>('/commission-alerts', {
        params: { ...params, status: 'open' },
      }),
      api.get<ApiResult<CommissionAlertRow[]>>('/commission-alerts', {
        params: { ...params, status: 'ack' },
      }),
    ]);
    if (openRes.data.success) setAlerts(openRes.data.data);
    if (histRes.data.success) setHistoryAlerts(histRes.data.data);
  }, [startDate, endDate, platformFilter, scopeUserId]);

  useEffect(() => {
    loadRule();
  }, []);

  useEffect(() => {
    loadOverview();
    loadAlerts();
  }, [loadOverview, loadAlerts]);

  const saveRule = async () => {
    const values = await ruleForm.validateFields();
    const { data } = await api.post<ApiResult<unknown>>('/commission-alerts/rule', values);
    if (data.success) {
      message.success('规则已保存，风险列表已按新阈值重新计算');
      setRuleDirty(false);
      await loadOverview();
      await loadAlerts();
    }
  };

  const handleRefresh = async () => {
    if (ruleDirty) {
      message.warning('规则已修改但未保存，当前列表仍按已保存的阈值计算。请先点击「保存规则」。');
    }
    await loadOverview();
    await loadAlerts();
  };

  const platformOptions = useMemo(() => {
    const rows = overview?.platformSummaries ?? [];
    return [
      { value: 'all', label: '全部平台' },
      ...rows.map((p) => ({
        value: p.platformCode,
        label: `${p.platformName}${p.collectorImplemented ? '' : '（未接入）'}`,
      })),
    ];
  }, [overview?.platformSummaries]);

  const runCheck = async (useRuleWindow: boolean) => {
    const body = useRuleWindow
      ? {
          ...(platformFilter !== 'all' ? { platformCode: platformFilter } : {}),
          ...(scopeUserId != null ? { userId: scopeUserId } : {}),
        }
      : {
          startDate,
          endDate,
          ...(platformFilter !== 'all' ? { platformCode: platformFilter } : {}),
          ...(scopeUserId != null ? { userId: scopeUserId } : {}),
        };
    const { data } = await api.post<ApiResult<{ triggered: number; message?: string }>>(
      '/commission-alerts/check',
      body,
    );
    if (data.success) {
      message.success(data.data.message ?? '检查完成');
      loadOverview();
      loadAlerts();
    }
  };

  const ackAlert = async (id: number) => {
    const { data } = await api.post<ApiResult<unknown>>(`/commission-alerts/${id}/ack`);
    if (data.success) {
      message.success('已确认');
      loadAlerts();
      loadOverview();
    }
  };

  const watchColumns: ColumnsType<WatchlistRow> = [
    {
      title: '级别',
      width: 72,
      render: (_, r) => severityTag(r.severity),
    },
    ...(showEmployeeCol
      ? [
          {
            title: '员工',
            dataIndex: 'username',
            width: 88,
            render: (name: string, r: WatchlistRow) =>
              name ? (
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0 }}
                  onClick={() => r.userId != null && onScopeUserChange?.(r.userId)}
                >
                  {name}
                </Button>
              ) : (
                '—'
              ),
          },
        ]
      : []),
    { title: '商家', dataIndex: 'merchantName', ellipsis: true },
    { title: 'ID', dataIndex: 'merchantId', width: 88 },
    {
      title: '平台',
      width: 130,
      render: (_, r) => `${r.platformName} (${r.affiliateAlias || '—'})`,
    },
    {
      title: '失效佣金',
      dataIndex: 'rejectedCommission',
      width: 100,
      align: 'right',
      render: (v: number) => <Typography.Text type="danger">{money(v)}</Typography.Text>,
    },
    {
      title: '失效率',
      dataIndex: 'rejectionRate',
      width: 80,
      align: 'right',
      render: (v: number) => pct(v),
    },
    {
      title: '拒付单',
      width: 80,
      align: 'right',
      render: (_, r) => `${r.rejectedOrderCount}/${r.orderCount}`,
    },
    {
      title: '触发条件',
      dataIndex: 'reasons',
      ellipsis: true,
      render: (reasons: string[]) => reasons.join('；'),
    },
    {
      title: '操作',
      width: 72,
      render: (_, r) => (
        <Button
          type="link"
          size="small"
          onClick={() => onFocusMerchant?.(r.merchantId, r.platformCode)}
        >
          定位
        </Button>
      ),
    },
  ];

  const alertColumns: ColumnsType<CommissionAlertRow> = [
    {
      title: '级别',
      width: 72,
      render: (_, r) => severityTag(r.severity),
    },
    ...(showEmployeeCol
      ? [
          {
            title: '员工',
            dataIndex: 'username',
            width: 88,
            render: (name: string, r: CommissionAlertRow) =>
              name ? (
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0 }}
                  onClick={() => r.ownerUserId != null && onScopeUserChange?.(r.ownerUserId)}
                >
                  {name}
                </Button>
              ) : (
                '—'
              ),
          },
        ]
      : []),
    { title: '商家', dataIndex: 'merchantName', ellipsis: true },
    {
      title: '失效佣金',
      dataIndex: 'rejectedCommission',
      width: 100,
      render: (v: number) => money(Number(v)),
    },
    {
      title: '失效率',
      dataIndex: 'rejectionRate',
      width: 72,
      render: (v: number) => pct(Number(v)),
    },
    {
      title: '订单',
      width: 72,
      render: (_, r) => `${r.rejectedOrderCount}/${r.totalOrderCount}`,
    },
    { title: '原因', dataIndex: 'triggerReason', ellipsis: true },
    {
      title: '时间',
      width: 100,
      render: (_, r) => dayjs(r.lastTriggeredAt).format('MM-DD HH:mm'),
    },
    {
      title: '操作',
      width: 72,
      render: (_, r) =>
        r.status === 'open' ? (
          <Button type="link" size="small" onClick={() => ackAlert(r.id)}>
            确认
          </Button>
        ) : (
          <Typography.Text type="secondary">已确认</Typography.Text>
        ),
    },
  ];

  const summary = overview?.summary;

  return (
    <Card
      title={
        <Space>
          <AlertOutlined />
          失效/拒绝佣金监控
          {summary && summary.openAlertCount > 0 ? (
            <Badge count={summary.openAlertCount} />
          ) : null}
        </Space>
      }
      style={{ marginBottom: 16 }}
      loading={loading && !overview}
    >
      {summary && summary.rejectedCommission > 0 && summary.openAlertCount === 0 ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`区间内有 $${summary.rejectedCommission.toFixed(2)} 失效佣金，${summary.atRiskMerchantCount} 个商家达风险线但未生成告警记录，请点击「同步告警」`}
        />
      ) : null}

      {overview && !overview.rule.isEnabled ? (
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="监控已关闭，开启后将按规则检测" />
      ) : null}

      {ruleDirty ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="规则未保存"
          description="修改阈值后须点击「保存规则」，风险商家列表才会按新阈值重算。「刷新」不会应用未保存的修改。"
        />
      ) : overview?.rule ? (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 12 }}
          message={`当前生效阈值：失效佣金 ≥ $${overview.rule.rejectedAmountThreshold}，失效率 ≥ ${overview.rule.rejectedRateThreshold}%（率规则最低失效 $${overview.rule.minRejectedForRate}）`}
        />
      ) : null}

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={8} md={4}>
          <Statistic
            title="失效佣金"
            prefix="$"
            value={summary?.rejectedCommission ?? 0}
            precision={2}
            valueStyle={{ color: '#cf1322' }}
          />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Statistic
            title="整体拒付率"
            suffix="%"
            value={summary?.overallRejectionRate ?? 0}
            precision={1}
          />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Statistic
            title="风险商家"
            value={summary?.atRiskMerchantCount ?? 0}
            prefix={<WarningOutlined />}
            valueStyle={{ color: summary?.atRiskMerchantCount ? '#fa8c16' : undefined }}
          />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Statistic title="待处理告警" value={summary?.openAlertCount ?? 0} />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Statistic title="已确认" value={summary?.ackAlertCount ?? 0} />
        </Col>
      </Row>

      <Form
        form={ruleForm}
        layout="vertical"
        size="small"
        onValuesChange={() => setRuleDirty(true)}
        initialValues={{
          isEnabled: true,
          windowDays: 30,
          rejectedAmountThreshold: 100,
          rejectedRateThreshold: 25,
          minRejectedOrders: 1,
          minOrdersForRate: 1,
          minRejectedForRate: 1,
          autoCheckOnSync: true,
        }}
        style={{ marginBottom: 12 }}
      >
        <Row gutter={16}>
          <Col span={24}>
            <Typography.Text type="secondary">
              满足任一即告警：失效佣金 ≥ 金额阈值，或 失效率 ≥ 比例阈值（且失效佣金 ≥ 最低金额）。
              检测按「商家+平台」合并全部渠道，与结算表口径一致；采集成功后会按任务日期自动检查。
            </Typography.Text>
          </Col>
        </Row>
        <Row gutter={12} style={{ marginTop: 8 }}>
          <Col>
            <Form.Item name="isEnabled" label="启用" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch />
            </Form.Item>
          </Col>
          <Col>
            <Form.Item name="windowDays" label="规则窗口(天)" style={{ marginBottom: 0 }}>
              <InputNumber min={1} max={180} style={{ width: 88 }} />
            </Form.Item>
          </Col>
          <Col>
            <Form.Item
              name="rejectedAmountThreshold"
              label={
                <Tooltip title="商家失效佣金累计达到该值即告警">失效佣金($)</Tooltip>
              }
              style={{ marginBottom: 0 }}
            >
              <InputNumber min={0} style={{ width: 100 }} />
            </Form.Item>
          </Col>
          <Col>
            <Form.Item
              name="rejectedRateThreshold"
              label={
                <Tooltip title="失效佣金 ÷ 该商家总佣金（与结算表拒付率一致，非按订单笔数）">
                  失效率(%)
                </Tooltip>
              }
              style={{ marginBottom: 0 }}
            >
              <InputNumber min={0} max={100} style={{ width: 88 }} />
            </Form.Item>
          </Col>
          <Col>
            <Form.Item
              name="minRejectedForRate"
              label={<Tooltip title="失效率规则要求至少失效这么多佣金">率规则最低失效$</Tooltip>}
              style={{ marginBottom: 0 }}
            >
              <InputNumber min={0} step={0.5} style={{ width: 100 }} />
            </Form.Item>
          </Col>
          <Col>
            <Form.Item
              name="minOrdersForRate"
              label={<Tooltip title="至少多少单才用失效率判断">最少订单数</Tooltip>}
              style={{ marginBottom: 0 }}
            >
              <InputNumber min={1} style={{ width: 72 }} />
            </Form.Item>
          </Col>
          <Col>
            <Form.Item
              name="autoCheckOnSync"
              label="采集后自动检查"
              valuePropName="checked"
              style={{ marginBottom: 0 }}
            >
              <Switch />
            </Form.Item>
          </Col>
        </Row>
        <Space wrap style={{ marginTop: 12 }}>
          <Select
            style={{ width: 180 }}
            value={platformFilter}
            options={platformOptions}
            onChange={onPlatformFilterChange}
          />
          <Button type="primary" onClick={() => void saveRule()}>
            保存规则
          </Button>
          <Button type="primary" icon={<AlertOutlined />} onClick={() => runCheck(false)}>
            同步告警（当前查询区间）
          </Button>
          <Button onClick={() => runCheck(true)}>按规则窗口检查</Button>
          <Button onClick={() => void handleRefresh()}>刷新</Button>
        </Space>
      </Form>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="风险商家与结算查询口径一致"
        description="按「商家 + 平台 + 渠道序号」统计所选日期区间内的订单；与上方失效佣金汇总、结算表一致。若与旧告警记录不符，请点击「同步告警（当前查询区间）」刷新。"
      />

      {overview?.platformFilter && overview.platformFilter !== 'all' ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={`当前仅显示平台：${overview.platformSummaries.find((p) => p.platformCode === overview.platformFilter)?.platformName ?? overview.platformFilter}`}
        />
      ) : null}

      <Tabs
        activeKey={alertTab}
        onChange={setAlertTab}
        items={[
          {
            key: 'platforms',
            label: '分平台',
            children: (
              <Table
                rowKey="platformCode"
                size="small"
                dataSource={overview?.platformSummaries ?? []}
                pagination={false}
                columns={[
                  {
                    title: '平台',
                    dataIndex: 'platformName',
                    render: (name: string, r: PlatformSummaryRow) => (
                      <Space>
                        {name}
                        {collectorTag(r.collectorImplemented)}
                      </Space>
                    ),
                  },
                  {
                    title: '渠道',
                    dataIndex: 'channelAliases',
                    render: (aliases: string[]) => aliases.join(', ') || '—',
                  },
                  { title: '订单', dataIndex: 'orderCount', width: 72, align: 'right' },
                  {
                    title: '失效佣金',
                    dataIndex: 'rejectedCommission',
                    width: 100,
                    align: 'right',
                    render: (v: number) =>
                      v > 0 ? (
                        <Typography.Text type="danger">{money(v)}</Typography.Text>
                      ) : (
                        '—'
                      ),
                  },
                  {
                    title: '拒付率',
                    dataIndex: 'rejectionRate',
                    width: 80,
                    align: 'right',
                    render: (v: number) => {
                      const rateTh = overview?.rule.rejectedRateThreshold ?? 25;
                      return v >= rateTh ? (
                        <Typography.Text type="danger">{pct(v)}</Typography.Text>
                      ) : (
                        pct(v)
                      );
                    },
                  },
                  {
                    title: '风险商家',
                    dataIndex: 'atRiskMerchantCount',
                    width: 88,
                    align: 'right',
                    render: (n: number) =>
                      n > 0 ? <Typography.Text type="warning">{n}</Typography.Text> : 0,
                  },
                  {
                    title: '操作',
                    width: 72,
                    render: (_, r: PlatformSummaryRow) => (
                      <Button
                        type="link"
                        size="small"
                        onClick={() => onPlatformFilterChange(r.platformCode)}
                      >
                        筛选
                      </Button>
                    ),
                  },
                ]}
              />
            ),
          },
          ...(overview?.employeeSummaries?.length
            ? [
                {
                  key: 'employees',
                  label: '分员工',
                  children: (
                    <Table
                      rowKey="userId"
                      size="small"
                      dataSource={overview.employeeSummaries}
                      pagination={false}
                      columns={[
                        {
                          title: '员工',
                          dataIndex: 'username',
                          render: (name: string, r: EmployeeMonitorSummary) => (
                            <Button
                              type="link"
                              size="small"
                              style={{ padding: 0 }}
                              onClick={() => onScopeUserChange?.(r.userId)}
                            >
                              {name}
                            </Button>
                          ),
                        },
                        {
                          title: '失效佣金',
                          dataIndex: 'rejectedCommission',
                          align: 'right' as const,
                          render: (v: number) =>
                            v > 0 ? (
                              <Typography.Text type="danger">{money(v)}</Typography.Text>
                            ) : (
                              '—'
                            ),
                        },
                        {
                          title: '拒付率',
                          dataIndex: 'rejectionRate',
                          align: 'right' as const,
                          render: (v: number) => pct(v),
                        },
                        {
                          title: '风险商家',
                          dataIndex: 'atRiskMerchantCount',
                          align: 'right' as const,
                          render: (n: number) =>
                            n > 0 ? <Typography.Text type="warning">{n}</Typography.Text> : 0,
                        },
                        {
                          title: '待处理告警',
                          dataIndex: 'openAlertCount',
                          align: 'right' as const,
                        },
                        {
                          title: '操作',
                          width: 100,
                          render: (_: unknown, r: EmployeeMonitorSummary) => (
                            <Button
                              type="link"
                              size="small"
                              onClick={() => onScopeUserChange?.(r.userId)}
                            >
                              下钻
                            </Button>
                          ),
                        },
                      ]}
                    />
                  ),
                },
              ]
            : []),
          {
            key: 'watchlist',
            label: (
              <span>
                风险商家
                {summary?.atRiskMerchantCount ? (
                  <Badge count={summary.atRiskMerchantCount} size="small" style={{ marginLeft: 6 }} />
                ) : null}
              </span>
            ),
            children: (
              <Table
                rowKey={(r) =>
                  `${r.userId ?? 0}|${r.alertMerchantKey}|${r.affiliateAlias ?? ''}`
                }
                size="small"
                dataSource={overview?.watchlist ?? []}
                columns={watchColumns}
                pagination={{ pageSize: 8 }}
                locale={{
                  emptyText: (
                    <Empty
                      image={<CheckCircleOutlined style={{ fontSize: 40, color: '#52c41a' }} />}
                      description="当前区间无达阈值的商家"
                    />
                  ),
                }}
              />
            ),
          },
          {
            key: 'open',
            label: (
              <span>
                待处理告警
                {alerts.length > 0 ? (
                  <Badge count={alerts.length} size="small" style={{ marginLeft: 6 }} />
                ) : null}
              </span>
            ),
            children: (
              <Table
                rowKey="id"
                size="small"
                dataSource={alerts}
                columns={alertColumns}
                pagination={{ pageSize: 8 }}
                locale={{ emptyText: <Empty description="暂无待处理告警，可点击「同步告警」" /> }}
              />
            ),
          },
          {
            key: 'history',
            label: '已确认',
            children: (
              <Table
                rowKey="id"
                size="small"
                dataSource={historyAlerts}
                columns={alertColumns}
                pagination={{ pageSize: 8 }}
                locale={{ emptyText: <Empty description="暂无已确认记录" /> }}
              />
            ),
          },
        ]}
      />
    </Card>
  );
}
