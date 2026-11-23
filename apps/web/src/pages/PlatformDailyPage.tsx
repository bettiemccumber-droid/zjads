import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Row,
  Select,
  Space,
  Statistic,
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

const { RangePicker } = DatePicker;

type PlatformDailyDay = {
  date: string;
  clicks: number;
  orders: number;
  commission: number;
};

type PlatformDailyResult = {
  platformCode: string;
  startDate: string;
  endDate: string;
  totals: { clicks: number; orders: number; commission: number };
  days: PlatformDailyDay[];
  accountCount: number;
};

type PlatformOption = { value: string; label: string };

const FALLBACK_PLATFORMS: PlatformOption[] = Object.entries(OPS_PLATFORM_SHORT).map(([value, short]) => ({
  value,
  label: `${short}（${value}）`,
}));

/**
 * 平台按天佣金：只读展示已采集日报，不改动数据采集页。
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
    { title: '日期', dataIndex: 'date', width: 140 },
    {
      title: '点击',
      dataIndex: 'clicks',
      align: 'right',
      render: (value: number) => value.toLocaleString(),
    },
    {
      title: '订单',
      dataIndex: 'orders',
      align: 'right',
      render: (value: number) => value.toLocaleString(),
    },
    {
      title: '预估佣金 ($)',
      dataIndex: 'commission',
      align: 'right',
      render: (value: number) => value.toFixed(2),
    },
  ];

  const totals = data?.totals ?? { clicks: 0, orders: 0, commission: 0 };
  const days = data?.days ?? [];
  const hasAnySignal = days.some((day) => day.clicks > 0 || day.orders > 0 || day.commission > 0);

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {viewUserId && isAdmin ? `平台日报（${viewUsername}）` : '平台日报'}
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        按平台查看每天预估佣金。订单与佣金来自已同步入库的联盟订单，点击来自联盟点击日报（与「数据采集」同源）。
      </Typography.Paragraph>

      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
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
          <Link to={viewUserId ? `/dashboard?userId=${viewUserId}` : '/dashboard'}>去数据采集</Link>
        </Space>
      </Card>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title="总点击" value={totals.clicks} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title="总订单" value={totals.orders} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title="总预估佣金" prefix="$" value={totals.commission} precision={2} />
          </Card>
        </Col>
      </Row>

      {!hasAnySignal && !loading ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={data?.accountCount === 0 ? '当前用户下没有该平台账号' : '这个区间还没有订单或点击数据'}
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
                    勾选该平台账号并同步对应日期；同步后再回来查询。
                  </>
                )}
            </span>
          )}
        />
      ) : null}

      <Card title={`${opsPlatformShort(platformCode)} · 按天明细`}>
        <Table
          rowKey="date"
          loading={loading}
          columns={columns}
          dataSource={days}
          pagination={{ pageSize: 15, showSizeChanger: true, showTotal: (total) => `共 ${total} 天` }}
          locale={{ emptyText: <Empty description="暂无数据" /> }}
          summary={() => (
            <Table.Summary fixed>
              <Table.Summary.Row>
                <Table.Summary.Cell index={0}>合计</Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">{totals.clicks.toLocaleString()}</Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="right">{totals.orders.toLocaleString()}</Table.Summary.Cell>
                <Table.Summary.Cell index={3} align="right">{totals.commission.toFixed(2)}</Table.Summary.Cell>
              </Table.Summary.Row>
            </Table.Summary>
          )}
        />
      </Card>
    </div>
  );
}
