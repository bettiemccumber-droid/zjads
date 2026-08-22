import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Input,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Upload,
  Tooltip,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { UploadOutlined, SearchOutlined } from '@ant-design/icons';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type ApiResult } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import MerchantAccountPicker from '../components/MerchantAccountPicker';
import { exportMerchantStatusExcel } from '../utils/exportMerchantStatusExcel';
import { parseMerchantStatusImport } from '../utils/parseMerchantStatusImport';
import {
  clearMerchantStatusSession,
  loadMerchantStatusSession,
  saveMerchantStatusSession,
} from '../utils/merchant-status-session.util';
import { adminDefaultDateRange } from '../utils/date-range.util';
import './MerchantStatusPage.css';

interface QueryableAccount {
  id: number;
  displayName: string;
  affiliateAlias: string;
  platformCode: string;
  platformName: string;
  statusQuerySupported: boolean;
}

interface MerchantQueryItem {
  merchantId?: string;
  mcid?: string;
  domain?: string;
}

interface MerchantStatusRow {
  queryKey: string;
  merchantId: string | null;
  mcid: string | null;
  merchantName: string | null;
  siteUrl: string | null;
  platformCode: string;
  platformName: string;
  channelAccountId: number;
  channelDisplayName: string;
  affiliateAlias: string;
  ownerUserId: number;
  ownerUsername: string;
  relationshipStatus: string;
  relationshipRaw: string | null;
  merchantAvailability: string;
  availabilityRaw: string | null;
  actionable: boolean;
  actionLabel: string;
  queriedAt: string;
  error: string | null;
}

interface SummaryCounts {
  total: number;
  actionable: number;
  pending: number;
  rejected: number;
  notJoined: number;
  notFound: number;
  offline: number;
  unknown: number;
  failed: number;
}

interface PlatformPassSummary {
  platformCode: string;
  platformName: string;
  passed: number;
  pending: number;
  notPassed: number;
  failed: number;
}

interface UserPassSummary {
  userId: number;
  username: string;
  byPlatform: PlatformPassSummary[];
  totalPassed: number;
}

interface EmployeeOption {
  id: number;
  username: string;
}

const ACTION_PILL_CLASS: Record<string, string> = {
  可投: 'actionable',
  待审核: 'pending',
  未加入: 'not-joined',
  无商家: 'not-found',
  已拒绝: 'rejected',
  商家已下架: 'offline-action',
  状态未知: 'unknown',
  查询失败: 'failed',
};

const RELATIONSHIP_PILL_CLASS: Record<string, string> = {
  joined: 'joined',
  pending: 'pending',
  rejected: 'rejected',
  not_joined: 'not-joined',
  not_found: 'not-found',
  unknown: 'unknown',
};

const RELATIONSHIP_LABEL: Record<string, string> = {
  joined: '已加入',
  pending: '审核中',
  rejected: '已拒绝',
  not_joined: '未加入',
  not_found: '无商家',
  unknown: '未知',
};

/** 结果表账号关系筛选选项 */
const RELATIONSHIP_FILTER_OPTIONS = [
  { value: 'joined', label: '已加入' },
  { value: 'pending', label: '审核中' },
  { value: 'rejected', label: '已拒绝' },
  { value: 'not_joined', label: '未加入' },
  { value: 'not_found', label: '无商家' },
  { value: 'unknown', label: '未知' },
  { value: 'failed', label: '查询失败' },
];

/** 行对应的账号关系筛选键 */
function getRelationshipFilterKey(row: MerchantStatusRow): string {
  if (row.error) return 'failed';
  return row.relationshipStatus;
}

const AVAILABILITY_LABEL: Record<string, string> = {
  online: '上架',
  offline: '下架',
  unknown: '未知',
};

const PLATFORM_CLASS: Record<string, string> = {
  partnermatic: 'partnermatic',
  linkhaitao: 'linkhaitao',
  linkbux: 'linkbux',
  rewardoo: 'rewardoo',
  ultrainfluence: 'ultrainfluence',
};

