import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  DatePicker,
  Empty,
  InputNumber,
  Select,
  Space,
  Spin,
  message,
} from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { DownloadOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { api, type ApiResult } from '../../api/client';
import { exportSettlementMonthlyExcel } from '../../utils/exportSettlementMonthly';
import './settlement-report.css';

export interface SettlementMonthlyAdSpendRow {
  mccLabel: string;
  currency: string;
  librarySpendUsd: number;
  adjustmentUsd: number;
  spendUsd: number;
}

export interface SettlementMonthlyColumn {
  key: string;
  label: string;
  platformName: string;
  accountHint: string;
}

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
  adSpendRows: SettlementMonthlyAdSpendRow[];
  adSpendTotalUsd: number;
  activeCampaignCount: number;
  columns: SettlementMonthlyColumn[];
  matrixRows: SettlementMonthlyMatrixRow[];
  distributableProfitBookUsd: number;
  distributableProfitBookCny: number;
  actualCommissionTotalUsd: number;
  canEditActualCommission: boolean;
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

type ActualHalfDraft = Record<string, { usdH1: number; usdH2: number }>;

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
  const [actualDraft, setActualDraft] = useState<ActualHalfDraft>({});
  const [savingActual, setSavingActual] = useState(false);

  const monthStr = month.format('YYYY-MM');

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { month: monthStr };
      if (effectiveScopeUserId != null) {
        params.userId = String(effectiveScopeUserId);
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
    const h1 = report.matrixRows.find((r) => r.rowKey === 'actual_h1')?.values ?? {};
    const h2 = report.matrixRows.find((r) => r.rowKey === 'actual_h2')?.values ?? {};
    const draft: ActualHalfDraft = {};
    for (const c of report.columns) {
      draft[c.key] = { usdH1: h1[c.key] ?? 0, usdH2: h2[c.key] ?? 0 };
    }
    setActualDraft(draft);
  }, [report]);

  const rate = report?.usdCnyRate ?? 7.25;
  const canEdit = report?.canEditActualCommission ?? false;
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

  const distributableActualUsd = (report?.adSpendTotalUsd ?? 0) * -1 + actualTotalUsd;
  const distributableActualCny = distributableActualUsd * rate;

  const saveActual = async () => {
    if (!report?.canEditActualCommission) return;
    setSavingActual(true);
    try {
      const halfValues: ActualHalfDraft = {};
      for (const c of report.columns) {
        halfValues[c.key] = actualDraft[c.key] ?? { usdH1: 0, usdH2: 0 };
      }
      const body: { month: string; halfValues: ActualHalfDraft; userId?: string } = {
        month: monthStr,
        halfValues,
      };
      if (effectiveScopeUserId != null) {
        body.userId = String(effectiveScopeUserId);
      }
      const { data } = await api.put<ApiResult<{ halfValues: ActualHalfDraft }>>(
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
      adSpendRows: report.adSpendRows.map((r) => ({
        mccLabel: r.mccLabel,
        currency: r.currency,
        spendUsd: r.spendUsd,
      })),
      adSpendTotalUsd: report.adSpendTotalUsd,
      columns: report.columns,
      matrixRows: report.matrixRows.filter((r) => r.rowType === 'money'),
      distributableProfitBookUsd: report.distributableProfitBookUsd,
      distributableProfitBookCny: report.distributableProfitBookCny,
    });
  };

  const cellUsd = (rowKey: string, colKey: string) => {
    if (rowKey === 'actual_total' && canEdit) {
      return (actualDraft[colKey]?.usdH1 ?? 0) + (actualDraft[colKey]?.usdH2 ?? 0);
    }
    return rowMap.get(rowKey)?.values[colKey] ?? 0;
  };

  const rowTotal = (rowKey: string) => {
    if (canEdit && rowKey === 'actual_h1') {
      return Object.values(actualDraft).reduce((s, h) => s + h.usdH1, 0);
    }
    if (canEdit && rowKey === 'actual_h2') {
      return Object.values(actualDraft).reduce((s, h) => s + h.usdH2, 0);
    }
    if (canEdit && rowKey === 'actual_total') {
      return actualTotalUsd;
    }
    return rowMap.get(rowKey)?.totalUsd ?? 0;
  };

  const renderMoneyCells = (rowKey: string, editableHalf?: 'h1' | 'h2') => {
    return (
      <>
        {cols.map((c) => {
          const usd = cellUsd(rowKey, c.key);
          const isEdit = editableHalf && canEdit;
          return (
            <Fragment key={c.key}>
              <td align="right" className={isEdit ? 'sr-cell-editable' : undefined}>
                {isEdit ? (
                  <InputNumber
                    min={0}
                    step={0.01}
                    precision={2}
                    size="small"
                    value={actualDraft[c.key]?.[editableHalf === 'h1' ? 'usdH1' : 'usdH2'] ?? 0}
                    onChange={(v) =>
                      setActualDraft((prev) => ({
                        ...prev,
                        [c.key]: {
                          usdH1: prev[c.key]?.usdH1 ?? 0,
                          usdH2: prev[c.key]?.usdH2 ?? 0,
                          [editableHalf === 'h1' ? 'usdH1' : 'usdH2']:
                            typeof v === 'number' ? v : 0,
                        },
                      }))
                    }
                    style={{ width: '100%' }}
                  />
                ) : (
                  <span className="sr-money-usd">{fmtUsd(usd)}</span>
                )}
              </td>
              <td align="right" className={isEdit ? 'sr-cell-editable' : undefined}>
                <span className="sr-money-cny">
                  {fmtCny(
                    isEdit
                      ? (actualDraft[c.key]?.[editableHalf === 'h1' ? 'usdH1' : 'usdH2'] ?? 0)
                      : usd,
                    rate,
                  )}
                </span>
              </td>
            </Fragment>
          );
        })}
        <td align="right" className="sr-total-col">
          <span className="sr-money-usd">{fmtUsd(rowTotal(rowKey))}</span>
        </td>
        <td align="right" className="sr-total-col">
          <span className="sr-money-cny">{fmtCny(rowTotal(rowKey), rate)}</span>
        </td>
      </>
    );
  };

  const renderTextCells = (rowKey: string) => (
    <>
      {cols.map((c) => (
        <td key={c.key} colSpan={2}>
          {rowMap.get(rowKey)?.textValues?.[c.key] || '—'}
        </td>
      ))}
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
          <Button icon={<ReloadOutlined />} onClick={() => void loadReport()} loading={loading}>
            刷新
          </Button>
          <Button type="primary" icon={<DownloadOutlined />} onClick={handleExport} disabled={!report}>
            导出 Excel
          </Button>
        </Space>
      </div>

      {report && <div className="sr-rate-bar">{report.rateNote}</div>}

      <div className="sr-section">
        <div className="sr-section-head">
          <h3>广告费</h3>
        </div>
        <div className="sr-section-body">
          <Spin spinning={loading}>
            <div className="sr-table-wrap">
              <table className="sr-table">
                <thead>
                  <tr>
                    <th>MCC</th>
                    <th>币种</th>
                    <th>库内广告费(原币)</th>
                    <th>补充金额($)</th>
                    <th>广告费(原币,可改)</th>
                    <th>折美金($)</th>
                  </tr>
                </thead>
                <tbody>
                  {(report?.adSpendRows ?? []).map((r) => (
                    <tr key={r.mccLabel}>
                      <td className="sr-mcc-name">{r.mccLabel}</td>
                      <td>{r.currency === 'USD' ? '美金' : r.currency}</td>
                      <td align="right">
                        <span className="sr-money-usd">{fmtUsd(r.librarySpendUsd)}</span>
                      </td>
                      <td align="right">
                        <span className="sr-money-usd">{fmtUsd(r.adjustmentUsd)}</span>
                      </td>
                      <td align="right">
                        <span className="sr-money-usd">{fmtUsd(r.spendUsd)}</span>
                      </td>
                      <td align="right">
                        <span className="sr-money-usd">{fmtUsd(r.spendUsd)}</span>
                      </td>
                    </tr>
                  ))}
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
                      <td colSpan={2}>总广告费（$）</td>
                      <td align="right">{fmtUsd(report.adSpendTotalUsd)}</td>
                      <td>应返广告费($)</td>
                      <td align="right">{fmtUsd(0)}</td>
                      <td align="center">在跑广告数：{report.activeCampaignCount}</td>
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
          {canEdit && (
            <Button
              type="primary"
              size="small"
              icon={<SaveOutlined />}
              loading={savingActual}
              onClick={() => void saveActual()}
            >
              保存实收佣金
            </Button>
          )}
        </div>
        <div className="sr-section-body">
          <Spin spinning={loading}>
            {!cols.length ? (
              <Empty description="暂无平台账号" style={{ padding: 24 }} />
            ) : (
              <div className="sr-table-wrap">
                <table className="sr-table sr-matrix">
                  <thead>
                    <tr>
                      <th colSpan={2} rowSpan={2} className="sr-label">
                        项目
                      </th>
                      {cols.map((c) => (
                        <th key={c.key} colSpan={2} className="sr-channel-head">
                          {c.label}
                        </th>
                      ))}
                      <th colSpan={2} rowSpan={2} className="sr-total-col">
                        佣金合计
                      </th>
                    </tr>
                    <tr>
                      {cols.map((c) => (
                        <th key={`${c.key}-acc`} colSpan={2}>
                          <div className="sr-sub">账号名称</div>
                          <div className="sr-account-hint">{c.accountHint || '—'}</div>
                        </th>
                      ))}
                    </tr>
                    <tr>
                      <th colSpan={2} className="sr-label" />
                      {cols.map((c) => (
                        <Fragment key={c.key}>
                          <th>USD</th>
                          <th>CNY</th>
                        </Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td colSpan={2} className="sr-label">
                        账期佣金 ($)
                      </td>
                      {renderMoneyCells('book')}
                    </tr>
                    <tr>
                      <td colSpan={2} className="sr-label">
                        失效佣金 ($)
                      </td>
                      {renderMoneyCells('rejected')}
                    </tr>
                    <tr>
                      <td rowSpan={3} className="sr-group">
                        应收佣金
                        <br />
                        (美金)
                      </td>
                      <td className="sr-sublabel">5日·上半月(1–15)</td>
                      {renderMoneyCells('recv_h1')}
                    </tr>
                    <tr>
                      <td className="sr-sublabel">15日·下半月(16–末)</td>
                      {renderMoneyCells('recv_h2')}
                    </tr>
                    <tr>
                      <td className="sr-sublabel">合计</td>
                      {renderMoneyCells('recv_total')}
                    </tr>
                    <tr>
                      <td rowSpan={3} className="sr-group">
                        实收佣金
                      </td>
                      <td className="sr-sublabel">10日·上半月</td>
                      {renderMoneyCells('actual_h1', 'h1')}
                    </tr>
                    <tr>
                      <td className="sr-sublabel">20日·下半月</td>
                      {renderMoneyCells('actual_h2', 'h2')}
                    </tr>
                    <tr>
                      <td className="sr-sublabel">合计</td>
                      {renderMoneyCells('actual_total')}
                    </tr>
                    <tr>
                      <td colSpan={2} className="sr-label">
                        收款人
                      </td>
                      {renderTextCells('payee')}
                    </tr>
                    <tr>
                      <td colSpan={2} className="sr-label">
                        收款卡号
                      </td>
                      {renderTextCells('bank')}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Spin>
          <p className="sr-tip" style={{ padding: '8px 16px 12px' }}>
            实收佣金为手工录入，保存后刷新仍保留；CNY 按页头汇率自动折算。收款人/卡号后续可在员工资料中维护。
          </p>
        </div>
      </div>

      {report && (
        <div className="sr-profit-bar">
          <div className="sr-profit-item">
            <div className="sr-profit-label">实收佣金合计 (USD)</div>
            <div className={`sr-profit-value ${profitClass(actualTotalUsd)}`}>
              {fmtUsd(canEdit ? actualTotalUsd : report.actualCommissionTotalUsd)}
            </div>
          </div>
          <div className="sr-profit-item sr-profit-main">
            <div className="sr-profit-label">可分配利润（实收 − 总广告费, USD）</div>
            <div className={`sr-profit-value ${profitClass(distributableActualUsd)}`}>
              {fmtUsd(distributableActualUsd)}
            </div>
          </div>
          <div className="sr-profit-item sr-profit-main">
            <div className="sr-profit-label">可分配利润（CNY）</div>
            <div className={`sr-profit-value ${profitClass(distributableActualCny)}`}>
              {fmtCny(distributableActualUsd, rate)}
            </div>
          </div>
          <div className="sr-profit-item">
            <div className="sr-profit-label">参考 · 账面 − 广告费 (USD)</div>
            <div className={`sr-profit-value ${profitClass(report.distributableProfitBookUsd)}`}>
              {fmtUsd(report.distributableProfitBookUsd)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
