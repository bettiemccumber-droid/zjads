import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

import {

  Button,

  Card,

  Col,

  DatePicker,

  message,

  Row,

  Statistic,

  Table,

  Tabs,

  Typography,

  Checkbox,

  Alert,

  Input,
  Select,
  Space,
} from 'antd';

import dayjs, { Dayjs } from 'dayjs';

import { api, type ApiResult } from '../api/client';

import SyncAccountPicker, { type SyncAccountPick } from '../components/SyncAccountPicker';
import SyncJobStatus, { type SyncJobDetail } from '../components/SyncJobStatus';
import { SheetCollectionCell } from '../components/CollectionStatusCells';
import CampaignExpandableTable, {
  attachDailyToCampaigns,
  CAMPAIGN_MAIN_SCROLL_X,
  type CampaignDailyRow,
} from '../components/CampaignExpandableTable';
import CampaignReportToolbar, {
  type CampaignStatusMode,
} from '../components/CampaignReportToolbar';
import '../components/CampaignReportToolbar.css';



const { RangePicker } = DatePicker;

const SYNC_PLATFORM_SHORT: Record<string, string> = {
  partnermatic: 'PM',
  linkhaitao: 'LH',
  linkbux: 'LB',
  rewardoo: 'RW',
};

interface MerchantRow {

  rank: number;

  merchantId: string;

  merchantName: string;

  affiliateAlias: string;

  platformName: string;

  orderCount: number;

  affiliateClicks: number;

  totalClicks: number;

  cr: number;

  totalCommission: number;

  totalCost: number;

  roi: number;

  profit: number;

}



interface CampaignRow {

  rank: number;

  campaignId: string;

  campaignName: string;

  campaignStatus?: string;

  affiliateAlias: string;

  merchantId: string;

  dailyBudget: number;

  impressions: number;

  clicks: number;

  cost: number;

  orderCount: number;

  commission: number;

  affiliateClicks: number;

  searchBudgetLostIs: number;

  searchRankLostIs: number;

  avgCpc: number;

  maxCpc: number;

  epc: number;

  roi: number;

  operationSuggestion: string;

}



interface CampaignTotals {

  impressions: number;

  clicks: number;

  cost: number;

  orderCount: number;

  commission: number;

  affiliateClicks: number;

  overallRoi: number;

  profit: number;

}



function roiColor(v: number) {
  if (v >= 1) return '#16a34a';
  if (v >= 0) return '#ea580c';
  return '#dc2626';
}

/** 从联盟序号推断平台名（与后端 campaign-name.util 一致） */
function inferPlatformFromAlias(alias: string): string {
  const a = (alias || '').toLowerCase();
  if (a.startsWith('lh')) return 'LinkHaitao';
  if (a.startsWith('pm')) return 'PartnerMatic';
  if (a.startsWith('lb')) return 'LinkBux';
  return '';
}

/** 金额指标 */
function MoneyCell({ value, variant = 'default' }: { value: number; variant?: 'default' | 'cost' | 'commission' }) {
  const n = value ?? 0;
  const cls =
    variant === 'commission'
      ? 'cell-money cell-money-commission'
      : variant === 'cost'
        ? 'cell-money cell-money-cost'
        : 'cell-money';
  return <span className={cls}>${n.toFixed(2)}</span>;
}

/** ROI 指标 */
function RoiCell({ value }: { value: number }) {
  return (
    <span className="cell-roi" style={{ color: roiColor(value) }}>
      {value.toFixed(2)}
    </span>
  );
}

function money(v: number) {
  return <MoneyCell value={v} />;
}

/** 广告系列 / 商家汇总表格数据区固定高度（约 10 行） */
const REPORT_TABLE_BODY_HEIGHT = 580;

/** 表格上方汇总条（总广告费 / 总订单 / 总佣金 / 平均 ROI） */
function ReportSummaryBar({
  items,
}: {
  items: {
    label: string;
    value: React.ReactNode;
    variant?: 'cost' | 'commission' | 'roi' | 'orders';
  }[];
}) {
  return (
    <div className="report-summary-bar">
      {items.map((item) => (
        <div
          key={item.label}
          className={`report-summary-item report-summary-item--${item.variant ?? 'default'}`}
        >
          <span className="report-summary-label">{item.label}</span>
          <span className="report-summary-value">{item.value}</span>
        </div>
      ))}
    </div>
  );
}



