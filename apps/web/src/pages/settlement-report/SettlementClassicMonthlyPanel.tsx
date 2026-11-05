import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  DatePicker,
  Dropdown,
  Empty,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Tooltip,
  message,
} from 'antd';
import type { MenuProps } from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import {
  DownloadOutlined,
  ReloadOutlined,
  SaveOutlined,
  EditOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { api, type ApiResult } from '../../api/client';
import { exportSettlementMonthlyExcel } from '../../utils/exportSettlementMonthly';
import './settlement-report.css';

export interface SettlementMonthlyAdSpendRow {
  mccLabel: string;
  currency: string;
  librarySpendUsd: number;
  adjustmentUsd: number;
  spendUsd: number;
  adSourceId: number;
  splitBindingPending?: boolean;
}

export interface SettlementMonthlyColumn {
  key: string;
  label: string;
  platformName: string;
  accountHint: string;
}

type CommissionHalfDraft = Record<string, { usdH1: number; usdH2: number }>;
type HalfDraftKind = 'actual' | 'receivable';

export interface SettlementMonthlyMatrixRow {
  rowKey: string;
  label: string;
  rowType: 'money' | 'text';
  values: Record<string, number>;
  textValues?: Record<string, string>;
  totalUsd: number;
}

export interface SettlementMonthlyReport {
  month: string;
  usdCnyRate: number;
  rateNote: string;
  usdCnyRateLive?: boolean;
  adSpendRows: SettlementMonthlyAdSpendRow[];
  adSpendTotalUsd: number;
  rebateAdSpendUsd: number;
  activeCampaignCount: number;
  columns: SettlementMonthlyColumn[];
  matrixRows: SettlementMonthlyMatrixRow[];
  distributableProfitBookUsd: number;
  distributableProfitBookCny: number;
  actualCommissionTotalUsd: number;
  canEditActualCommission: boolean;
  canEditAdSpend: boolean;
  canEditPayoutInfo?: boolean;
  adSpendSplitPending?: boolean;
  startDate?: string;
  endDate?: string;
}

export interface EmployeeOption {
  id: number;
  username: string;
}

export interface SettlementClassicMonthlyPanelProps {
  isAdmin: boolean;
  effectiveScopeUserId: number | null;
  employees: EmployeeOption[];
  scopeUserId: number | null;
  onScopeChange: (userId: number | null) => void;
}


type AdSpendDraftLine = {
  adSourceId: number;
  librarySpendUsd: number;
  adjustmentUsd: number;
  spendUsd: number;
};

type PayoutDraft = Record<string, { payeeName: string; bankAccount: string }>;

function fmtUsd(v: number) {
  return `$${Number(v).toFixed(2)}`;
}

function fmtCny(v: number, rate: number) {
  return `¥${(Number(v) * rate).toFixed(2)}`;
}

function profitClass(v: number) {
  if (v < 0) return 'sr-profit-negative';
  if (v > 0) return 'sr-profit-positive';
  return '';
}

/**
 * 竞品式月度结算报表（广告费表 + USD/CNY 双列佣金矩阵）
 */
export default function SettlementClassicMonthlyPanel({
  isAdmin,
  effectiveScopeUserId,
  employees,
  scopeUserId,
  onScopeChange,
}: SettlementClassicMonthlyPanelProps) {
  const [month, setMonth] = useState<Dayjs>(() => dayjs().startOf('month'));
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<SettlementMonthlyReport | null>(null);
  const [actualDraft, setActualDraft] = useState<CommissionHalfDraft>({});
  const [receivableDraft, setReceivableDraft] = useState<CommissionHalfDraft>({});
  const [savingActual, setSavingActual] = useState(false);
  const [savingReceivable, setSavingReceivable] = useState(false);
  const [syncingRw, setSyncingRw] = useState(false);
  const [syncingLb, setSyncingLb] = useState(false);
  const [syncingLh, setSyncingLh] = useState(false);
  const [syncingPm, setSyncingPm] = useState(false);
  const [syncingUi, setSyncingUi] = useState(false);
  const [syncingFs, setSyncingFs] = useState(false);
  const [syncingCg, setSyncingCg] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<string>('');
  const [systemReceivable, setSystemReceivable] = useState<CommissionHalfDraft>({});
  const [systemActual, setSystemActual] = useState<CommissionHalfDraft>({});
  /** 对标站「手工调整」开关；开启后可点击应收/实收单元格编辑 */
  const [manualAdjustMode, setManualAdjustMode] = useState(false);
  /** 格式 kind:colKey:usdH1|usdH2 */
  const [activeCommissionCell, setActiveCommissionCell] = useState<string | null>(null);
  const [adSpendDraft, setAdSpendDraft] = useState<AdSpendDraftLine[]>([]);
  const [rebateDraft, setRebateDraft] = useState(0);
  const [savingAdSpend, setSavingAdSpend] = useState(false);
  const [payoutDraft, setPayoutDraft] = useState<PayoutDraft>({});
  const [savingPayout, setSavingPayout] = useState(false);

  const monthStr = month.format('YYYY-MM');

  const loadReport = useCallback(async (refreshFx = false) => {
    setLoading(true);
    try {
      const params: Record<string, string> = { month: monthStr };
      if (effectiveScopeUserId != null) {
        params.userId = String(effectiveScopeUserId);
      }
      if (refreshFx) {
        params.refreshFx = '1';
      }
      const { data } = await api.get<ApiResult<SettlementMonthlyReport>>(
        '/reports/settlement-monthly',
        { params },
      );
      if (!data.success) {
        message.error(data.message || '加载失败');
        return;
      }
      setReport(data.data);
      setGeneratedAt(dayjs().format('YYYY-MM-DD HH:mm:ss'));
    } catch {
      message.error('加载结算报表失败');
    } finally {
      setLoading(false);
    }
  }, [monthStr, effectiveScopeUserId]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  useEffect(() => {
    if (!report) return;
    const actualH1 = report.matrixRows.find((r) => r.rowKey === 'actual_h1')?.values ?? {};
    const actualH2 = report.matrixRows.find((r) => r.rowKey === 'actual_h2')?.values ?? {};
    const recvH1 = report.matrixRows.find((r) => r.rowKey === 'recv_h1')?.values ?? {};
    const recvH2 = report.matrixRows.find((r) => r.rowKey === 'recv_h2')?.values ?? {};
    const actual: CommissionHalfDraft = {};
    const receivable: CommissionHalfDraft = {};
    for (const c of report.columns) {
      actual[c.key] = { usdH1: actualH1[c.key] ?? 0, usdH2: actualH2[c.key] ?? 0 };
      receivable[c.key] = { usdH1: recvH1[c.key] ?? 0, usdH2: recvH2[c.key] ?? 0 };
    }
    setActualDraft(actual);
    setReceivableDraft(receivable);
    setSystemActual(JSON.parse(JSON.stringify(actual)) as CommissionHalfDraft);
    setSystemReceivable(JSON.parse(JSON.stringify(receivable)) as CommissionHalfDraft);
    setAdSpendDraft(
      report.adSpendRows.map((r) => ({
        adSourceId: r.adSourceId,
        librarySpendUsd: r.librarySpendUsd,
        adjustmentUsd: r.adjustmentUsd,
        spendUsd: r.spendUsd,
      })),
    );
    setRebateDraft(report.rebateAdSpendUsd ?? 0);
    const payeeRow = report.matrixRows.find((r) => r.rowKey === 'payee');
    const bankRow = report.matrixRows.find((r) => r.rowKey === 'bank');
    const payout: PayoutDraft = {};
    for (const c of report.columns) {
      payout[c.key] = {
        payeeName: payeeRow?.textValues?.[c.key]?.trim() ?? '',
        bankAccount: bankRow?.textValues?.[c.key]?.trim() ?? '',
      };
    }
    setPayoutDraft(payout);
  }, [report]);

  const rate = report?.usdCnyRate ?? 7.25;
  const canEdit = report?.canEditActualCommission ?? false;
  const canEditAdSpend = report?.canEditAdSpend ?? false;
  const canEditPayout = report?.canEditPayoutInfo ?? canEdit;
  const cols = report?.columns ?? [];

  const rowMap = useMemo(() => {
    const m = new Map<string, SettlementMonthlyMatrixRow>();
    for (const r of report?.matrixRows ?? []) {
      m.set(r.rowKey, r);
    }
    return m;
  }, [report?.matrixRows]);

  const actualTotalUsd = useMemo(
    () =>
      Object.values(actualDraft).reduce((s, h) => s + (h.usdH1 || 0) + (h.usdH2 || 0), 0),
    [actualDraft],
  );

  const receivableTotalUsd = useMemo(
    () =>
      Object.values(receivableDraft).reduce((s, h) => s + (h.usdH1 || 0) + (h.usdH2 || 0), 0),
    [receivableDraft],
  );

  const adSpendTotalDraft = useMemo(
    () => adSpendDraft.reduce((s, r) => s + (r.spendUsd || 0), 0),
    [adSpendDraft],
  );

  const bookCommissionTotal = rowMap.get('book')?.totalUsd ?? 0;
  const distributableBookUsd = bookCommissionTotal - adSpendTotalDraft;

  const distributableActualUsd = adSpendTotalDraft * -1 + actualTotalUsd;
  const distributableActualCny = distributableActualUsd * rate;

  const patchAdSpendLine = (adSourceId: number, patch: Partial<AdSpendDraftLine>) => {
    setAdSpendDraft((prev) =>
      prev.map((row) => (row.adSourceId === adSourceId ? { ...row, ...patch } : row)),
    );
  };

  const savePayoutInfo = async () => {
    if (!canEditPayout || !report) return;
    setSavingPayout(true);
    try {
      const lines = report.columns.map((c) => ({
        channelAccountId: Number(c.key),
        payeeName: payoutDraft[c.key]?.payeeName ?? '',
        bankAccount: payoutDraft[c.key]?.bankAccount ?? '',
      }));
      const body: { lines: typeof lines; userId?: string } = { lines };
      if (effectiveScopeUserId != null) {
        body.userId = String(effectiveScopeUserId);
      }
      const { data } = await api.put<ApiResult<{ saved: boolean }>>(
        '/reports/settlement-monthly/payout-info',
        body,
      );
      if (!data.success) {
        message.error(data.message || '保存失败');
        return;
      }
      message.success('收款信息已保存');
      await loadReport();
    } catch {
      message.error('保存收款信息失败');
    } finally {
      setSavingPayout(false);
    }
  };

  const saveAdSpend = async () => {
    if (!canEditAdSpend) return;
    setSavingAdSpend(true);
    try {
      const body: {
        month: string;
        lines: Array<{ adSourceId: number; adjustmentUsd: number; spendUsd: number }>;
        rebateAdSpendUsd: number;
        userId?: string;
      } = {
        month: monthStr,
        lines: adSpendDraft.map(({ adSourceId, adjustmentUsd, spendUsd }) => ({
          adSourceId,
          adjustmentUsd,
          spendUsd,
        })),
        rebateAdSpendUsd: rebateDraft,
      };
      if (effectiveScopeUserId != null) {
        body.userId = String(effectiveScopeUserId);
      }
      const { data } = await api.put<ApiResult<unknown>>('/reports/settlement-monthly/ad-spend', body);
      if (!data.success) {
        message.error(data.message || '保存失败');
        return;
      }
      message.success('广告费已保存');
      await loadReport();
    } catch {
      message.error('保存广告费失败');
    } finally {
      setSavingAdSpend(false);
    }
  };

  const paymentSyncConfig = {
    rewardoo: {
      path: '/reports/settlement-monthly/sync-rewardoo-payments',
      label: 'Rewardoo',
      short: 'RW',
    },
    linkbux: {
      path: '/reports/settlement-monthly/sync-linkbux-payments',
      label: 'LinkBux',
      short: 'LB',
    },
    linkhaitao: {
      path: '/reports/settlement-monthly/sync-linkhaitao-payments',
      label: 'LinkHaitao',
      short: 'LH',
    },
    partnermatic: {
      path: '/reports/settlement-monthly/sync-partnermatic-payments',
      label: 'Partnermatic',
      short: 'PM',
    },
    ultrainfluence: {
      path: '/reports/settlement-monthly/sync-ultrainfluence-payments',
      label: 'UltraInfluence',
      short: 'UI',
    },
    famesta: {
      path: '/reports/settlement-monthly/sync-famesta-payments',
      label: 'Famesta',
      short: 'FS',
    },
    collabglow: {
      path: '/reports/settlement-monthly/sync-collabglow-payments',
      label: 'CollabGlow',
      short: 'CG',
    },
  } as const;

  type PaymentSyncLine = {
    channelAccountId?: number;
    displayName: string;
    error?: string;
    receivable?: { usdH1: number; usdH2: number };
    actual?: { usdH1: number; usdH2: number };
  };

  const applySyncLinesToDraft = (lines: PaymentSyncLine[]) => {
    setReceivableDraft((prev) => {
      const next = { ...prev };
      for (const line of lines) {
        if (line.channelAccountId == null || !line.receivable) continue;
        next[String(line.channelAccountId)] = line.receivable;
      }
      return next;
    });
    setActualDraft((prev) => {
      const next = { ...prev };
      for (const line of lines) {
        if (line.channelAccountId == null || !line.actual) continue;
        next[String(line.channelAccountId)] = line.actual;
      }
      return next;
    });
  };

  const syncPlatformPayments = async (
    platform: keyof typeof paymentSyncConfig,
    setLoading: (v: boolean) => void,
    opts?: { quiet?: boolean },
  ) => {
    if (!report?.canEditActualCommission) return;
    setLoading(true);
    const { path, label, short } = paymentSyncConfig[platform];
    try {
      const body: { month: string; userId?: string } = { month: monthStr };
      if (effectiveScopeUserId != null) {
        body.userId = String(effectiveScopeUserId);
      }
      const { data } = await api.post<
        ApiResult<{
          month: string;
          synced: PaymentSyncLine[];
        }>
      >(path, body, { timeout: 600_000 });
      if (!data.success) {
        message.error(data.message || '同步失败');
        return;
      }
      applySyncLinesToDraft(data.data.synced);
      const failed = data.data.synced.filter((s) => s.error);
      if (!opts?.quiet) {
        if (failed.length) {
          const detail = failed
            .map((f) => `${f.displayName}${f.error ? ` — ${f.error}` : ''}`)
            .join('\n');
          message.warning({
            content: `${label} 部分账号未写入：\n${detail}`,
            duration: 12,
          });
        } else {
          message.success(`已同步 ${data.data.synced.length} 个 ${label} 账号`);
        }
      }
      await loadReport();
    } catch {
      message.error(`同步 ${short} 打款失败`);
    } finally {
      setLoading(false);
    }
  };

  const syncAllPlatformPayments = async () => {
    if (!report?.canEditActualCommission) return;
    setSyncingAll(true);
    try {
      const body: { month: string; userId?: string } = { month: monthStr };
      if (effectiveScopeUserId != null) {
        body.userId = String(effectiveScopeUserId);
      }
      const { data } = await api.post<
        ApiResult<{
          month: string;
          platforms: Array<{
            platform: string;
            synced: number;
            failed: number;
            lines: Array<{
              displayName: string;
              affiliateAlias: string;
              receivableUsd: number;
              actualUsd: number;
              error?: string;
            }>;
          }>;
        }>
      >('/reports/settlement-monthly/sync-all-payments', body, { timeout: 600_000 });
      if (!data.success) {
        message.error(data.message || '同步失败');
        return;
      }
      const failedLines = data.data.platforms.flatMap((p) =>
        p.lines.filter((l) => l.error).map((l) => `${p.platform}/${l.displayName}: ${l.error}`),
      );
      if (failedLines.length) {
        message.warning({ content: failedLines.slice(0, 3).join('\n'), duration: 10 });
      }
      message.success('全部平台打款已同步，正在刷新报表…');
      await loadReport();
    } catch {
      message.error('同步全部平台打款超时或失败，请稍后只读刷新查看是否已部分写入');
    } finally {
      setSyncingAll(false);
    }
  };

  const saveReceivable = async () => {
    if (!report?.canEditActualCommission) return;
    setSavingReceivable(true);
    try {
      const halfValues: CommissionHalfDraft = {};
      for (const c of report.columns) {
        halfValues[c.key] = receivableDraft[c.key] ?? { usdH1: 0, usdH2: 0 };
      }
      const body: { month: string; halfValues: CommissionHalfDraft; userId?: string } = {
        month: monthStr,
        halfValues,
      };
      if (effectiveScopeUserId != null) {
        body.userId = String(effectiveScopeUserId);
      }
      const { data } = await api.put<ApiResult<{ halfValues: CommissionHalfDraft }>>(
        '/reports/settlement-monthly/receivable-commission',
        body,
      );
      if (!data.success) {
        message.error(data.message || '保存失败');
        return;
      }
      message.success('应收佣金已保存');
      await loadReport();
    } catch {
      message.error('保存应收佣金失败');
    } finally {
      setSavingReceivable(false);
    }
  };

  const saveActual = async () => {
    if (!report?.canEditActualCommission) return;
    setSavingActual(true);
    try {
      const halfValues: CommissionHalfDraft = {};
      for (const c of report.columns) {
        halfValues[c.key] = actualDraft[c.key] ?? { usdH1: 0, usdH2: 0 };
      }
      const body: { month: string; halfValues: CommissionHalfDraft; userId?: string } = {
        month: monthStr,
        halfValues,
      };
      if (effectiveScopeUserId != null) {
        body.userId = String(effectiveScopeUserId);
      }
      const { data } = await api.put<ApiResult<{ halfValues: CommissionHalfDraft }>>(
        '/reports/settlement-monthly/actual-commission',
        body,
      );
      if (!data.success) {
        message.error(data.message || '保存失败');
        return;
      }
      message.success('实收佣金已保存');
      await loadReport();
    } catch {
      message.error('保存实收佣金失败');
    } finally {
      setSavingActual(false);
    }
  };

  const handleExport = () => {
    if (!report) return;
    exportSettlementMonthlyExcel({
      month: report.month,
      usdCnyRate: report.usdCnyRate,
      rateNote: report.rateNote,
      adSpendRows: adSpendDraft.map((r, i) => {
        const meta = report.adSpendRows[i];
        return {
          mccLabel: meta?.mccLabel ?? '',
          currency: meta?.currency ?? 'USD',
          librarySpendUsd: r.librarySpendUsd,
          adjustmentUsd: r.adjustmentUsd,
          spendUsd: r.spendUsd,
        };
      }),
      adSpendTotalUsd: adSpendTotalDraft,
      columns: report.columns,
      matrixRows: report.matrixRows
        .filter((r) => r.rowType === 'money' || r.rowType === 'text')
        .map((r) => {
          if (r.rowKey === 'payee') {
            return {
              ...r,
              textValues: Object.fromEntries(
                report.columns.map((c) => [c.key, payoutDraft[c.key]?.payeeName ?? '']),
              ),
            };
          }
          if (r.rowKey === 'bank') {
            return {
              ...r,
              textValues: Object.fromEntries(
                report.columns.map((c) => [c.key, payoutDraft[c.key]?.bankAccount ?? '']),
              ),
            };
          }
          return r;
        }),
      distributableProfitBookUsd: distributableBookUsd,
      distributableProfitBookCny: distributableBookUsd * rate,
    });
  };

  const draftFor = (kind: HalfDraftKind) =>
    kind === 'actual' ? actualDraft : receivableDraft;

  const setDraftFor = (kind: HalfDraftKind) =>
    kind === 'actual' ? setActualDraft : setReceivableDraft;

  const cellUsd = (rowKey: string, colKey: string, kind: HalfDraftKind = 'actual') => {
    const draft = draftFor(kind);
    if (rowKey === 'actual_total' && canEdit && kind === 'actual') {
      return (draft[colKey]?.usdH1 ?? 0) + (draft[colKey]?.usdH2 ?? 0);
    }
    if (rowKey === 'recv_total' && canEdit && kind === 'receivable') {
      return (draft[colKey]?.usdH1 ?? 0) + (draft[colKey]?.usdH2 ?? 0);
    }
    return rowMap.get(rowKey)?.values[colKey] ?? 0;
  };

  const rowTotal = (rowKey: string, kind: HalfDraftKind = 'actual') => {
    const draft = draftFor(kind);
    if (canEdit && kind === 'actual' && rowKey === 'actual_h1') {
      return Object.values(draft).reduce((s, h) => s + h.usdH1, 0);
    }
    if (canEdit && kind === 'actual' && rowKey === 'actual_h2') {
      return Object.values(draft).reduce((s, h) => s + h.usdH2, 0);
    }
    if (canEdit && kind === 'actual' && rowKey === 'actual_total') {
      return actualTotalUsd;
    }
    if (canEdit && kind === 'receivable' && rowKey === 'recv_h1') {
      return Object.values(draft).reduce((s, h) => s + h.usdH1, 0);
    }
    if (canEdit && kind === 'receivable' && rowKey === 'recv_h2') {
      return Object.values(draft).reduce((s, h) => s + h.usdH2, 0);
    }
    if (canEdit && kind === 'receivable' && rowKey === 'recv_total') {
      return receivableTotalUsd;
    }
    return rowMap.get(rowKey)?.totalUsd ?? 0;
  };

  const systemDraftFor = (kind: HalfDraftKind) =>
    kind === 'actual' ? systemActual : systemReceivable;

  const isHalfManual = (colKey: string, field: 'usdH1' | 'usdH2', kind: HalfDraftKind) => {
    const draft = draftFor(kind)[colKey]?.[field] ?? 0;
    const sys = systemDraftFor(kind)[colKey]?.[field] ?? 0;
    return Math.abs(draft - sys) > 0.0001;
  };

  const commissionCellKey = (
    kind: HalfDraftKind,
    colKey: string,
    field: 'usdH1' | 'usdH2',
  ) => `${kind}:${colKey}:${field}`;

  const resetCommissionHalf = (
    colKey: string,
    field: 'usdH1' | 'usdH2',
    kind: HalfDraftKind,
  ) => {
    const setDraft = setDraftFor(kind);
    const sys = systemDraftFor(kind)[colKey] ?? { usdH1: 0, usdH2: 0 };
    setDraft((prev) => ({
      ...prev,
      [colKey]: {
        usdH1: field === 'usdH1' ? sys.usdH1 : (prev[colKey]?.usdH1 ?? 0),
        usdH2: field === 'usdH2' ? sys.usdH2 : (prev[colKey]?.usdH2 ?? 0),
      },
    }));
    setActiveCommissionCell(null);
  };

  type MatrixValueLayout = 'singleUsd' | 'usdCny';

  const renderEditableUsdCell = (
    cKey: string,
    rowKey: string,
    kind: HalfDraftKind,
    field: 'usdH1' | 'usdH2',
    layout: MatrixValueLayout,
  ) => {
    const draft = draftFor(kind);
    const setDraft = setDraftFor(kind);
    const usd = cellUsd(rowKey, cKey, kind);
    const canClickEdit = canEdit;
    const focusKey = commissionCellKey(kind, cKey, field);
    const isActive = activeCommissionCell === focusKey;
    const isTotalRow = rowKey === 'recv_total' || rowKey === 'actual_total';
    const manual = canClickEdit && isHalfManual(cKey, field, kind);
    const showReset = canClickEdit && !isTotalRow;
    const displayUsd = canClickEdit && !isTotalRow ? (draft[cKey]?.[field] ?? 0) : usd;
    const cellClass = [
      layout === 'singleUsd' ? 'sr-cell-single-usd' : undefined,
      canClickEdit ? 'sr-cell-clickable' : 'sr-cell-readonly',
      isActive ? 'sr-cell-editable' : undefined,
      manual ? 'sr-cell-manual' : undefined,
    ]
      .filter(Boolean)
      .join(' ');

    const inner = isActive ? (
      <div className="sr-cell-edit-wrap">
        <InputNumber
          autoFocus
          min={0}
          step={0.01}
          precision={2}
          size="small"
          value={draft[cKey]?.[field] ?? 0}
          onChange={(v) =>
            setDraft((prev) => ({
              ...prev,
              [cKey]: {
                usdH1: prev[cKey]?.usdH1 ?? 0,
                usdH2: prev[cKey]?.usdH2 ?? 0,
                [field]: typeof v === 'number' ? v : 0,
              },
            }))
          }
          onBlur={() => setActiveCommissionCell(null)}
        />
      </div>
    ) : (
      <div
        className="sr-cell-display"
        role={canClickEdit ? 'button' : undefined}
        tabIndex={canClickEdit ? 0 : undefined}
        onClick={() => {
          if (canClickEdit) setActiveCommissionCell(focusKey);
        }}
        onKeyDown={(e) => {
          if (canClickEdit && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setActiveCommissionCell(focusKey);
          }
        }}
      >
        <span className="sr-money-usd">{fmtUsd(displayUsd)}</span>
        {canClickEdit && !isTotalRow && (
          <EditOutlined className="sr-cell-action sr-cell-pencil" aria-hidden />
        )}
        {showReset && (
          <Tooltip title="清除手填，恢复系统计算值">
            <SyncOutlined
              className={`sr-cell-action sr-cell-reset${manual ? ' sr-cell-reset-active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                resetCommissionHalf(cKey, field, kind);
              }}
            />
          </Tooltip>
        )}
      </div>
    );

    if (layout === 'singleUsd') {
      return (
        <td key={cKey} colSpan={2} align="right" className={cellClass}>
          {inner}
        </td>
      );
    }
    return (
      <Fragment key={cKey}>
        <td align="right" className={cellClass}>
          {inner}
        </td>
        <td align="right" className={cellClass}>
          <span className="sr-money-cny">{fmtCny(displayUsd, rate)}</span>
        </td>
      </Fragment>
    );
  };

  /** 对标站：合计列 USD 在上、CNY 在下（实收行）；账期/应收仅 USD */
  const renderTotalStackCell = (
    rowKey: string,
    kind: HalfDraftKind,
    layout: MatrixValueLayout,
  ) => {
    const usd = rowTotal(rowKey, kind);
    return (
      <td colSpan={2} align="right" className="sr-total-col sr-sticky-right sr-total-stack">
        <span className="sr-money-usd">{fmtUsd(usd)}</span>
        {layout === 'usdCny' ? <span className="sr-money-cny">{fmtCny(usd, rate)}</span> : null}
      </td>
    );
  };

  /** 实收区块内 USD/CNY 子表头（对标站红框区域） */
  const renderActualCurrencyHeaderCells = () => (
    <>
      {cols.map((c) => (
        <Fragment key={`cur-${c.key}`}>
          <td className="sr-currency-head-cell sr-cur-usd">USD</td>
          <td className="sr-currency-head-cell sr-cur-cny">CNY</td>
        </Fragment>
      ))}
      <td colSpan={2} align="right" className="sr-total-col sr-sticky-right sr-total-stack sr-currency-head-total">
        <span className="sr-cur-usd">$</span>
        <span className="sr-cur-cny">¥</span>
      </td>
    </>
  );

  const renderMatrixMoneyCells = (
    rowKey: string,
    layout: MatrixValueLayout,
    editableHalf?: 'h1' | 'h2',
    kind: HalfDraftKind = 'actual',
  ) => {
    const field: 'usdH1' | 'usdH2' = editableHalf === 'h2' ? 'usdH2' : 'usdH1';
    const isEditableRow = Boolean(editableHalf && (kind === 'receivable' || kind === 'actual'));
    return (
      <>
        {cols.map((c) => {
          if (isEditableRow) {
            return renderEditableUsdCell(c.key, rowKey, kind, field, layout);
          }
          const usd = cellUsd(rowKey, c.key, kind);
          if (layout === 'singleUsd') {
            return (
              <td key={c.key} colSpan={2} align="right" className="sr-cell-readonly sr-cell-single-usd">
                <span className="sr-money-usd">{fmtUsd(usd)}</span>
              </td>
            );
          }
          return (
            <Fragment key={c.key}>
              <td align="right" className="sr-cell-readonly">
                <span className="sr-money-usd">{fmtUsd(usd)}</span>
              </td>
              <td align="right" className="sr-cell-readonly">
                <span className="sr-money-cny">{fmtCny(usd, rate)}</span>
              </td>
            </Fragment>
          );
        })}
        {renderTotalStackCell(rowKey, kind, layout)}
      </>
    );
  };

  const saveCommissionDrafts = async () => {
    setActiveCommissionCell(null);
    await saveReceivable();
    await saveActual();
    message.success('应收/实收已保存');
  };

  const toggleManualAdjust = () => {
    setManualAdjustMode((v) => !v);
    if (manualAdjustMode) {
      void saveCommissionDrafts();
    }
  };

  const renderTextCells = (field: 'payeeName' | 'bankAccount') => (
    <>
      {cols.map((c) => {
        const val = payoutDraft[c.key]?.[field]?.trim() ?? '';
        return (
          <td key={c.key} colSpan={2} className={canEditPayout ? 'sr-cell-editable' : undefined}>
            {canEditPayout ? (
              <Input
                size="small"
                value={payoutDraft[c.key]?.[field] ?? ''}
                maxLength={field === 'payeeName' ? 120 : 80}
                placeholder={field === 'payeeName' ? '收款人' : '卡号'}
                onChange={(e) =>
                  setPayoutDraft((prev) => ({
                    ...prev,
                    [c.key]: {
                      payeeName: prev[c.key]?.payeeName ?? '',
                      bankAccount: prev[c.key]?.bankAccount ?? '',
                      [field]: e.target.value,
                    },
                  }))
                }
              />
            ) : (
              val || '—'
            )}
          </td>
        );
      })}
      <td colSpan={2} className="sr-total-col" />
    </>
  );

  return (
    <div className="settlement-report-classic">
      <div className="sr-toolbar">
        <Space wrap>
          <DatePicker
            picker="month"
            value={month}
            onChange={(v) => v && setMonth(v)}
            allowClear={false}
          />
          {isAdmin && (
            <Select
              style={{ minWidth: 200 }}
              value={scopeUserId ?? 'company'}
              onChange={(v) => onScopeChange(v === 'company' ? null : (v as number))}
              options={[
                { value: 'company', label: '全公司' },
                ...employees.map((e) => ({ value: e.id, label: e.username })),
              ]}
            />
          )}
          <Button icon={<ReloadOutlined />} onClick={() => void loadReport(true)} loading={loading}>
            刷新
          </Button>
          <Button type="primary" icon={<DownloadOutlined />} onClick={handleExport} disabled={!report}>
            导出 Excel
          </Button>
        </Space>
      </div>

      {report && (
        <div className="sr-meta-row">
          <div
            className={`sr-rate-bar ${report.usdCnyRateLive === false ? 'sr-rate-bar-fallback' : 'sr-rate-bar-live'}`}
          >
            {report.rateNote}
          </div>
          {generatedAt && <span className="sr-generated-at">生成于 {generatedAt}</span>}
        </div>
      )}

      <div className="sr-section">
        <div className="sr-section-head">
          <h3>广告费</h3>
          {canEditAdSpend && (
            <Button
              type="primary"
              size="small"
              icon={<SaveOutlined />}
              loading={savingAdSpend}
              onClick={() => void saveAdSpend()}
            >
              保存广告费
            </Button>
          )}
        </div>
        <div className="sr-section-body">
          <Spin spinning={loading}>
            {report?.adSpendSplitPending && (
              <Alert
                type="warning"
                showIcon
                style={{ margin: '0 0 12px' }}
                message="MCC 子账号未绑定"
                description="库内广告费已临时汇总到第一个 MCC 行。请对每个 MCC 重新导入 Sheet 后点刷新，才能与广告系列分析按 MCC 一一对应。"
              />
            )}
            <div className="sr-table-wrap">
              <table className="sr-table">
                <thead>
                  <tr>
                    <th>MCC</th>
                    <th>币种</th>
                    <th>库内广告费(原币)</th>
                    <th>补差额($)</th>
                    <th>广告费(原币,可改)</th>
                    <th>折美金($)</th>
                  </tr>
                </thead>
                <tbody>
                  {(report?.adSpendRows ?? []).map((r, i) => {
                    const draft = adSpendDraft[i];
                    const library = draft?.librarySpendUsd ?? r.librarySpendUsd;
                    const adjustment = draft?.adjustmentUsd ?? r.adjustmentUsd;
                    const spend = draft?.spendUsd ?? r.spendUsd;
                    return (
                      <tr key={`${r.adSourceId}|${r.mccLabel}`}>
                        <td className="sr-mcc-name">
                          {r.mccLabel}
                          {report?.adSpendSplitPending &&
                            (draft?.librarySpendUsd ?? r.librarySpendUsd) > 0 && (
                              <span className="sr-mcc-tag">临时汇总</span>
                            )}
                          {report?.adSpendSplitPending &&
                            (draft?.librarySpendUsd ?? r.librarySpendUsd) === 0 &&
                            r.splitBindingPending && (
                              <span className="sr-mcc-tag sr-mcc-tag-muted">待导入拆分</span>
                            )}
                        </td>
                        <td>
                          <span className="sr-currency-tag">{r.currency === 'USD' ? '美金' : r.currency}</span>
                        </td>
                        <td align="right">
                          <span className="sr-money-usd">{fmtUsd(library)}</span>
                        </td>
                        <td align="right">
                          {canEditAdSpend ? (
                            <InputNumber
                              size="small"
                              className="sr-input-money"
                              value={adjustment}
                              step={0.01}
                              onChange={(v) => {
                                const adj = Number(v ?? 0);
                                patchAdSpendLine(r.adSourceId, {
                                  adjustmentUsd: adj,
                                  spendUsd: Math.round((library + adj) * 100) / 100,
                                });
                              }}
                            />
                          ) : (
                            <span className="sr-money-usd">{fmtUsd(adjustment)}</span>
                          )}
                        </td>
                        <td align="right">
                          {canEditAdSpend ? (
                            <InputNumber
                              size="small"
                              className="sr-input-money"
                              value={spend}
                              min={0}
                              step={0.01}
                              onChange={(v) => {
                                const sp = Number(v ?? 0);
                                patchAdSpendLine(r.adSourceId, {
                                  spendUsd: sp,
                                  adjustmentUsd: Math.round((sp - library) * 100) / 100,
                                });
                              }}
                            />
                          ) : (
                            <span className="sr-money-usd">{fmtUsd(spend)}</span>
                          )}
                        </td>
                        <td align="right">
                          <span className="sr-money-usd">{fmtUsd(spend)}</span>
                        </td>
                      </tr>
                    );
                  })}
                  {!report?.adSpendRows.length && (
                    <tr>
                      <td colSpan={6}>
                        <Empty description="暂无广告数据源" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                      </td>
                    </tr>
                  )}
                </tbody>
                {report && (
                  <tfoot>
                    <tr>
                      <td colSpan={2}>广告费合计</td>
                      <td align="right">
                        <span className="sr-money-usd">{fmtUsd(adSpendTotalDraft)}</span>
                      </td>
                      <td>核算广告费</td>
                      <td align="right">
                        {canEditAdSpend ? (
                          <InputNumber
                            size="small"
                            className="sr-input-money"
                            value={rebateDraft}
                            min={0}
                            step={0.01}
                            onChange={(v) => setRebateDraft(Number(v ?? 0))}
                          />
                        ) : (
                          <span className="sr-money-usd">{fmtUsd(rebateDraft)}</span>
                        )}
                      </td>
                      <td align="center">在投广告数 {report.activeCampaignCount}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Spin>
        </div>
      </div>

      <div className="sr-section">
        <div className="sr-section-head">
          <h3>佣金明细</h3>
          {(canEdit || canEditPayout) && (
            <Space size="small" wrap>
              {canEdit && (
                <>
                  <Dropdown
                    menu={{
                      items: [
                        {
                          key: 'all',
                          label: '全部平台',
                          onClick: () => void syncAllPlatformPayments(),
                        },
                        { type: 'divider' },
                        ...(
                          Object.entries(paymentSyncConfig) as [
                            keyof typeof paymentSyncConfig,
                            (typeof paymentSyncConfig)[keyof typeof paymentSyncConfig],
                          ][]
                        ).map(([key, cfg]) => ({
                          key,
                          label: `仅 ${cfg.short}`,
                          onClick: () => {
                            const setters = {
                              rewardoo: setSyncingRw,
                              linkbux: setSyncingLb,
                              linkhaitao: setSyncingLh,
                              partnermatic: setSyncingPm,
                              ultrainfluence: setSyncingUi,
                              famesta: setSyncingFs,
                              collabglow: setSyncingCg,
                            } as const;
                            void syncPlatformPayments(key, setters[key]);
                          },
                        })),
                      ] as MenuProps['items'],
                    }}
                  >
                    <Button size="small" loading={syncingAll || syncingRw || syncingLb || syncingLh || syncingPm || syncingUi || syncingFs || syncingCg}>
                      同步打款数据
                    </Button>
                  </Dropdown>
                  <Button
                    size="small"
                    type={manualAdjustMode ? 'primary' : 'default'}
                    onClick={() => toggleManualAdjust()}
                  >
                    {manualAdjustMode ? '完成手工调整' : '手工调整'}
                  </Button>
                  <Button
                    size="small"
                    icon={<SaveOutlined />}
                    loading={savingReceivable || savingActual}
                    onClick={() => void saveCommissionDrafts()}
                  >
                    保存应收/实收
                  </Button>
                </>
              )}
              {canEditPayout && (
                <Button
                  size="small"
                  icon={<SaveOutlined />}
                  loading={savingPayout}
                  onClick={() => void savePayoutInfo()}
                >
                  保存收款信息
                </Button>
              )}
            </Space>
          )}
        </div>
        <div className="sr-section-body">
          <Spin spinning={loading}>
            {isAdmin && scopeUserId == null && (
              <Alert
                type="info"
                showIcon
                style={{ margin: '12px 16px 0' }}
                message="全公司视图"
                description="各列应收/实收来自各员工已同步或保存的数据。按员工同步时请先在上方选择该员工，或在此视图使用「同步打款数据 → 全部平台」。"
              />
            )}
            {!cols.length ? (
              <Empty description="暂无平台账号" style={{ padding: 24 }} />
            ) : (
              <div className="sr-table-wrap">
                <table className="sr-table sr-matrix">
                  <thead>
                    <tr>
                      <th colSpan={2} className="sr-head-side sr-sticky-left">
                        广告联盟
                      </th>
                      {cols.map((c) => (
                        <th key={c.key} colSpan={2} className="sr-channel-head">
                          {c.label}
                        </th>
                      ))}
                      <th colSpan={2} rowSpan={2} className="sr-total-col sr-sticky-right sr-total-head">
                        <div className="sr-total-head-stack">
                          <span>佣金合计</span>
                          <span className="sr-total-head-cur">
                            <span className="sr-cur-usd">$</span>
                            <span className="sr-cur-cny"> / ¥</span>
                          </span>
                        </div>
                      </th>
                    </tr>
                    <tr>
                      <th colSpan={2} className="sr-head-side sr-sticky-left">
                        账号名称
                      </th>
                      {cols.map((c) => (
                        <th key={`${c.key}-acc`} colSpan={2} className="sr-channel-sub">
                          <div className="sr-account-hint">{c.accountHint || c.platformName || '—'}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td colSpan={2} className="sr-label sr-sticky-left">
                        账期佣金 (美金)
                      </td>
                      {renderMatrixMoneyCells('book', 'singleUsd')}
                    </tr>
                    <tr>
                      <td colSpan={2} className="sr-label sr-sticky-left">
                        失效佣金 (美金)
                      </td>
                      {renderMatrixMoneyCells('rejected', 'singleUsd')}
                    </tr>
                    <tr>
                      <td rowSpan={3} className="sr-group sr-sticky-left">
                        应收佣金
                        <br />
                        (美金)
                      </td>
                      <td className="sr-sublabel sr-sticky-sub">5号 · 上半月</td>
                      {renderMatrixMoneyCells('recv_h1', 'singleUsd', 'h1', 'receivable')}
                    </tr>
                    <tr>
                      <td className="sr-sublabel sr-sticky-sub">15号 · 下半月</td>
                      {renderMatrixMoneyCells('recv_h2', 'singleUsd', 'h2', 'receivable')}
                    </tr>
                    <tr>
                      <td className="sr-sublabel sr-sticky-sub">合计</td>
                      {renderMatrixMoneyCells('recv_total', 'singleUsd', undefined, 'receivable')}
                    </tr>
                    <tr className="sr-currency-head-row">
                      <td rowSpan={4} className="sr-group sr-sticky-left">
                        实收佣金
                        <div className="sr-sub">点击单元格手工纠正</div>
                      </td>
                      <td className="sr-sublabel sr-sticky-sub sr-currency-head-gap" />
                      {renderActualCurrencyHeaderCells()}
                    </tr>
                    <tr>
                      <td className="sr-sublabel sr-sticky-sub">10号 · 上半月</td>
                      {renderMatrixMoneyCells('actual_h1', 'usdCny', 'h1', 'actual')}
                    </tr>
                    <tr>
                      <td className="sr-sublabel sr-sticky-sub">20号 · 下半月</td>
                      {renderMatrixMoneyCells('actual_h2', 'usdCny', 'h2', 'actual')}
                    </tr>
                    <tr>
                      <td className="sr-sublabel sr-sticky-sub">合计</td>
                      {renderMatrixMoneyCells('actual_total', 'usdCny', undefined, 'actual')}
                    </tr>
                    <tr>
                      <td colSpan={2} className="sr-label sr-sticky-left">
                        收款人
                      </td>
                      {renderTextCells('payeeName')}
                    </tr>
                    <tr>
                      <td colSpan={2} className="sr-label sr-sticky-left">
                        收款卡号
                      </td>
                      {renderTextCells('bankAccount')}
                    </tr>
                    <tr className="sr-profit-row">
                      <td colSpan={2} className="sr-label sr-sticky-left">
                        可分配利润
                        <div className="sr-profit-sub">实收佣金 − 推广服务费</div>
                      </td>
                      {cols.map((c) => (
                        <td key={`profit-${c.key}`} colSpan={2} />
                      ))}
                      <td
                        colSpan={2}
                        align="right"
                        className="sr-total-col sr-sticky-right sr-total-stack sr-profit-total"
                      >
                        <span className={`sr-money-usd ${profitClass(distributableActualUsd)}`}>
                          {fmtUsd(distributableActualUsd)}
                        </span>
                        <span className={`sr-money-cny ${profitClass(distributableActualCny)}`}>
                          {fmtCny(distributableActualUsd, rate)}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Spin>
          <p className="sr-tip">
            账期/失效来自订单同步。应收/实收：鼠标悬停 USD 单元格出现铅笔与恢复图标，点击改数（蓝底为已手填）。
            改完点「保存应收/实收」。实收列 USD/CNY；账期/应收仅美金。CNY 按页头汇率。收款人见{' '}
            <Link to="/channel-accounts">平台账号</Link>。
          </p>
        </div>
      </div>
    </div>
  );
}
