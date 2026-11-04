import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  DatePicker,
  Empty,
  Input,
  Select,
  Slider,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type ApiResult } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { parseScopedViewUserId } from '../../utils/team-scope.util';
import {
  adminDefaultDateRange,
  employeeDefaultDateRange,
  lastNDaysToYesterday,
} from '../../utils/date-range.util';

const { RangePicker } = DatePicker;

interface SettlementRow {
  merchantId: string;
  merchantName: string;
  platformName: string;
  platformCode: string;
  affiliateAlias: string;
  orderCount: number;
  totalCommission: number;
  confirmedCommission: number;
  pendingCommission: number;
  rejectedCommission: number;
  rejectionRate: number;
}

interface EmployeeOption {
  id: number;
  username: string;
}

const DATE_PRESETS: { label: string; days: number }[] = [
  { label: '近7天', days: 7 },
  { label: '近30天', days: 30 },
  { label: '近90天', days: 90 },
];

function money(v: number) {
  return `$${Number(v).toFixed(2)}`;
}

function pct(v: number) {
  return `${Number(v).toFixed(2)}%`;
}

const PLATFORM_SHORT: Record<string, string> = {
  partnermatic: 'PM',
  linkhaitao: 'LH',
  linkbux: 'LB',
  rewardoo: 'RW',
  collabglow: 'CG',
  ultrainfluence: 'UI',
  famesta: 'FS',
};