export default function DashboardPage() {

  const { isAdmin } = useAuth();
  const [searchParams] = useSearchParams();
  const viewUserId = isAdmin && searchParams.get('userId')
    ? parseInt(searchParams.get('userId')!, 10)
    : undefined;
  const viewUsername = searchParams.get('username') ?? `用户#${viewUserId}`;

  const [employeeSheetStatus, setEmployeeSheetStatus] = useState<{
    adSourceCount: number;
    lastSheetImportAt: string | null;
    lastSheetName: string | null;
  } | null>(null);
  const [importingSheet, setImportingSheet] = useState(false);

  const [range, setRange] = useState<[Dayjs, Dayjs]>([

    dayjs().subtract(7, 'day'),

    dayjs().subtract(1, 'day'),

  ]);

  const [loading, setLoading] = useState(false);

  const [syncing, setSyncing] = useState(false);

  const [activeTab, setActiveTab] = useState('campaign');

  const [merchantTotals, setMerchantTotals] = useState({

    orderCount: 0,

    totalCommission: 0,

    totalAdSpend: 0,

    totalClicks: 0,

    totalAffiliateClicks: 0,

    overallRoi: 0,

    profit: 0,

  });

  const [merchantRows, setMerchantRows] = useState<MerchantRow[]>([]);

  const [campaignRows, setCampaignRows] = useState<CampaignRow[]>([]);

  const [campaignDailyRows, setCampaignDailyRows] = useState<CampaignDailyRow[]>([]);

  const [campaignTotals, setCampaignTotals] = useState<CampaignTotals>({

    impressions: 0,

    clicks: 0,

    cost: 0,

    orderCount: 0,

    commission: 0,

    affiliateClicks: 0,

    overallRoi: 0,

    profit: 0,

  });

  const [syncJob, setSyncJob] = useState<SyncJobDetail | null>(null);

  const [syncPolling, setSyncPolling] = useState(false);

  const [cancelling, setCancelling] = useState(false);
  const [campaignStatusMode, setCampaignStatusMode] = useState<CampaignStatusMode>('active');
  const [statusFilterSkipped, setStatusFilterSkipped] = useState(false);
  const [campaignSearch, setCampaignSearch] = useState('');
  const [campaignPlatform, setCampaignPlatform] = useState<string>('all');
  const [merchantSearch, setMerchantSearch] = useState('');
  const [merchantPlatform, setMerchantPlatform] = useState<string>('all');
  const [campaignPageSize, setCampaignPageSize] = useState(20);
  const [merchantPageSize, setMerchantPageSize] = useState(20);
  const [includeClicks, setIncludeClicks] = useState(false);
  const [syncAccountOptions, setSyncAccountOptions] = useState<SyncAccountPick[]>([]);
  const [selectedSyncAccountIds, setSelectedSyncAccountIds] = useState<number[]>([]);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);



  const dateParams = useMemo(() => {
    const base = {
      startDate: range[0].format('YYYY-MM-DD'),
      endDate: range[1].format('YYYY-MM-DD'),
    };
    return viewUserId ? { ...base, userId: viewUserId } : base;
  }, [range, viewUserId]);



  const loadSyncAccounts = useCallback(async () => {
    const { data } = await api.get<
      ApiResult<
        Array<{
          platformCode: string;
          platformName: string;
          collectorImplemented?: boolean;
          accounts: Array<{
            id: number;
            displayName: string;
            affiliateAlias: string;
            isActive?: boolean;
          }>;
        }>
      >
    >('/channel-accounts/by-platform', {
      params: viewUserId ? { userId: viewUserId } : undefined,
    });
    if (!data.success) return;

    const picks: SyncAccountPick[] = [];
    for (const g of data.data) {
      if (!g.collectorImplemented) continue;
      for (const a of g.accounts) {
        if (a.isActive === false) continue;
        picks.push({
          id: a.id,
          platformCode: g.platformCode,
          platformName: g.platformName,
          displayName: a.displayName,
          affiliateAlias: a.affiliateAlias,
        });
      }
    }

    setSyncAccountOptions(picks);
    setSelectedSyncAccountIds((prev) => {
      const valid = new Set(picks.map((p) => p.id));
      const kept = prev.filter((id) => valid.has(id));
      return kept.length > 0 ? kept : picks.map((p) => p.id);
    });
  }, [viewUserId]);

  useEffect(() => {
    void loadSyncAccounts();
  }, [loadSyncAccounts]);

  useEffect(() => {
    if (!viewUserId) {
      setEmployeeSheetStatus(null);
      return;
    }
    void (async () => {
      const { data } = await api.get<
        ApiResult<
          Array<{
            userId: number;
            adSourceCount: number;
            lastSheetImportAt: string | null;
            lastSheetName: string | null;
          }>
        >
      >('/admin/collection-status');
      if (!data.success) return;
      const row = data.data.find((r) => r.userId === viewUserId);
      if (row) {
        setEmployeeSheetStatus({
          adSourceCount: row.adSourceCount,
          lastSheetImportAt: row.lastSheetImportAt,
          lastSheetName: row.lastSheetName,
        });
      }
    })();
  }, [viewUserId]);

  const fetchSyncJob = useCallback(async (jobId: number) => {
    try {
      const { data } = await api.get<ApiResult<SyncJobDetail>>(`/sync/jobs/${jobId}`);
      if (data.success) {
        setSyncJob(data.data);
        return data.data;
      }
    } catch {
      /* 忽略轮询瞬时错误 */
    }
    return null;
  }, []);



  const stopPolling = useCallback(() => {

    if (pollTimer.current) {

      clearInterval(pollTimer.current);

      pollTimer.current = null;

    }

    setSyncPolling(false);

  }, []);



  const loadReport = useCallback(async () => {

    setLoading(true);

    try {

      const campaignQuery = {
        ...dateParams,
        statusMode: campaignStatusMode,
      };

      const [merchantRes, campaignRes, dailyRes] = await Promise.all([

        api.get<ApiResult<{ summary: MerchantRow[]; totals: typeof merchantTotals }>>(

          '/reports/merchant-summary',

          { params: dateParams },

        ),

        api.get<
          ApiResult<{
            summary: CampaignRow[];
            totals: CampaignTotals;
            statusFilterSkipped?: boolean;
          }>
        >('/reports/campaign-summary', { params: campaignQuery }),

        api.get<ApiResult<{ rows: CampaignDailyRow[]; totals: CampaignTotals }>>(
          '/reports/campaign-daily',
          { params: campaignQuery },
        ),

      ]);

      if (merchantRes.data.success) {

        setMerchantRows(merchantRes.data.data.summary);

        setMerchantTotals(merchantRes.data.data.totals);

      }

      if (campaignRes.data.success) {
        setCampaignRows(campaignRes.data.data.summary);
        setCampaignTotals(campaignRes.data.data.totals);
        setStatusFilterSkipped(!!campaignRes.data.data.statusFilterSkipped);
      }

      if (dailyRes.data.success) {
        setCampaignDailyRows(dailyRes.data.data.rows);
      }

    } finally {

      setLoading(false);

    }

  }, [range, campaignStatusMode, viewUserId]);

  const importSheetForEmployee = useCallback(async () => {
    if (!viewUserId) return;
    setImportingSheet(true);
    try {
      const { data } = await api.post<
        ApiResult<{ success: number; failed: number; results: unknown[] }>
      >('/admin/import/sheets/batch', {
        startDate: range[0].format('YYYY-MM-DD'),
        endDate: range[1].format('YYYY-MM-DD'),
        userIds: [viewUserId],
      });
      if (data.success) {
        if (data.data.success > 0) {
          message.success('Sheet 导入完成，正在刷新报表');
          void loadReport();
        } else {
          message.error('Sheet 导入失败，请检查员工是否已配置 Sheet');
        }
        const statusRes = await api.get<
          ApiResult<
            Array<{
              userId: number;
              adSourceCount: number;
              lastSheetImportAt: string | null;
              lastSheetName: string | null;
            }>
          >
        >('/admin/collection-status');
        if (statusRes.data.success) {
          const row = statusRes.data.data.find((r) => r.userId === viewUserId);
          if (row) {
            setEmployeeSheetStatus({
              adSourceCount: row.adSourceCount,
              lastSheetImportAt: row.lastSheetImportAt,
              lastSheetName: row.lastSheetName,
            });
          }
        }
      } else {
        message.error(data.message);
      }
    } finally {
      setImportingSheet(false);
    }
  }, [viewUserId, range, loadReport]);

  const startPolling = useCallback(

    (jobId: number) => {

      stopPolling();

      setSyncPolling(true);

      void fetchSyncJob(jobId);

      pollTimer.current = setInterval(async () => {

        const job = await fetchSyncJob(jobId);

        if (job && ['completed', 'failed', 'partial'].includes(job.status)) {

          stopPolling();

          if (job.status === 'completed') {

            message.success('采集已完成，报表已自动刷新');

          } else if (job.status === 'failed') {

            message.error('采集失败，请查看下方任务详情');

          } else {

            message.warning('部分账号采集失败，请查看任务详情');

          }

          void loadReport();

        }

      }, 2000);

    },

    [fetchSyncJob, stopPolling, loadReport],

  );

  useEffect(() => {
    void loadReport();
  }, [campaignStatusMode, loadReport]);

  useEffect(() => {
    stopPolling();
    setSyncJob(null);
    void (async () => {
      const { data } = await api.get<ApiResult<SyncJobDetail[]>>('/sync/jobs/recent', {
        params: viewUserId ? { userId: viewUserId } : undefined,
      });

      if (data.success && data.data[0]) {
        const latest = data.data[0];
        setSyncJob(latest);
        if (latest.status === 'pending' || latest.status === 'running') {
          startPolling(latest.id);
        }
      }
    })();

    return () => stopPolling();
  }, [viewUserId, startPolling, stopPolling]);



  const cancelSync = async (jobId: number) => {

    setCancelling(true);

    try {

      const { data } = await api.post<ApiResult<SyncJobDetail>>(`/sync/jobs/${jobId}/cancel`);

      if (data.success) {

        setSyncJob(data.data);

        stopPolling();

        message.warning('任务已取消');

      } else {

        message.error(data.message);

      }

    } catch {

      message.error('取消失败');

    } finally {

      setCancelling(false);

    }

  };



  const startSync = async () => {
    if (!selectedSyncAccountIds.length) {
      message.warning('请至少选择一个要采集的账号');
      return;
    }

    setSyncing(true);

    try {

      const { userId: _uid, ...syncDates } = dateParams as {
        userId?: number;
        startDate: string;
        endDate: string;
      };
      const { data } = await api.post<ApiResult<SyncJobDetail>>('/sync/jobs', {
        ...syncDates,
        includeClicks,
        channelAccountIds: selectedSyncAccountIds,
        ...(viewUserId ? { targetUserId: viewUserId } : {}),
      });

      if (data.success) {
        const full = await fetchSyncJob(data.data.id);
        if (full) setSyncJob(full);
        else setSyncJob(data.data);

        const picked = syncAccountOptions
          .filter((a) => selectedSyncAccountIds.includes(a.id))
          .map((a) => `${SYNC_PLATFORM_SHORT[a.platformCode] ?? a.platformName}·${a.affiliateAlias}`)
          .join('、');
        message.info(
          includeClicks
            ? `采集已开始（${picked}，含联盟点击）`
            : `采集已开始（${picked}，仅订单）`,
        );

        startPolling(data.data.id);
      } else {

        message.error(data.message);

      }

    } catch {

      message.error('采集请求失败');

    } finally {

      setSyncing(false);

    }

  };



  const tablePagination = (pageSize: number, onSizeChange: (size: number) => void) => ({
    pageSize,
    showSizeChanger: true,
    pageSizeOptions: [10, 20, 50, 100],
    showTotal: (total: number) => `共 ${total} 条`,
    onShowSizeChange: (_: number, size: number) => onSizeChange(size),
  });

  /** 表头固定，数据区内部滚动 */
  const tableScroll = { x: CAMPAIGN_MAIN_SCROLL_X, y: REPORT_TABLE_BODY_HEIGHT };



  const merchantColumns = [

    { title: '排名', dataIndex: 'rank', width: 60, align: 'center' as const },

    { title: '商家ID', dataIndex: 'merchantId', align: 'center' as const },

    { title: '商家名', dataIndex: 'merchantName', align: 'center' as const },

    { title: '联盟序号', dataIndex: 'affiliateAlias', align: 'center' as const },

    { title: '平台', dataIndex: 'platformName', align: 'center' as const },

    { title: '订单数', dataIndex: 'orderCount', width: 80, align: 'center' as const },

    { title: '联盟点击', dataIndex: 'affiliateClicks', width: 90, align: 'center' as const },

    { title: 'MCC点击数', dataIndex: 'totalClicks', width: 96, align: 'center' as const },

    {

      title: '广告转化率',

      dataIndex: 'cr',

      width: 100,

      align: 'center' as const,

      render: (v: number, r: MerchantRow) =>

        r.totalClicks > 0 ? `${(v ?? 0).toFixed(2)}%` : '—',

    },

    { title: '总佣金', dataIndex: 'totalCommission', align: 'center' as const, render: money },

    { title: '广告费', dataIndex: 'totalCost', align: 'center' as const, render: money },

    {

      title: 'CPC',

      width: 80,

      align: 'center' as const,

      render: (_: unknown, r: MerchantRow) =>

        r.totalClicks > 0 ? money((r.totalCost ?? 0) / r.totalClicks) : '—',

    },

    {

      title: 'ROI',

      dataIndex: 'roi',

      align: 'center' as const,

      render: (v: number) => (

        <RoiCell value={v} />

      ),

    },

  ];



  const ct = campaignTotals;

  const campaignPlatformOptions = useMemo(() => {
    const names = [
      ...new Set(
        campaignRows.map((r) => inferPlatformFromAlias(r.affiliateAlias)).filter(Boolean),
      ),
    ].sort();
    return [{ value: 'all', label: '全部平台' }, ...names.map((n) => ({ value: n, label: n }))];
  }, [campaignRows]);

  const filteredCampaignRows = useMemo(() => {
    let rows = campaignRows;
    if (campaignPlatform !== 'all') {
      rows = rows.filter((r) => inferPlatformFromAlias(r.affiliateAlias) === campaignPlatform);
    }
    const q = campaignSearch.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) => r.campaignName.toLowerCase().includes(q));
    }
    return rows;
  }, [campaignRows, campaignSearch, campaignPlatform]);

  const filteredCampaignDailyRows = useMemo(() => {
    let rows = campaignDailyRows;
    if (campaignPlatform !== 'all') {
      rows = rows.filter((r) => inferPlatformFromAlias(r.affiliateAlias) === campaignPlatform);
    }
    const q = campaignSearch.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) => r.campaignName.toLowerCase().includes(q));
    }
    return rows;
  }, [campaignDailyRows, campaignSearch, campaignPlatform]);

  const campaignRowsWithDaily = useMemo(
    () => attachDailyToCampaigns(filteredCampaignRows, filteredCampaignDailyRows),
    [filteredCampaignRows, filteredCampaignDailyRows],
  );

  /** 仅按平台筛选的广告系列（不含名称搜索，用于与联盟全量对比） */
  const platformCampaignRows = useMemo(() => {
    if (campaignPlatform === 'all') return campaignRows;
    return campaignRows.filter(
      (r) => inferPlatformFromAlias(r.affiliateAlias) === campaignPlatform,
    );
  }, [campaignRows, campaignPlatform]);

  const filteredCampaignTotals = useMemo(() => {
    const totals = filteredCampaignRows.reduce(
      (acc, r) => {
        acc.cost += r.cost;
        acc.orderCount += r.orderCount;
        acc.commission += r.commission;
        return acc;
      },
      { cost: 0, orderCount: 0, commission: 0 },
    );
    const overallRoi =
      totals.cost > 0 ? (totals.commission - totals.cost) / totals.cost : 0;
    return { ...totals, overallRoi };
  }, [filteredCampaignRows]);

  const campaignFilterActive = !!campaignSearch.trim() || campaignPlatform !== 'all';
  const displayCampaignTotals = campaignFilterActive ? filteredCampaignTotals : ct;

  /** 商家汇总按平台全量（联盟 API 采集结果） */
  const merchantTotalsByPlatform = useMemo(() => {
    const map = new Map<
      string,
      { orderCount: number; commission: number; affiliateClicks: number }
    >();
    for (const r of merchantRows) {
      const platform = r.platformName || inferPlatformFromAlias(r.affiliateAlias);
      if (!platform) continue;
      const cur = map.get(platform) ?? { orderCount: 0, commission: 0, affiliateClicks: 0 };
      cur.orderCount += r.orderCount;
      cur.commission += r.totalCommission;
      cur.affiliateClicks += r.affiliateClicks ?? 0;
      map.set(platform, cur);
    }
    return map;
  }, [merchantRows]);

  /** 广告系列归因 vs 联盟全量差异（同平台；名称搜索时不展示，避免误报） */
  const campaignVsMerchantGap = useMemo(() => {
    if (campaignPlatform === 'all' || campaignSearch.trim()) return null;
    const full = merchantTotalsByPlatform.get(campaignPlatform);
    if (!full) return null;
    const tableOrders = platformCampaignRows.reduce((s, r) => s + r.orderCount, 0);
    const tableComm = platformCampaignRows.reduce((s, r) => s + r.commission, 0);
    const diffOrders = full.orderCount - tableOrders;
    const diffComm = full.commission - tableComm;
    if (diffOrders <= 0 && diffComm <= 0.01) return null;
    return {
      platform: campaignPlatform,
      full,
      tableOrders,
      tableComm,
      diffOrders,
      diffComm,
      campaignCount: platformCampaignRows.length,
    };
  }, [campaignPlatform, campaignSearch, merchantTotalsByPlatform, platformCampaignRows]);

  const merchantPlatformOptions = useMemo(() => {
    const names = [...new Set(merchantRows.map((r) => r.platformName).filter(Boolean))].sort();
    return [{ value: 'all', label: '全部平台' }, ...names.map((n) => ({ value: n, label: n }))];
  }, [merchantRows]);

  const filteredMerchantRows = useMemo(() => {
    let rows = merchantRows;
    if (merchantPlatform !== 'all') {
      rows = rows.filter((r) => r.platformName === merchantPlatform);
    }
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
  }, [merchantRows, merchantSearch, merchantPlatform]);

  const filteredMerchantTotals = useMemo(() => {
    const totals = filteredMerchantRows.reduce(
      (acc, r) => {
        acc.orderCount += r.orderCount;
        acc.totalCommission += r.totalCommission;
        acc.totalAdSpend += r.totalCost;
        acc.totalClicks += r.totalClicks;
        acc.totalAffiliateClicks += r.affiliateClicks ?? 0;
        return acc;
      },
      {
        orderCount: 0,
        totalCommission: 0,
        totalAdSpend: 0,
        totalClicks: 0,
        totalAffiliateClicks: 0,
      },
    );
    const overallRoi =
      totals.totalAdSpend > 0
        ? (totals.totalCommission - totals.totalAdSpend) / totals.totalAdSpend
        : 0;
    return { ...totals, overallRoi, profit: totals.totalCommission - totals.totalAdSpend };
  }, [filteredMerchantRows]);

  return (

    <div>

      {viewUserId && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={`管理员视角：正在查看员工「${viewUsername}」的数据`}
          action={<Link to={`/admin/users/${viewUserId}`}>用户详情</Link>}
        />
      )}

      {viewUserId && employeeSheetStatus && (
        <Alert
          type={
            employeeSheetStatus.adSourceCount === 0 || !employeeSheetStatus.lastSheetImportAt
              ? 'warning'
              : 'info'
          }
          showIcon
          style={{ marginBottom: 16 }}
          message="Google Sheet 广告费"
          description={
            <div>
              {employeeSheetStatus.adSourceCount === 0 ? (
                <p style={{ margin: '0 0 8px' }}>
                  该员工尚未配置广告 Sheet，工作台无法显示广告费。请先在「广告数据源」添加 Sheet 并导入。
                </p>
              ) : !employeeSheetStatus.lastSheetImportAt ? (
                <p style={{ margin: '0 0 8px' }}>
                  已配置 Sheet 但尚未导入数据，广告费将为 0。请导入 Sheet 或点击下方按钮。
                </p>
              ) : (
                <p style={{ margin: '0 0 8px' }}>
                  最近导入：
                  <SheetCollectionCell row={employeeSheetStatus} />
                  {' '}
                  （若当日未导入，查询区间内广告费可能不完整）
                </p>
              )}
              <Space wrap>
                <Button
                  type="primary"
                  size="small"
                  loading={importingSheet}
                  disabled={employeeSheetStatus.adSourceCount === 0}
                  onClick={() => void importSheetForEmployee()}
                >
                  导入 Sheet（当前查询区间）
                </Button>
                <Link
                  to={`/admin/ad-sources?userId=${viewUserId}&username=${encodeURIComponent(viewUsername)}`}
                >
                  管理 Sheet 数据源 →
                </Link>
              </Space>
            </div>
          }
        />
      )}

      <Card title={viewUserId ? `数据采集（${viewUsername}）` : '数据采集'} style={{ marginBottom: 16 }}>

        <div className="sync-collect-toolbar">
          <RangePicker value={range} onChange={(v) => v && setRange(v as [Dayjs, Dayjs])} />
          <Checkbox
            checked={includeClicks}
            onChange={(e) => setIncludeClicks(e.target.checked)}
          >
            含联盟点击（LB 仅最后一天，历史可导入校准）
          </Checkbox>
          <div className="sync-collect-actions">
            <Button loading={loading} onClick={loadReport}>
              刷新报表
            </Button>
            <Button
              type="primary"
              loading={syncing}
              disabled={!selectedSyncAccountIds.length}
              onClick={startSync}
            >
              开始采集
              {selectedSyncAccountIds.length > 0
                ? `（${selectedSyncAccountIds.length}）`
                : ''}
            </Button>
          </div>
        </div>

        {syncAccountOptions.length > 0 ? (
          <SyncAccountPicker
            accounts={syncAccountOptions}
            selectedIds={selectedSyncAccountIds}
            onChange={setSelectedSyncAccountIds}
          />
        ) : (
          <Typography.Text type="secondary" className="sync-collect-hint" style={{ display: 'block' }}>
            请先在「我的平台账号」添加并启用已接入采集的平台账号（PM / LH / LB / RW）
          </Typography.Text>
        )}

        <p className="sync-collect-hint">
          已接入 PM / LH / LB / RW 订单；PM/LH/LB 联盟点击随订单区间采集（LB 点击仅采区间<strong>最后一天</strong>，更早日期请用「点击校准导入」）。RW 暂无点击 API。
          {viewUserId
            ? ' Google Ads 广告费请在上方「导入 Sheet」或侧边栏「广告数据源」中代员工导入。'
            : ' Google Ads 请在「广告数据源」导入 Sheet。'}
        </p>

        <SyncJobStatus
          job={syncJob}
          loading={syncPolling && !syncJob}
          onCancel={cancelSync}
          cancelling={cancelling}
        />

      </Card>



      {activeTab === 'merchant' && (
        <Row gutter={16} style={{ marginBottom: 16 }}>

          <Col span={4}>

            <Card>

              <Statistic title="订单总数" value={merchantTotals.orderCount} />

            </Card>

          </Col>

          <Col span={4}>

            <Card>

              <Statistic title="联盟点击" value={merchantTotals.totalAffiliateClicks ?? 0} />

            </Card>

          </Col>

          <Col span={4}>

            <Card>

              <Statistic title="广告点击" value={merchantTotals.totalClicks ?? 0} />

            </Card>

          </Col>

          <Col span={4}>

            <Card>

              <Statistic title="总佣金" prefix="$" value={merchantTotals.totalCommission} precision={2} />

            </Card>

          </Col>

          <Col span={4}>

            <Card>

              <Statistic title="总广告费" prefix="$" value={merchantTotals.totalAdSpend} precision={2} />

            </Card>

          </Col>

          <Col span={4}>

            <Card>

              <Statistic

                title="整体 ROI"

                value={merchantTotals.overallRoi}

                precision={2}

                valueStyle={{ color: roiColor(merchantTotals.overallRoi) }}

              />

            </Card>

          </Col>

        </Row>
      )}



      <Card>

        <Tabs

          activeKey={activeTab}

          onChange={setActiveTab}

          items={[

            {

              key: 'campaign',

              label: '广告系列',

              children: (

                <>
                  <CampaignReportToolbar
                    campaignSearch={campaignSearch}
                    onCampaignSearchChange={setCampaignSearch}
                    platform={campaignPlatform}
                    platformOptions={campaignPlatformOptions}
                    onPlatformChange={setCampaignPlatform}
                    statusMode={campaignStatusMode}
                    onStatusModeChange={setCampaignStatusMode}
                    loading={loading}
                    onQuery={loadReport}
                    filterHint={
                      campaignFilterActive
                        ? `筛选 ${filteredCampaignRows.length} / ${campaignRows.length} 条`
                        : undefined
                    }
                  />

                  <ReportSummaryBar
                    items={[
                      {
                        label: '总广告费',
                        variant: 'cost',
                        value: `$${displayCampaignTotals.cost.toFixed(2)}`,
                      },
                      {
                        label: '总订单数',
                        variant: 'orders',
                        value: displayCampaignTotals.orderCount,
                      },
                      {
                        label: '总佣金',
                        variant: 'commission',
                        value: `$${displayCampaignTotals.commission.toFixed(2)}`,
                      },
                      {
                        label: '平均 ROI',
                        variant: 'roi',
                        value: (
                          <span style={{ color: roiColor(displayCampaignTotals.overallRoi) }}>
                            {displayCampaignTotals.overallRoi.toFixed(2)}
                          </span>
                        ),
                      },
                    ]}
                  />

                  {campaignVsMerchantGap && (
                    <Alert
                      type="info"
                      showIcon
                      style={{ marginBottom: 12 }}
                      message={`${campaignVsMerchantGap.platform} 联盟全量与广告系列表不一致`}
                      description={
                        <>
                          采集任务显示{' '}
                          <strong>
                            {campaignVsMerchantGap.full.orderCount} 单 / $
                            {campaignVsMerchantGap.full.commission.toFixed(2)}
                          </strong>{' '}
                          （联盟 API 全量）。当前平台共{' '}
                          <strong>{campaignVsMerchantGap.campaignCount}</strong> 条广告系列，合计{' '}
                          <strong>
                            {campaignVsMerchantGap.tableOrders} 单 / $
                            {campaignVsMerchantGap.tableComm.toFixed(2)}
                          </strong>
                          。差额{' '}
                          <strong>
                            {campaignVsMerchantGap.diffOrders} 单 / $
                            {campaignVsMerchantGap.diffComm.toFixed(2)}
                          </strong>
                          ，来自在 {campaignVsMerchantGap.platform} 有订单、但 Google
                          Sheet 中<strong>没有对应广告系列</strong>
                          的商家（与联盟点击有无无关；多数仍有大量点击）。完整明细见「商家汇总」同平台筛选。
                        </>
                      }
                    />
                  )}

                  {statusFilterSkipped && (
                    <Alert
                      type="warning"
                      showIcon
                      style={{ marginBottom: 12 }}
                      message="缺少系列状态，请到「广告数据源」重新导入"
                    />
                  )}

                  {campaignRows.length === 0 && !loading && !statusFilterSkipped && (
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                      暂无数据，请先在「广告数据源」导入 Sheet
                    </Typography.Text>
                  )}

                  <div>
                    <CampaignExpandableTable
                      rows={campaignRowsWithDaily}
                      loading={loading}
                      scroll={tableScroll}
                      pagination={tablePagination(campaignPageSize, setCampaignPageSize)}
                      rowClassName={(r) => {
                        if (r.orderCount === 0 && r.cost > 0) return 'row-zero-orders-ad';
                        if (r.orderCount === 0 && r.affiliateClicks > 0) return 'row-affiliate-clicks-only';
                        return '';
                      }}
                    />
                  </div>

                </>

              ),

            },

            {

              key: 'merchant',

              label: '商家汇总',

              children: (
                <>
                  <div className="report-toolbar">
                    <Input.Search
                      allowClear
                      placeholder="搜索商家名 / ID / 联盟序号"
                      style={{ width: 260 }}
                      value={merchantSearch}
                      onChange={(e) => setMerchantSearch(e.target.value)}
                    />
                    <Select
                      style={{ width: 160 }}
                      value={merchantPlatform}
                      options={merchantPlatformOptions}
                      onChange={setMerchantPlatform}
                    />
                    {(merchantSearch || merchantPlatform !== 'all') && (
                      <Typography.Text type="secondary">
                        筛选 {filteredMerchantRows.length} / {merchantRows.length} 条
                      </Typography.Text>
                    )}
                  </div>

                  {(merchantSearch || merchantPlatform !== 'all') && filteredMerchantRows.length > 0 && (
                    <ReportSummaryBar
                      items={[
                        {
                          label: '总广告费',
                          variant: 'cost',
                          value: `$${filteredMerchantTotals.totalAdSpend.toFixed(2)}`,
                        },
                        {
                          label: '总订单数',
                          variant: 'orders',
                          value: filteredMerchantTotals.orderCount,
                        },
                        {
                          label: '总佣金',
                          variant: 'commission',
                          value: `$${filteredMerchantTotals.totalCommission.toFixed(2)}`,
                        },
                        {
                          label: '平均 ROI',
                          variant: 'roi',
                          value: (
                            <span style={{ color: roiColor(filteredMerchantTotals.overallRoi) }}>
                              {filteredMerchantTotals.overallRoi.toFixed(2)}
                            </span>
                          ),
                        },
                      ]}
                    />
                  )}

                  <div className="dashboard-table-wrap">
                    <Table
                      className="dashboard-report-table"
                      rowKey={(r) => `${r.merchantId}-${r.affiliateAlias}`}
                      loading={loading}
                      columns={merchantColumns}
                      dataSource={filteredMerchantRows}
                      scroll={{ y: REPORT_TABLE_BODY_HEIGHT }}
                      pagination={tablePagination(merchantPageSize, setMerchantPageSize)}
                      rowClassName={(r) => {
                        if (r.orderCount === 0 && (r.totalCost > 0 || r.totalClicks > 0)) {
                          return 'row-zero-orders-ad';
                        }
                        if (r.orderCount === 0 && (r.affiliateClicks ?? 0) > 0) {
                          return 'row-affiliate-clicks-only';
                        }
                        return '';
                      }}
                    />
                  </div>
                </>
              ),

            },

          ]}

        />

        <style>{`
          .row-zero-orders-ad > td:first-child {
            box-shadow: inset 3px 0 0 #f59e0b;
          }
          .row-affiliate-clicks-only > td:first-child {
            box-shadow: inset 3px 0 0 #3b82f6;
          }
          .dashboard-table-wrap {
            border: 1px solid #eef0f3;
            border-radius: 8px;
            overflow: hidden;
            background: #fff;
          }
          .report-toolbar {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            align-items: center;
            margin-bottom: 12px;
          }
          .report-summary-bar {
            display: grid;
            grid-template-columns: repeat(4, minmax(140px, 1fr));
            gap: 10px;
            margin-bottom: 12px;
            max-width: 100%;
          }
          @media (max-width: 900px) {
            .report-summary-bar {
              grid-template-columns: repeat(2, 1fr);
            }
          }
          .report-summary-item {
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding: 12px 14px;
            border-radius: 10px;
            border: 1px solid #e8ecf1;
            background: #fff;
            min-width: 0;
          }
          .report-summary-label {
            color: #64748b;
            font-size: 12px;
            font-weight: 500;
          }
          .report-summary-value {
            font-weight: 800;
            font-size: 22px;
            color: #0f172a;
            font-variant-numeric: tabular-nums;
            line-height: 1.2;
          }
          .report-summary-item--cost {
            background: #fef2f2;
            border-color: #fecaca;
          }
          .report-summary-item--cost .report-summary-value {
            color: #b91c1c;
            font-size: 24px;
          }
          .report-summary-item--commission {
            background: #ecfdf5;
            border-color: #a7f3d0;
          }
          .report-summary-item--commission .report-summary-value {
            color: #047857;
            font-size: 24px;
          }
          .report-summary-item--roi {
            background: #fffbeb;
            border-color: #fde68a;
          }
          .report-summary-item--roi .report-summary-value {
            font-size: 26px;
          }
          .report-summary-item--orders .report-summary-value {
            color: #334155;
            font-size: 20px;
          }
          .dashboard-report-table .ant-table {
            background: #fff;
          }
          .dashboard-report-table .ant-table-thead > tr > th,
          .dashboard-report-table .ant-table-tbody > tr > td {
            padding: 12px 12px !important;
            border-bottom: 1px solid #f1f5f9 !important;
            text-align: center !important;
          }
          .dashboard-report-table .ant-table-thead > tr > th {
            white-space: nowrap;
            background: #f1f5f9 !important;
            color: #334155;
            font-weight: 600;
            font-size: 13px;
            border-bottom: 2px solid #e2e8f0 !important;
          }
          .dashboard-report-table .ant-table-tbody > tr > td {
            background: #fff;
            font-size: 14px;
          }
          .dashboard-report-table .ant-table-tbody > tr > td:first-child {
            color: #64748b;
            font-weight: 500;
          }
          .dashboard-report-table .ant-table-tbody > tr > td:nth-child(2) {
            color: #475569;
            font-size: 13px;
          }
          .dashboard-report-table .ant-table-cell-ellipsis {
            text-align: center !important;
          }
          .dashboard-report-table .cell-num,
          .dashboard-report-table .cell-money,
          .dashboard-report-table .cell-pct,
          .dashboard-report-table .cell-roi {
            font-variant-numeric: tabular-nums;
            letter-spacing: 0.01em;
          }
          .dashboard-report-table .cell-num {
            font-size: 14px;
            font-weight: 600;
            color: #0f172a;
          }
          .dashboard-report-table .cell-num-highlight {
            font-size: 15px;
            font-weight: 700;
            color: #1d4ed8;
          }
          .dashboard-report-table .cell-money {
            font-size: 14px;
            font-weight: 600;
            color: #0f172a;
          }
          .dashboard-report-table .cell-money-cost {
            font-size: 15px;
            font-weight: 700;
            color: #0f172a;
          }
          .dashboard-report-table .cell-money-commission {
            font-size: 15px;
            font-weight: 700;
            color: #059669;
          }
          .dashboard-report-table .cell-pct {
            font-size: 14px;
            font-weight: 600;
            color: #334155;
          }
          .dashboard-report-table .cell-roi {
            font-size: 16px;
            font-weight: 800;
          }
          .dashboard-report-table .cell-suggestion {
            font-size: 13px;
            color: #64748b;
          }
          .dashboard-report-table .ant-table-tbody > tr:hover > td {
            background: #f8fafc !important;
          }
          .dashboard-report-table .ant-table-pagination {
            margin: 12px 16px !important;
          }
        `}</style>

      </Card>

    </div>

  );

}