function renderStatusPill(label: string, variant: string, size: 'sm' | 'md' = 'md') {
  return (
    <span className={`merchant-status-pill merchant-status-pill--${size} merchant-status-pill--${variant}`}>
      {label}
    </span>
  );
}

function renderPlatformBadge(platformCode: string, platformName: string) {
  const cls = PLATFORM_CLASS[platformCode] ?? 'default';
  return (
    <span className={`merchant-status-platform merchant-status-platform--${cls}`}>{platformName}</span>
  );
}

function SummaryBar({ summary }: { summary: SummaryCounts }) {
  const items: Array<{ key: string; label: string; value: number; className?: string }> = [
    { key: 'total', label: '总结果', value: summary.total },
    { key: 'actionable', label: '可投', value: summary.actionable, className: 'is-actionable' },
    { key: 'pending', label: '待审核', value: summary.pending, className: 'is-pending' },
    { key: 'rejected', label: '已拒绝', value: summary.rejected, className: 'is-failed' },
    { key: 'notJoined', label: '未加入', value: summary.notJoined },
    { key: 'notFound', label: '无商家', value: summary.notFound, className: 'is-muted' },
    { key: 'offline', label: '已下架', value: summary.offline, className: 'is-pending' },
    { key: 'failed', label: '查询失败', value: summary.failed, className: 'is-failed' },
  ];
  return (
    <div className="merchant-status-summary">
      {items.map((item) => (
        <div key={item.key} className={`merchant-status-summary-item ${item.className ?? ''}`}>
          <div className="label">{item.label}</div>
          <div className="value">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * 计算同键连续行的 rowSpan（用于按商家分组展示）
 */
function buildRowSpanByKey<T>(rows: T[], keyFn: (row: T) => string): number[] {
  const spans = new Array<number>(rows.length).fill(1);
  let i = 0;
  while (i < rows.length) {
    const key = keyFn(rows[i]);
    let j = i + 1;
    while (j < rows.length && keyFn(rows[j]) === key) j += 1;
    spans[i] = j - i;
    for (let k = i + 1; k < j; k += 1) spans[k] = 0;
    i = j;
  }
  return spans;
}

/** 按商家分组编号（与 queryKey rowSpan 对齐） */
function buildMerchantGroupNumbers(rowSpans: number[]): number[] {
  const nums = new Array<number>(rowSpans.length).fill(0);
  let no = 0;
  for (let i = 0; i < rowSpans.length; i += 1) {
    if (rowSpans[i] > 0) {
      no += 1;
      nums[i] = no;
    }
  }
  return nums;
}

/** 商家分组元信息（首行/末行/组序号，用于分隔样式） */
function buildMerchantGroupMeta(
  rows: MerchantStatusRow[],
): Array<{ groupNo: number; isFirst: boolean; isLast: boolean }> {
  const meta: Array<{ groupNo: number; isFirst: boolean; isLast: boolean }> = [];
  let groupNo = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const isFirst = i === 0 || rows[i].queryKey !== rows[i - 1].queryKey;
    const isLast = i === rows.length - 1 || rows[i].queryKey !== rows[i + 1].queryKey;
    if (isFirst) groupNo += 1;
    meta.push({ groupNo, isFirst, isLast });
  }
  return meta;
}

/** 同 queryKey 下合并商家 ID / mcid / 名称（任一行有值即展示） */
function buildMerchantInfoByKey(
  rows: MerchantStatusRow[],
): Map<string, { merchantId: string; mcid: string | null; merchantName: string | null }> {
  const map = new Map<string, { merchantId: string; mcid: string | null; merchantName: string | null }>();
  for (const row of rows) {
    let info = map.get(row.queryKey);
    if (!info) {
      info = {
        merchantId: row.merchantId ?? row.queryKey,
        mcid: row.mcid,
        merchantName: row.merchantName,
      };
      map.set(row.queryKey, info);
      continue;
    }
    if (row.merchantId) info.merchantId = row.merchantId;
    if (row.mcid) info.mcid = row.mcid;
    if (row.merchantName) info.merchantName = row.merchantName;
  }
  return map;
}

export default function MerchantStatusPage() {
  const { isAdmin, user } = useAuth();
  const [searchParams] = useSearchParams();
  const viewUserId = isAdmin && searchParams.get('userId') ? parseInt(searchParams.get('userId')!, 10) : undefined;
  const viewUsername = searchParams.get('username') ?? (viewUserId ? `用户#${viewUserId}` : '');

  /** 恢复 session 前暂存账号选择，避免 loadAccounts 覆盖 */
  const pendingSelectedAccountIdsRef = useRef<number[] | null>(null);
  /** 是否已有可持久化的查询结果（恢复或本次查询成功） */
  const shouldPersistSessionRef = useRef(false);
  const [sessionRestored, setSessionRestored] = useState(false);

  const [accounts, setAccounts] = useState<QueryableAccount[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<MerchantStatusRow[]>([]);
  const [summary, setSummary] = useState<SummaryCounts | null>(null);
  const [relationshipFilters, setRelationshipFilters] = useState<string[]>([]);

  const [singleInput, setSingleInput] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [parsedPreview, setParsedPreview] = useState<MerchantQueryItem[]>([]);

  const [adminSummary, setAdminSummary] = useState<UserPassSummary[]>([]);
  const [adminGrandTotal, setAdminGrandTotal] = useState<SummaryCounts | null>(null);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([]);
  const [activeTab, setActiveTab] = useState('single');

  const accountParams = useMemo(
    () => (viewUserId ? { userId: viewUserId } : undefined),
    [viewUserId],
  );

  const persistSession = useCallback(() => {
    if (!user?.id || !shouldPersistSessionRef.current) return;
    if (rows.length === 0 && !summary && adminSummary.length === 0) return;
    saveMerchantStatusSession(user.id, viewUserId, {
      activeTab,
      singleInput,
      pasteText,
      parsedPreview,
      selectedAccountIds,
      relationshipFilters,
      rows,
      summary,
      adminSummary,
      adminGrandTotal,
      selectedEmployeeIds,
    });
  }, [
    user?.id,
    viewUserId,
    activeTab,
    singleInput,
    pasteText,
    parsedPreview,
    selectedAccountIds,
    relationshipFilters,
    rows,
    summary,
    adminSummary,
    adminGrandTotal,
    selectedEmployeeIds,
  ]);

  /** 从 sessionStorage 恢复上次查询（不写数据库） */
  useEffect(() => {
    if (!user?.id) return;
    pendingSelectedAccountIdsRef.current = null;
    shouldPersistSessionRef.current = false;
    setSessionRestored(false);

    const cached = loadMerchantStatusSession(user.id, viewUserId);
    if (!cached) return;

    setActiveTab(cached.activeTab);
    setSingleInput(cached.singleInput);
    setPasteText(cached.pasteText);
    setParsedPreview(cached.parsedPreview as MerchantQueryItem[]);
    setRelationshipFilters(cached.relationshipFilters);
    setRows(cached.rows as unknown as MerchantStatusRow[]);
    setSummary(cached.summary as SummaryCounts | null);
    if (cached.adminSummary) {
      setAdminSummary(cached.adminSummary as UserPassSummary[]);
    }
    if (cached.adminGrandTotal) {
      setAdminGrandTotal(cached.adminGrandTotal as SummaryCounts);
    }
    if (cached.selectedEmployeeIds) {
      setSelectedEmployeeIds(cached.selectedEmployeeIds);
    }
    pendingSelectedAccountIdsRef.current = cached.selectedAccountIds;
    shouldPersistSessionRef.current = true;
    setSessionRestored(true);
  }, [user?.id, viewUserId]);

  /** 离开页面时写入 sessionStorage */
  useEffect(() => {
    return () => {
      persistSession();
    };
  }, [persistSession]);

  /** 筛选、账号选择变更时同步缓存（已有查询结果时） */
  useEffect(() => {
    persistSession();
  }, [relationshipFilters, selectedAccountIds, activeTab, persistSession]);

  const loadAccounts = useCallback(async () => {
    const { data } = await api.get<ApiResult<QueryableAccount[]>>('/merchants/status/accounts', {
      params: accountParams,
    });
    if (data.success) {
      setAccounts(data.data);
      const defaultIds = data.data.filter((a) => a.statusQuerySupported).map((a) => a.id);
      const pending = pendingSelectedAccountIdsRef.current;
      if (pending && pending.length > 0) {
        const supported = new Set(defaultIds);
        const restored = pending.filter((id) => supported.has(id));
        setSelectedAccountIds(restored.length > 0 ? restored : defaultIds);
        pendingSelectedAccountIdsRef.current = null;
      } else {
        setSelectedAccountIds(defaultIds);
      }
    }
  }, [accountParams]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    if (!isAdmin) return;
    const [start, end] = adminDefaultDateRange();
    void api
      .get<ApiResult<Array<{ id: number; username: string }>>>('/admin/users/summary', {
        params: {
          startDate: start.format('YYYY-MM-DD'),
          endDate: end.format('YYYY-MM-DD'),
        },
      })
      .then(({ data }) => {
        if (data.success) {
          setEmployees(data.data.map((u) => ({ id: u.id, username: u.username })));
        }
      });
  }, [isAdmin]);

  const showQueryPanels = activeTab !== 'admin-summary';
  const showEmptyHint = showQueryPanels && rows.length === 0 && !loading && !summary;

  const clearQueryResults = () => {
    if (user?.id) {
      clearMerchantStatusSession(user.id, viewUserId);
    }
    shouldPersistSessionRef.current = false;
    setSessionRestored(false);
    setRows([]);
    setSummary(null);
    setParsedPreview([]);
    setRelationshipFilters([]);
    setAdminSummary([]);
    setAdminGrandTotal(null);
  };

  const runQuery = async (items: MerchantQueryItem[]) => {
    if (items.length === 0) {
      message.warning('请先输入商家');
      return;
    }
    if (selectedAccountIds.length === 0) {
      message.warning('请至少选择一个平台账号');
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post<
        ApiResult<{ items: MerchantStatusRow[]; summary: SummaryCounts }>
      >(
        '/merchants/status/query',
        {
          items,
          channelAccountIds: selectedAccountIds,
          ...(viewUserId ? { targetUserId: viewUserId } : {}),
        },
        /** LH 等联盟 API 批量扫描可能较慢 */
        { timeout: 600000 },
      );
      if (data.success) {
        setRows(data.data.items);
        setSummary(data.data.summary);
        shouldPersistSessionRef.current = true;
        if (user?.id) {
          saveMerchantStatusSession(user.id, viewUserId, {
            activeTab,
            singleInput,
            pasteText,
            parsedPreview,
            selectedAccountIds,
            relationshipFilters,
            rows: data.data.items,
            summary: data.data.summary,
            adminSummary,
            adminGrandTotal,
            selectedEmployeeIds,
          });
        }
        message.success(`查询完成，共 ${data.data.items.length} 条结果`);
      } else {
        message.error(data.message || '查询失败');
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '请求超时或网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const runAdminSummary = async (items: MerchantQueryItem[]) => {
    if (items.length === 0) {
      message.warning('请先输入商家列表');
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post<
        ApiResult<{ byUser: UserPassSummary[]; grandTotal: SummaryCounts }>
      >('/merchants/status/summary', {
        items,
        ...(selectedEmployeeIds.length ? { userIds: selectedEmployeeIds } : {}),
      });
      if (data.success) {
        setAdminSummary(data.data.byUser);
        setAdminGrandTotal(data.data.grandTotal);
        shouldPersistSessionRef.current = true;
        if (user?.id) {
          saveMerchantStatusSession(user.id, viewUserId, {
            activeTab,
            singleInput,
            pasteText,
            parsedPreview,
            selectedAccountIds,
            relationshipFilters,
            rows,
            summary,
            adminSummary: data.data.byUser,
            adminGrandTotal: data.data.grandTotal,
            selectedEmployeeIds,
          });
        }
        message.success('汇总查询完成');
      } else {
        message.error(data.message || '汇总失败');
      }
    } finally {
      setLoading(false);
    }
  };

  const querySingle = () => {
    const token = singleInput.trim();
    if (!token) return;
    const item: MerchantQueryItem = /^\d+$/.test(token)
      ? { merchantId: token }
      : token.includes('.')
        ? { domain: token }
        : { mcid: token.toLowerCase() };
    void runQuery([item]);
  };

  const queryPaste = async () => {
    const { data } = await api.post<ApiResult<MerchantQueryItem[]>>('/merchants/status/parse-text', {
      text: pasteText,
    });
    if (!data.success) {
      message.error(data.message || '解析失败');
      return;
    }
    setParsedPreview(data.data);
    await runQuery(data.data);
  };

  const onImportFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const items = parseMerchantStatusImport(buf);
      setParsedPreview(items);
      if (activeTab === 'admin-summary') {
        await runAdminSummary(items);
      } else {
        await runQuery(items);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '导入失败');
    }
    return false;
  };

  const filteredRows = useMemo(() => {
    let list = rows;
    if (relationshipFilters.length > 0) {
      const allowed = new Set(relationshipFilters);
      list = rows.filter((r) => allowed.has(getRelationshipFilterKey(r)));
    }

    return [...list].sort((a, b) => {
      const keyCmp = a.queryKey.localeCompare(b.queryKey, undefined, { numeric: true });
      if (keyCmp !== 0) return keyCmp;
      return a.platformName.localeCompare(b.platformName);
    });
  }, [rows, relationshipFilters]);

  const queryKeyRowSpans = useMemo(
    () => buildRowSpanByKey(filteredRows, (r) => r.queryKey),
    [filteredRows],
  );

  const merchantGroupNumbers = useMemo(
    () => buildMerchantGroupNumbers(queryKeyRowSpans),
    [queryKeyRowSpans],
  );

  const merchantGroupMeta = useMemo(
    () => buildMerchantGroupMeta(filteredRows),
    [filteredRows],
  );

  const merchantInfoByKey = useMemo(
    () => buildMerchantInfoByKey(filteredRows),
    [filteredRows],
  );

  const merchantMergedOnCell = (_: MerchantStatusRow, index?: number) => ({
    rowSpan: queryKeyRowSpans[index ?? 0] ?? 1,
    className: 'merchant-status-merchant-cell',
  });

  const getRowClassName = (r: MerchantStatusRow, index?: number) => {
    const meta = merchantGroupMeta[index ?? 0];
    if (!meta) return '';
    const classes = [
      meta.groupNo % 2 === 0 ? 'merchant-status-group-even' : 'merchant-status-group-odd',
      meta.isFirst && meta.groupNo > 1 ? 'merchant-status-group-start' : '',
      meta.isLast ? 'merchant-status-group-end' : '',
    ];
    if (r.error) classes.push('merchant-status-row-failed');
    else if (r.actionable) classes.push('merchant-status-row-actionable');
    return classes.filter(Boolean).join(' ');
  };

  const detailColumns: ColumnsType<MerchantStatusRow> = [
    {
      title: '#',
      key: 'index',
      width: 44,
      align: 'center',
      onCell: (_, index) => ({
        rowSpan: queryKeyRowSpans[index ?? 0] ?? 1,
        className: 'merchant-status-index-cell',
      }),
      render: (_, __, index) => (
        <span className="merchant-status-row-no">{merchantGroupNumbers[index ?? 0]}</span>
      ),
    },
    {
      title: '商家ID',
      key: 'merchantId',
      width: 88,
      align: 'center',
      onCell: merchantMergedOnCell,
      render: (_, r) => {
        const info = merchantInfoByKey.get(r.queryKey);
        return <span className="merchant-status-merchant-id">{info?.merchantId ?? r.queryKey}</span>;
      },
    },
    {
      title: 'mcid',
      key: 'mcid',
      width: 120,
      align: 'center',
      onCell: merchantMergedOnCell,
      render: (_, r) => {
        const info = merchantInfoByKey.get(r.queryKey);
        const mcid = info?.mcid;
        return mcid ? (
          <span className="merchant-status-merchant-mcid">{mcid}</span>
        ) : (
          <span className="merchant-status-dash">—</span>
        );
      },
    },
    {
      title: '商家名',
      key: 'merchantName',
      width: 120,
      align: 'center',
      ellipsis: true,
      onCell: merchantMergedOnCell,
      render: (_, r) => {
        const info = merchantInfoByKey.get(r.queryKey);
        const name = info?.merchantName;
        return name ? (
          <span className="merchant-status-merchant-name">{name}</span>
        ) : (
          <span className="merchant-status-dash">—</span>
        );
      },
    },
    {
      title: '平台',
      key: 'platform',
      width: 108,
      align: 'center',
      render: (_, r) => renderPlatformBadge(r.platformCode, r.platformName),
    },
    {
      title: '渠道账号',
      key: 'channel',
      width: 112,
      align: 'center',
      ellipsis: true,
      render: (_, r) => (
        <div className="merchant-status-channel-block">
          <div className="merchant-status-channel-name">{r.channelDisplayName}</div>
          <div className="merchant-status-channel-alias">{r.affiliateAlias}</div>
        </div>
      ),
    },
    {
      title: '上架',
      dataIndex: 'merchantAvailability',
      width: 52,
      align: 'center',
      render: (v: string) => {
        if (v === 'online' || v === 'offline') {
          return (
            <span className={`merchant-status-availability is-${v}`}>
              {AVAILABILITY_LABEL[v]}
            </span>
          );
        }
        return <span className="merchant-status-dash">—</span>;
      },
    },
    {
      title: '账号关系',
      key: 'relationship',
      width: 92,
      align: 'center',
      fixed: 'right',
      className: 'merchant-status-col-relationship',
      render: (_, r) => {
        const label = r.error ? '查询失败' : (RELATIONSHIP_LABEL[r.relationshipStatus] ?? r.relationshipStatus);
        const variant = r.error ? 'failed' : (RELATIONSHIP_PILL_CLASS[r.relationshipStatus] ?? 'unknown');
        const pill = renderStatusPill(label, variant, 'md');
        return r.error ? (
          <Tooltip title={r.error} placement="topLeft">
            {pill}
          </Tooltip>
        ) : (
          pill
        );
      },
    },
    {
      title: '投前建议',
      dataIndex: 'actionLabel',
      width: 88,
      align: 'center',
      fixed: 'right',
      render: (v: string) => renderStatusPill(v, ACTION_PILL_CLASS[v] ?? 'unknown', 'sm'),
    },
  ];

  const adminSummaryColumns: ColumnsType<UserPassSummary> = [
    { title: '员工', dataIndex: 'username', width: 120 },
    { title: '可投合计', dataIndex: 'totalPassed', width: 100 },
    {
      title: '各平台通过数',
      render: (_, r) => (
        <Space wrap size={[4, 4]}>
          {r.byPlatform.map((p) => (
            <Tag key={p.platformCode}>
              {p.platformName}: {p.passed}
              {p.pending > 0 ? ` / 待审${p.pending}` : ''}
            </Tag>
          ))}
        </Space>
      ),
    },
  ];

  const accountPicker = showQueryPanels ? (
    <>
      <MerchantAccountPicker
        accounts={accounts}
        selectedIds={selectedAccountIds}
        onChange={setSelectedAccountIds}
      />
      {accounts.length === 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 12 }}
          message="暂无平台账号"
          description={
            <>
              请先在
              <Link to="/channel-accounts"> 我的平台账号 </Link>
              中配置 API Token。
            </>
          }
        />
      )}
    </>
  ) : null;

  return (
    <div className="merchant-status-page">
      {viewUserId && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={`管理员视角：正在查看员工「${viewUsername}」的商家状态查询`}
          action={<Link to={`/admin/users/${viewUserId}`}>用户详情</Link>}
        />
      )}

      <div className="merchant-status-hero">
        <span className="merchant-status-eyebrow">MERCHANT STATUS</span>
        <h1 className="merchant-status-title">商家状态查询</h1>
        <p className="merchant-status-desc">
          输入 MID、mcid 或域名，在所选平台账号中检测 Join 关系、商家上架与投前建议。支持单个查询、批量粘贴与 Excel 导入。
        </p>
      </div>

      <Card className="merchant-status-main-card" styles={{ body: { paddingTop: 8 } }}>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          className="merchant-status-tabs"
          items={[
            {
              key: 'single',
              label: '单个查询',
              children: (
                <div className="merchant-query-panel">
                  <Input.Search
                    size="large"
                    placeholder="输入 MID、mcid 或域名，例如 123456 / nike / example.com"
                    value={singleInput}
                    onChange={(e) => setSingleInput(e.target.value)}
                    onSearch={querySingle}
                    enterButton="查询"
                    loading={loading}
                    className="merchant-query-search"
                  />
                  <p className="merchant-query-hint">
                    纯数字视为 MID；含 <code>.</code> 视为域名；其余视为 mcid
                  </p>
                </div>
              ),
            },
            {
              key: 'paste',
              label: '批量粘贴',
              children: (
                <div className="merchant-query-panel">
                  <Input.TextArea
                    rows={8}
                    className="merchant-query-textarea"
                    placeholder="每行一个 MID，或用逗号/空格分隔。也支持 mcid 与域名。"
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                  />
                  <div className="merchant-query-actions">
                    <Button type="primary" size="large" loading={loading} onClick={() => void queryPaste()}>
                      开始查询
                    </Button>
                    {parsedPreview.length > 0 && (
                      <span className="merchant-query-preview">已解析 {parsedPreview.length} 个商家</span>
                    )}
                  </div>
                </div>
              ),
            },
            {
              key: 'import',
              label: 'Excel 导入',
              children: (
                <div className="merchant-query-panel">
                  <Upload beforeUpload={onImportFile} accept=".xlsx,.xls,.csv" maxCount={1} showUploadList={false}>
                    <Button size="large" icon={<UploadOutlined />} loading={loading}>
                      选择 Excel / CSV 文件
                    </Button>
                  </Upload>
                  <Alert
                    type="info"
                    showIcon
                    className="merchant-query-import-tip"
                    message="支持联盟推荐表：自动跳过标题行，识别 mcid / MID / Website（网址）列"
                  />
                </div>
              ),
            },
            ...(isAdmin
              ? [
                  {
                    key: 'admin-summary',
                    label: '管理员汇总',
                    children: (
                      <div className="merchant-query-panel">
                        <Alert
                          type="info"
                          showIcon
                          message="同一批商家，统计每个员工在各平台的「可投」数量（已 Join + 仍 Online）"
                        />
                        <Select
                          mode="multiple"
                          allowClear
                          placeholder="选择员工（默认全公司活跃员工）"
                          style={{ width: '100%', maxWidth: 560 }}
                          options={employees.map((e) => ({ value: e.id, label: e.username }))}
                          value={selectedEmployeeIds}
                          onChange={setSelectedEmployeeIds}
                        />
                        <Input.TextArea
                          rows={6}
                          className="merchant-query-textarea"
                          placeholder="粘贴 MID 列表，或使用下方导入"
                          value={pasteText}
                          onChange={(e) => setPasteText(e.target.value)}
                        />
                        <Space>
                          <Button
                            type="primary"
                            size="large"
                            loading={loading}
                            onClick={async () => {
                              const { data } = await api.post<ApiResult<MerchantQueryItem[]>>(
                                '/merchants/status/parse-text',
                                { text: pasteText },
                              );
                              if (data.success) await runAdminSummary(data.data);
                              else message.error(data.message);
                            }}
                          >
                            汇总查询
                          </Button>
                          <Upload
                            beforeUpload={onImportFile}
                            accept=".xlsx,.xls,.csv"
                            maxCount={1}
                            showUploadList={false}
                          >
                            <Button size="large" icon={<UploadOutlined />}>
                              导入并汇总
                            </Button>
                          </Upload>
                        </Space>
                      </div>
                    ),
                  },
                ]
              : []),
          ]}
        />
        {accountPicker}
      </Card>

      {showEmptyHint && (
        <div className="merchant-status-empty">
          <SearchOutlined className="merchant-status-empty-icon" />
          <div className="merchant-status-empty-title">输入商家信息后开始查询</div>
          <div className="merchant-status-empty-desc">
            将在上方所选 {selectedAccountIds.length} 个平台账号中检测 Join 状态与上架情况
          </div>
        </div>
      )}

      {sessionRestored && (rows.length > 0 || summary) && activeTab !== 'admin-summary' && (
        <Alert
          type="info"
          showIcon
          closable
          style={{ marginBottom: 16 }}
          message="已恢复上次查询结果（仅保存在当前浏览器标签页，未写入数据库）"
          onClose={() => setSessionRestored(false)}
        />
      )}

      {parsedPreview.length > 0 && activeTab !== 'admin-summary' && summary && (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 16 }}
          message={`已解析 ${parsedPreview.length} 个商家`}
        />
      )}

      {summary && activeTab !== 'admin-summary' && (
        <Card size="small" className="merchant-status-summary-card">
          <SummaryBar summary={summary} />
        </Card>
      )}

      {activeTab === 'admin-summary' && adminGrandTotal && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={4}><Statistic title="全公司可投" value={adminGrandTotal.actionable} valueStyle={{ color: '#16a34a' }} /></Col>
            <Col span={4}><Statistic title="待审核" value={adminGrandTotal.pending} /></Col>
            <Col span={4}><Statistic title="不可投" value={adminGrandTotal.notJoined + adminGrandTotal.notFound + adminGrandTotal.rejected + adminGrandTotal.offline} /></Col>
            <Col span={4}><Statistic title="失败" value={adminGrandTotal.failed} valueStyle={{ color: '#dc2626' }} /></Col>
          </Row>
        </Card>
      )}

      {activeTab === 'admin-summary' && adminSummary.length > 0 && (
        <Card
          title="员工 × 平台通过数"
          style={{ marginBottom: 16 }}
          extra={
            <Button
              onClick={() =>
                void exportMerchantStatusExcel(
                  adminSummary.flatMap((u) =>
                    u.byPlatform.map((p) => ({
                      queryKey: u.username,
                      merchantId: null,
                      mcid: null,
                      merchantName: null,
                      siteUrl: null,
                      platformName: p.platformName,
                      channelDisplayName: '',
                      affiliateAlias: '',
                      ownerUsername: u.username,
                      relationshipStatus: '',
                      relationshipRaw: null,
                      merchantAvailability: '',
                      availabilityRaw: null,
                      actionLabel: `可投 ${p.passed}`,
                      error: null,
                      queriedAt: new Date().toISOString(),
                    })),
                  ),
                  '商家状态汇总',
                  true,
                )
              }
            >
              导出汇总
            </Button>
          }
        >
          <Table
            rowKey="userId"
            dataSource={adminSummary}
            columns={adminSummaryColumns}
            pagination={{ pageSize: 20 }}
            size="small"
          />
        </Card>
      )}

      {rows.length > 0 && activeTab !== 'admin-summary' && (
        <Card
          className="merchant-status-results-card"
          title="查询结果"
          extra={
            <Space>
              <Select
                mode="multiple"
                allowClear
                placeholder="账号关系筛选"
                value={relationshipFilters}
                onChange={setRelationshipFilters}
                style={{ minWidth: 220 }}
                maxTagCount="responsive"
                options={RELATIONSHIP_FILTER_OPTIONS}
              />
              <Button
                onClick={() =>
                  void exportMerchantStatusExcel(
                    filteredRows.map((r) => ({ ...r })),
                    '商家状态查询',
                    Boolean(viewUserId),
                  )
                }
              >
                导出 Excel
              </Button>
              <Button onClick={clearQueryResults}>
                清除结果
              </Button>
            </Space>
          }
        >
          <Table
            className="merchant-status-results"
            rowKey={(r) => `${r.queryKey}|${r.channelAccountId}`}
            dataSource={filteredRows}
            columns={detailColumns}
            scroll={{ x: 980 }}
            pagination={{ pageSize: 50, showTotal: (t) => `共 ${t} 条`, size: 'small' }}
            size="small"
            rowClassName={getRowClassName}
          />
        </Card>
      )}
    </div>
  );
}