/** 拒付分析 · 拒付商家 Tab */
export default function ChargebackMerchantsPage() {
  const { user, isAdmin } = useAuth();
  const [searchParams] = useSearchParams();
  const scopedMemberId = parseScopedViewUserId(user, isAdmin, searchParams.get('userId'));

  const [range, setRange] = useState<[Dayjs, Dayjs]>(() =>
    isAdmin ? adminDefaultDateRange() : employeeDefaultDateRange(),
  );
  const [draftRange, setDraftRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [merchantSearch, setMerchantSearch] = useState('');
  const [draftSearch, setDraftSearch] = useState('');
  const [rejectionThreshold, setRejectionThreshold] = useState(0);
  const [draftThreshold, setDraftThreshold] = useState(0);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<SettlementRow[]>([]);
  const [scopeUserId, setScopeUserId] = useState<number | null>(null);
  const effectiveScopeUserId = isAdmin ? scopeUserId : scopedMemberId ?? null;
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);

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

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<
        ApiResult<{ items: SettlementRow[] }>
      >('/orders/settlement/merchant-summary', {
        params: {
          startDate: range[0].format('YYYY-MM-DD'),
          endDate: range[1].format('YYYY-MM-DD'),
          ...(platformFilter !== 'all' ? { platformCode: platformFilter } : {}),
          ...(effectiveScopeUserId != null ? { userId: effectiveScopeUserId } : {}),
        },
      });
      if (data.success) {
        setItems(data.data.items);
      }
    } catch {
      message.error('拒付商家数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [range, platformFilter, effectiveScopeUserId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const platformOptions = useMemo(() => {
    const codes = [...new Set(items.map((i) => i.platformCode))].sort();
    return [
      { value: 'all', label: '全部平台' },
      ...codes.map((c) => ({
        value: c,
        label: items.find((i) => i.platformCode === c)?.platformName ?? c,
      })),
    ];
  }, [items]);

  const filteredRows = useMemo(() => {
    const q = merchantSearch.trim().toLowerCase();
    return items
      .filter((r) => r.rejectedCommission > 0)
      .filter((r) => r.rejectionRate >= rejectionThreshold)
      .filter((r) => {
        if (!q) return true;
        return (
          r.merchantId.toLowerCase().includes(q) ||
          (r.merchantName ?? '').toLowerCase().includes(q)
        );
      })
      .sort(
        (a, b) =>
          b.rejectedCommission - a.rejectedCommission ||
          b.rejectionRate - a.rejectionRate,
      );
  }, [items, merchantSearch, rejectionThreshold]);

  const applyQuery = () => {
    if (draftRange) setRange(draftRange);
    setMerchantSearch(draftSearch);
    setRejectionThreshold(draftThreshold);
  };

  const resetFilters = () => {
    const defaultRange = isAdmin ? adminDefaultDateRange() : employeeDefaultDateRange();
    setDraftRange(null);
    setRange(defaultRange);
    setDraftSearch('');
    setMerchantSearch('');
    setDraftThreshold(0);
    setRejectionThreshold(0);
    setPlatformFilter('all');
  };

  const columns: ColumnsType<SettlementRow> = [
    {
      title: '平台',
      width: 72,
      align: 'center',
      render: (_, r) => (
        <Tag>{PLATFORM_SHORT[r.platformCode] ?? r.platformCode.toUpperCase().slice(0, 4)}</Tag>
      ),
    },
    { title: 'MID', dataIndex: 'merchantId', width: 96 },
    {
      title: '商家名称',
      dataIndex: 'merchantName',
      ellipsis: true,
      render: (name: string, r) => name || r.merchantId || '—',
    },
    { title: '订单数', dataIndex: 'orderCount', width: 80, align: 'right' },
    {
      title: '总佣金（含待结算）',
      dataIndex: 'totalCommission',
      width: 140,
      align: 'right',
      render: (v: number) => money(v),
    },
    {
      title: '已结算佣金',
      dataIndex: 'confirmedCommission',
      width: 112,
      align: 'right',
      render: (v: number) =>
        v > 0 ? <Typography.Text type="success">{money(v)}</Typography.Text> : '—',
    },
    {
      title: '拒付金额',
      dataIndex: 'rejectedCommission',
      width: 112,
      align: 'right',
      render: (v: number) => (
        <Typography.Text type="danger" strong>
          {money(v)}
        </Typography.Text>
      ),
    },
    {
      title: '拒付率',
      dataIndex: 'rejectionRate',
      width: 100,
      align: 'right',
      render: (v: number) => (
        <Typography.Text type="danger">{pct(v)}</Typography.Text>
      ),
    },
    {
      title: '操作',
      width: 100,
      render: () => <Link to="/settlement">结算查询</Link>,
    },
  ];

  return (
    <div>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        按联盟订单 orderDate 汇总，仅展示有拒付金额的商家。数据以最后一次采集为准，状态变更请先在
        <Link to="/settlement"> 结算查询 </Link>
        重新采集。
      </Typography.Paragraph>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap align="center" size="middle">
          {isAdmin && (
            <Select
              style={{ width: 180 }}
              value={scopeUserId ?? 'all'}
              options={[
                { value: 'all', label: '全公司' },
                ...employees.map((e) => ({ value: e.id, label: e.username })),
              ]}
              onChange={(v) => setScopeUserId(v === 'all' ? null : (v as number))}
            />
          )}
          <RangePicker
            value={draftRange ?? range}
            onChange={(v) => v && setDraftRange(v as [Dayjs, Dayjs])}
          />
          {DATE_PRESETS.map((p) => (
            <Button
              key={p.days}
              size="small"
              onClick={() => setDraftRange(lastNDaysToYesterday(p.days))}
            >
              {p.label}
            </Button>
          ))}
          <Select
            style={{ width: 140 }}
            value={platformFilter}
            options={platformOptions}
            onChange={setPlatformFilter}
          />
          <Input.Search
            allowClear
            placeholder="搜索商家名 / MID"
            style={{ width: 200 }}
            value={draftSearch}
            onChange={(e) => setDraftSearch(e.target.value)}
            onSearch={applyQuery}
          />
          <Space align="center">
            <Typography.Text type="secondary">拒付率阈值</Typography.Text>
            <Slider
              style={{ width: 160, margin: '0 8px' }}
              min={0}
              max={100}
              value={draftThreshold}
              onChange={setDraftThreshold}
              tooltip={{ formatter: (v) => `≥ ${v}%` }}
            />
            <Typography.Text type="success" strong>
              ≥ {draftThreshold}%
            </Typography.Text>
          </Space>
          <Button type="primary" onClick={applyQuery}>
            查询
          </Button>
          <Button onClick={resetFilters}>重置</Button>
          <Button loading={loading} onClick={() => void loadData()}>
            刷新
          </Button>
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          当前生效：{range[0].format('YYYY-MM-DD')} ~ {range[1].format('YYYY-MM-DD')}，拒付率 ≥
          {rejectionThreshold}%（共 {filteredRows.length} 个商家）
        </Typography.Paragraph>
      </Card>

      <Card>
        <Table
          rowKey={(r) => `${r.merchantId}|${r.platformCode}|${r.affiliateAlias}`}
          loading={loading}
          columns={columns}
          dataSource={filteredRows}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
          locale={{
            emptyText: (
              <Empty description="该条件下暂无拒付商家，可调低阈值或扩大日期后查询" />
            ),
          }}
        />
      </Card>
    </div>
  );
}
