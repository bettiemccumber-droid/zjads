import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Empty,
  Select,
  Table,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import { api, type ApiResult } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { employeeDefaultDateRange } from '../utils/date-range.util';
import { parseScopedViewUserId } from '../utils/team-scope.util';
import { OPS_PLATFORM_SHORT, opsPlatformShort } from '../utils/opsPlatform';
import './PlatformDailyPage.css';

const { RangePicker } = DatePicker;

type PlatformDailyDay = {
  date: string;
  clicks: number;
  orders: number;
  cost: number;
  commission: number;
  rejected: number;
  profit: number;
};

type PlatformDailyResult = {
  platformCode: string;
  startDate: string;
  endDate: string;
  totals: {
    clicks: number;
    orders: number;
    cost: number;
    commission: number;
    rejected: number;
    profit: number;
  };
  days: PlatformDailyDay[];
  accountCount: number;
};

type PlatformOption = { value: string; label: string };

const FALLBACK_PLATFORMS: PlatformOption[] = Object.entries(OPS_PLATFORM_SHORT).map(([value, short]) => ({
  value,
  label: `${short}（${value}）`,
}));

const EMPTY_TOTALS = {
  clicks: 0,
  orders: 0,
  cost: 0,
  commission: 0,
  rejected: 0,
  profit: 0,
};

