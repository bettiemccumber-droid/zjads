import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  Button,
  DatePicker,
  Empty,
  Input,
  Select,
  Slider,
  Table,
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
import './chargeback-merchants.css';

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

const PLATFORM_SHORT: Record<string, string> = {
  partnermatic: 'PM',
  linkhaitao: 'LH',
  linkbux: 'LB',
  rewardoo: 'RW',
  collabglow: 'CG',
  ultrainfluence: 'UI',
  famesta: 'FS',
};

const KNOWN_PLATFORM_CODES = new Set(Object.keys(PLATFORM_SHORT));

function money(v: number) {
  return `$${Number(v).toFixed(2)}`;
}

function pct(v: number) {
  return `${Number(v).toFixed(2)}%`;
}

/** 平台列彩色徽章 */
function PlatformBadge({ platformCode }: { platformCode: string }) {
  const cls = KNOWN_PLATFORM_CODES.has(platformCode) ? platformCode : 'default';
  const label =
    PLATFORM_SHORT[platformCode] ?? platformCode.toUpperCase().slice(0, 4);
  return <span className={`cb-platform-badge ${cls}`}>{label}</span>;
}

/** 拒付率环形指示（竞品同款小圆环 + 红色百分比） */
function RejectionRateCell({ rate }: { rate: number }) {
  const visual = Math.min(Math.max(rate, 0), 100);
  const deg = `${(visual / 100) * 360}deg`;
  return (
    <span className="cb-rate-cell">
      <span
        className="cb-rate-ring"
        style={{ '--cb-rate-deg': deg } as CSSProperties}
        aria-hidden
      />
      <span className={`cb-rate-text${rate > 100 ? ' is-over' : ''}`}>{pct(rate)}</span>
    </span>
  );
}

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
          ...(effectiveScopeUserId != null
            ? { userId: effectiveScopeUserId }
            : { orgWide: 'true' }),
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
      render: (_, r) => <PlatformBadge platformCode={r.platformCode} />,
    },
    {
      title: 'MID',
      dataIndex: 'merchantId',
      width: 88,
      render: (id: string) => <span className="cb-mid">{id}</span>,
    },
    {
      title: '商家名称',
      dataIndex: 'merchantName',
      ellipsis: true,
      render: (name: string, r) => (
        <span className="cb-merchant-name">{name || r.merchantId || '—'}</span>
      ),
    },
    {
      title: '订单数',
      dataIndex: 'orderCount',
      width: 88,
      align: 'right',
      sorter: (a, b) => a.orderCount - b.orderCount,
      render: (v: number) => <span className="cb-money">{v.toLocaleString()}</span>,
    },
    {
      title: '总佣金 (含待结算)',
      dataIndex: 'totalCommission',
      width: 148,
      align: 'right',
      sorter: (a, b) => a.totalCommission - b.totalCommission,
      render: (v: number) => <span className="cb-money">{money(v)}</span>,
    },
    {
      title: '已结算佣金',
      dataIndex: 'confirmedCommission',
      width: 120,
      align: 'right',
      sorter: (a, b) => a.confirmedCommission - b.confirmedCommission,
      render: (v: number) => {
        if (v === 0) {
          return <span className="cb-money cb-money--muted">{money(0)}</span>;
        }
        if (v < 0) {
          return <span className="cb-money cb-money--muted">{money(v)}</span>;
        }
        return <span className="cb-money">{money(v)}</span>;
      },
    },
    {
      title: '拒付金额',
      dataIndex: 'rejectedCommission',
      width: 112,
      align: 'right',
      defaultSortOrder: 'descend',
      sorter: (a, b) => a.rejectedCommission - b.rejectedCommission,
      render: (v: number) => <span className="cb-money cb-money--danger">{money(v)}</span>,
    },
    {
      title: '拒付率',
      dataIndex: 'rejectionRate',
      width: 128,
      align: 'right',
      sorter: (a, b) => a.rejectionRate - b.rejectionRate,
      render: (v: number) => <RejectionRateCell rate={v} />,
    },
    {
      title: '操作',
      width: 96,
      align: 'center',
      fixed: 'right',
      render: () => (
        <Link className="cb-action-link" to="/settlement">
          结算查询
        </Link>
      ),
    },
  ];

  return (
    <div className="chargeback-merchants">
      <Typography.Paragraph className="chargeback-merchants__tip">
        按联盟订单 orderDate 汇总本公司所有员工的拒付（全员共享），仅展示有拒付金额的商家。数据以最后一次采集为准，状态变更请先在
        <Link to="/settlement"> 结算查询 </Link>
        重新采集。
      </Typography.Paragraph>

      <div className="chargeback-merchants__toolbar">
        <div className="chargeback-merchants__toolbar-row">
          {isAdmin && (
            <Select
              style={{ width: 160 }}
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
            <Button key={p.days} size="small" onClick={() => setDraftRange(lastNDaysToYesterday(p.days))}>
              {p.label}
            </Button>
          ))}
          <Select
            style={{ width: 132 }}
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
          <div className="chargeback-merchants__threshold">
            <span className="chargeback-merchants__threshold-label">拒付率阈值</span>
            <Slider
              style={{ flex: 1, minWidth: 120, maxWidth: 160, margin: 0 }}
              min={0}
              max={100}
              value={draftThreshold}
              onChange={setDraftThreshold}
              tooltip={{ formatter: (v) => `≥ ${v}%` }}
            />
            <span className="chargeback-merchants__threshold-value">≥ {draftThreshold}%</span>
          </div>
          <Button type="primary" onClick={applyQuery}>
            查询
          </Button>
          <Button onClick={resetFilters}>重置</Button>
          <Button loading={loading} onClick={() => void loadData()}>
            刷新
          </Button>
        </div>
        <Typography.Paragraph className="chargeback-merchants__summary">
          当前生效：{range[0].format('YYYY-MM-DD')} ~ {range[1].format('YYYY-MM-DD')}，拒付率 ≥
          {rejectionThreshold}%（共 {filteredRows.length} 个商家）
        </Typography.Paragraph>
      </div>

      <div className="chargeback-merchants__panel">
        <Table
          className="cb-table"
          rowKey={(r) => `${r.merchantId}|${r.platformCode}|${r.affiliateAlias}`}
          loading={loading}
          columns={columns}
          dataSource={filteredRows}
          size="middle"
          bordered
          scroll={{ x: 1100 }}
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
            size: 'default',
          }}
          locale={{
            emptyText: (
              <Empty description="该条件下暂无拒付商家，可调低阈值或扩大日期后查询" />
            ),
          }}
        />
      </div>
    </div>
  );
}