function formatMoney(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function MoneyCell({
  value,
  kind,
}: {
  value: number;
  kind: 'cost' | 'commission' | 'rejected' | 'profit';
}) {
  const neg = kind === 'profit' && value < 0;
  return (
    <span className={`pd-num pd-money-${kind}${neg ? ' is-neg' : ''}`}>
      {formatMoney(value)}
    </span>
  );
}

/**
 * 平台按天 P&L：广告点击/花费 + 联盟订单佣金/拒付。
 */
export default function PlatformDailyPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [searchParams] = useSearchParams();
  const viewUserId = parseScopedViewUserId(user, isAdmin, searchParams.get('userId'));
  const viewUsername =
    user?.teamMembers?.find((m) => m.id === viewUserId)?.username
    ?? (viewUserId != null ? `用户#${viewUserId}` : '');

  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => employeeDefaultDateRange());
  const [platformCode, setPlatformCode] = useState('famesta');
  const [platformOptions, setPlatformOptions] = useState<PlatformOption[]>(FALLBACK_PLATFORMS);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PlatformDailyResult | null>(null);

  const dateParams = useMemo(
    () => ({
      startDate: range[0].format('YYYY-MM-DD'),
      endDate: range[1].format('YYYY-MM-DD'),
      ...(viewUserId ? { userId: viewUserId } : {}),
    }),
    [range, viewUserId],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.get<ApiResult<Array<{ platformCode: string; accounts: unknown[] }>>>(
          '/channel-accounts/by-platform',
          { params: viewUserId ? { userId: viewUserId } : undefined },
        );
        if (cancelled || !res.data.success) return;
        const fromAccounts = res.data.data
          .map((group) => group.platformCode)
          .filter(Boolean)
          .map((code) => ({
            value: code,
            label: `${opsPlatformShort(code)}（${code}）`,
          }));
        if (fromAccounts.length) {
          setPlatformOptions(fromAccounts);
          setPlatformCode((prev) => (fromAccounts.some((item) => item.value === prev) ? prev : fromAccounts[0].value));
        }
      } catch {
        // 保留默认平台列表
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewUserId]);

  const load = useCallback(async () => {
    if (!platformCode) {
      message.warning('请选择平台');
      return;
    }
    setLoading(true);
    try {
      const res = await api.get<ApiResult<PlatformDailyResult>>('/reports/platform-daily', {
        params: {
          ...dateParams,
          platformCode,
        },
      });
      if (!res.data.success) {
        message.error(res.data.message || '加载失败');
        return;
      }
      setData(res.data.data);
    } catch (err) {
      const apiMessage = (err as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      message.error(Array.isArray(apiMessage) ? apiMessage.join('；') : apiMessage || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [dateParams, platformCode]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: ColumnsType<PlatformDailyDay> = [
    {
      title: '日期',
      dataIndex: 'date',
      width: 128,
      align: 'center',
      render: (value: string) => <span className="pd-date">{value}</span>,
    },
    {
      title: '点击',
      dataIndex: 'clicks',
      align: 'center',
      render: (value: number) => <span className="pd-num">{value.toLocaleString()}</span>,
    },
    {
      title: '订单',
      dataIndex: 'orders',
      align: 'center',
      render: (value: number) => <span className="pd-num pd-num--orders">{value.toLocaleString()}</span>,
    },
    {
      title: '花费 ($)',
      dataIndex: 'cost',
      align: 'center',
      render: (value: number) => <MoneyCell value={value} kind="cost" />,
    },
    {
      title: '佣金 ($)',
      dataIndex: 'commission',
      align: 'center',
      render: (value: number) => <MoneyCell value={value} kind="commission" />,
    },
    {
      title: '拒付 ($)',
      dataIndex: 'rejected',
      align: 'center',
      render: (value: number) => <MoneyCell value={value} kind="rejected" />,
    },
    {
      title: '利润 ($)',
      dataIndex: 'profit',
      align: 'center',
      render: (value: number) => <MoneyCell value={value} kind="profit" />,
    },
  ];

  const totals = data?.totals ?? EMPTY_TOTALS;
  const days = data?.days ?? [];
  const hasAnySignal = days.some(
    (day) =>
      day.clicks > 0
      || day.orders > 0
      || day.cost > 0
      || day.commission > 0
      || day.rejected > 0
      || day.profit !== 0,
  );

  const metrics = [
    { key: 'clicks', label: '总点击', value: totals.clicks.toLocaleString(), className: 'pd-metric--clicks' },
    { key: 'orders', label: '总订单', value: totals.orders.toLocaleString(), className: 'pd-metric--orders' },
    { key: 'cost', label: '总花费', value: `$${formatMoney(totals.cost)}`, className: 'pd-metric--cost' },
    {
      key: 'commission',
      label: '总佣金',
      value: `$${formatMoney(totals.commission)}`,
      className: 'pd-metric--commission',
    },
    {
      key: 'rejected',
      label: '总拒付',
      value: `$${formatMoney(totals.rejected)}`,
      className: 'pd-metric--rejected',
    },
    {
      key: 'profit',
      label: '总利润',
      value: `$${formatMoney(totals.profit)}`,
      className: `pd-metric--profit${totals.profit < 0 ? ' is-neg' : ''}`,
    },
  ] as const;

  const rangeLabel = data ? `${data.startDate} ~ ${data.endDate}` : `${dateParams.startDate} ~ ${dateParams.endDate}`;

  return (
    <div className="platform-daily-page">
      <div className="pd-header">
        <div>
          <Typography.Title level={4}>
            {viewUserId && isAdmin ? `平台日报（${viewUsername}）` : '平台日报'}
          </Typography.Title>
          <p className="pd-header-desc">
            点击/花费来自广告系列日报；订单/佣金/拒付来自联盟订单。利润 = 佣金 − 拒付 − 花费。
          </p>
        </div>
      </div>

      <div className="pd-toolbar">
        <Select
          style={{ minWidth: 180 }}
          value={platformCode}
          options={platformOptions}
          onChange={setPlatformCode}
          showSearch
          optionFilterProp="label"
        />
        <RangePicker value={range} onChange={(value) => value && setRange(value as [Dayjs, Dayjs])} />
        <Button type="primary" loading={loading} onClick={() => void load()}>
          查询
        </Button>
        <Link
          className="pd-toolbar-link"
          to={viewUserId ? `/dashboard?userId=${viewUserId}` : '/dashboard'}
        >
          去数据采集
        </Link>
      </div>

      <div className="pd-metrics">
        {metrics.map((item) => (
          <div key={item.key} className={`pd-metric ${item.className}`}>
            <div className="pd-metric-label">{item.label}</div>
            <div className="pd-metric-value">{item.value}</div>
          </div>
        ))}
      </div>

      {!hasAnySignal && !loading ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={data?.accountCount === 0 ? '当前用户下没有该平台账号' : '这个区间还没有订单或广告数据'}
          description={(
            <span>
              {data?.accountCount === 0
                ? '请先在「我的平台账号」添加并启用该平台，再到数据采集同步。'
                : (
                  <>
                    请先到
                    {' '}
                    <Link to={viewUserId ? `/dashboard?userId=${viewUserId}` : '/dashboard'}>数据采集</Link>
                    {' '}
                    同步联盟订单，并确认广告系列日报已导入对应日期；然后再回来查询。
                  </>
                )}
            </span>
          )}
        />
      ) : null}

      <Card
        className="pd-table-card"
        title={`${opsPlatformShort(platformCode)} · 按天明细`}
        extra={<Typography.Text type="secondary" style={{ fontSize: 12 }}>{rangeLabel}</Typography.Text>}
      >
        <Table
          className="pd-table"
          rowKey="date"
          size="middle"
          loading={loading}
          columns={columns}
          dataSource={days}
          pagination={{ pageSize: 15, showSizeChanger: true, showTotal: (total) => `共 ${total} 天` }}
          locale={{ emptyText: <Empty description="暂无数据" /> }}
          scroll={{ x: 720 }}
          summary={() => (
            <Table.Summary fixed>
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} align="center">合计</Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="center">
                  <span className="pd-num">{totals.clicks.toLocaleString()}</span>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="center">
                  <span className="pd-num pd-num--orders">{totals.orders.toLocaleString()}</span>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={3} align="center">
                  <MoneyCell value={totals.cost} kind="cost" />
                </Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="center">
                  <MoneyCell value={totals.commission} kind="commission" />
                </Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="center">
                  <MoneyCell value={totals.rejected} kind="rejected" />
                </Table.Summary.Cell>
                <Table.Summary.Cell index={6} align="center">
                  <MoneyCell value={totals.profit} kind="profit" />
                </Table.Summary.Cell>
              </Table.Summary.Row>
            </Table.Summary>
          )}
        />
      </Card>
    </div>
  );
}
