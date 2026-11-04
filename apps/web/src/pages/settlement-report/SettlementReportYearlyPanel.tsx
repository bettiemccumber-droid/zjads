import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Empty,
  Select,
  Space,
  Statistic,
  Table,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { api, type ApiResult } from '../../api/client';
import { exportSettlementYearlyExcel } from '../../utils/exportSettlementYearly';

interface SettlementMonthlyAdSpendRow {
  mccLabel: string;
  currency: string;
  spendUsd: number;
}

interface SettlementMonthlyColumn {
  key: string;
  label: string;
  platformName: string;
  platformCode: string;
}

interface SettlementMonthlyMatrixRow {
  rowKey: string;
  label: string;
  values: Record<string, number>;
  totalUsd: number;
}

interface SettlementYearlyMonthRow {
  month: string;
  adSpendUsd: number;
  bookCommissionUsd: number;
  rejectedCommissionUsd: number;
  receivableCommissionUsd: number;
  distributableProfitUsd: number;
}

interface SettlementYearlyReport {
  year: string;
  usdCnyRate: number;
  rateNote: string;
  notes: string[];
  monthlyRows: SettlementYearlyMonthRow[];
  yearTotal: SettlementYearlyMonthRow;
  adSpendRows: SettlementMonthlyAdSpendRow[];
  adSpendTotalUsd: number;
  columns: SettlementMonthlyColumn[];
  matrixRows: SettlementMonthlyMatrixRow[];
  distributableProfitBookUsd: number;
  distributableProfitBookCny: number;
}

interface EmployeeOption {
  id: number;
  username: string;
}

export interface SettlementReportYearlyPanelProps {
  isAdmin: boolean;
  effectiveScopeUserId: number | null;
  employees: EmployeeOption[];
  onScopeChange: (userId: number | null) => void;
  scopeUserId: number | null;
}

function moneyUsd(v: number) {
  return `$${Number(v).toFixed(2)}`;
}

function moneyCny(v: number, rate: number) {
  return `¥${(Number(v) * rate).toFixed(2)}`;
}

function monthLabel(month: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  return m ? `${Number(m[2])} 月` : month;
}

/**
 * 结算报表 · 年度 Tab
 */
export default function SettlementReportYearlyPanel({
  isAdmin,
  effectiveScopeUserId,
  employees,
  onScopeChange,
  scopeUserId,
}: SettlementReportYearlyPanelProps) {
  const [year, setYear] = useState<Dayjs>(() => dayjs().startOf('year'));
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<SettlementYearlyReport | null>(null);

  const yearStr = year.format('YYYY');

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { year: yearStr };
      if (effectiveScopeUserId != null) {
        params.userId = String(effectiveScopeUserId);
      }
      const { data } = await api.get<ApiResult<SettlementYearlyReport>>('/reports/settlement-yearly', {
        params,
      });
      if (!data.success) {
        message.error(data.message || '加载失败');
        return;
      }
      setReport(data.data);
    } catch {
      message.error('加载年度报表失败');
    } finally {
      setLoading(false);
    }
  }, [yearStr, effectiveScopeUserId]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const trendColumns: ColumnsType<SettlementYearlyMonthRow> = [
    {
      title: '月份',
      dataIndex: 'month',
      key: 'month',
      render: (m: string) => monthLabel(m),
    },
    {
      title: '广告费 (USD)',
      dataIndex: 'adSpendUsd',
      key: 'adSpendUsd',
      align: 'right',
      render: moneyUsd,
    },
    {
      title: '账面佣金 (USD)',
      dataIndex: 'bookCommissionUsd',
      key: 'bookCommissionUsd',
      align: 'right',
      render: moneyUsd,
    },
    {
      title: '失效佣金 (USD)',
      dataIndex: 'rejectedCommissionUsd',
      key: 'rejectedCommissionUsd',
      align: 'right',
      render: moneyUsd,
    },
    {
      title: '应收佣金 (USD)',
      dataIndex: 'receivableCommissionUsd',
      key: 'receivableCommissionUsd',
      align: 'right',
      render: moneyUsd,
    },
    {
      title: '可分配利润 (USD)',
      dataIndex: 'distributableProfitUsd',
      key: 'distributableProfitUsd',
      align: 'right',
      render: (v: number) => <Typography.Text strong>{moneyUsd(v)}</Typography.Text>,
    },
  ];

  const adColumns: ColumnsType<SettlementMonthlyAdSpendRow> = [
    { title: 'MCC / 数据源', dataIndex: 'mccLabel', key: 'mccLabel' },
    { title: '币种', dataIndex: 'currency', key: 'currency', width: 80 },
    {
      title: '年度广告费 (USD)',
      dataIndex: 'spendUsd',
      key: 'spendUsd',
      align: 'right',
      render: moneyUsd,
    },
  ];

  const matrixColumns: ColumnsType<SettlementMonthlyMatrixRow> = useMemo(() => {
    const cols = report?.columns ?? [];
    const rate = report?.usdCnyRate ?? 7.25;
    const dynamic: ColumnsType<SettlementMonthlyMatrixRow> = cols.map((c) => ({
      title: (
        <span title={`${c.platformName} (${c.platformCode})`}>
          {c.label}
          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
            USD / CNY
          </Typography.Text>
        </span>
      ),
      key: c.key,
      align: 'right' as const,
      width: 120,
      render: (_: unknown, row: SettlementMonthlyMatrixRow) => {
        const usd = row.values[c.key] ?? 0;
        return (
          <div>
            <div>{moneyUsd(usd)}</div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {moneyCny(usd, rate)}
            </Typography.Text>
          </div>
        );
      },
    }));
    return [
      { title: '项目', dataIndex: 'label', key: 'label', fixed: 'left', width: 200 },
      ...dynamic,
      {
        title: '合计 (USD)',
        dataIndex: 'totalUsd',
        key: 'totalUsd',
        fixed: 'right',
        width: 110,
        align: 'right',
        render: (v: number) => <Typography.Text strong>{moneyUsd(v)}</Typography.Text>,
      },
    ];
  }, [report?.columns, report?.usdCnyRate]);

  const handleExport = () => {
    if (!report) return;
    exportSettlementYearlyExcel({
      year: report.year,
      month: report.year,
      usdCnyRate: report.usdCnyRate,
      rateNote: report.rateNote,
      monthlyRows: report.monthlyRows,
      adSpendRows: report.adSpendRows,
      adSpendTotalUsd: report.adSpendTotalUsd,
      columns: report.columns,
      matrixRows: report.matrixRows,
      distributableProfitBookUsd: report.distributableProfitBookUsd,
      distributableProfitBookCny: report.distributableProfitBookCny,
    });
  };

  const trendData = report?.monthlyRows ?? [];

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space wrap>
        <DatePicker picker="year" value={year} onChange={(v) => v && setYear(v)} allowClear={false} />
        {isAdmin && (
          <Select
            style={{ minWidth: 200 }}
            placeholder="数据范围"
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

      {report && (
        <Alert type="info" showIcon message={report.rateNote} description={report.notes.join(' ')} />
      )}

      <Card title="月度趋势" size="small">
        <Table
          rowKey="month"
          size="small"
          loading={loading}
          columns={trendColumns}
          dataSource={trendData}
          pagination={false}
          summary={() =>
            report?.yearTotal ? (
              <Table.Summary.Row style={{ background: '#f6ffed' }}>
                <Table.Summary.Cell index={0}>
                  <Typography.Text strong>年度合计</Typography.Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">
                  <Typography.Text strong>{moneyUsd(report.yearTotal.adSpendUsd)}</Typography.Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="right">
                  {moneyUsd(report.yearTotal.bookCommissionUsd)}
                </Table.Summary.Cell>
                <Table.Summary.Cell index={3} align="right">
                  {moneyUsd(report.yearTotal.rejectedCommissionUsd)}
                </Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="right">
                  {moneyUsd(report.yearTotal.receivableCommissionUsd)}
                </Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="right">
                  <Typography.Text strong>
                    {moneyUsd(report.yearTotal.distributableProfitUsd)}
                  </Typography.Text>
                </Table.Summary.Cell>
              </Table.Summary.Row>
            ) : null
          }
        />
      </Card>

      <Card title="广告费 (MCC · 年度)" size="small">
        <Table
          rowKey={(r) => r.mccLabel}
          size="small"
          loading={loading}
          columns={adColumns}
          dataSource={report?.adSpendRows ?? []}
          pagination={false}
          locale={{ emptyText: <Empty description="暂无广告数据源或当年无花费" /> }}
          summary={() =>
            report ? (
              <Table.Summary.Row style={{ background: '#f6ffed' }}>
                <Table.Summary.Cell index={0}>
                  <Typography.Text strong>合计</Typography.Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} />
                <Table.Summary.Cell index={2} align="right">
                  <Typography.Text strong>{moneyUsd(report.adSpendTotalUsd)}</Typography.Text>
                </Table.Summary.Cell>
              </Table.Summary.Row>
            ) : null
          }
        />
      </Card>

      <Card title="佣金明细 (整年)" size="small">
        <Table
          rowKey="rowKey"
          size="small"
          loading={loading}
          columns={matrixColumns}
          dataSource={report?.matrixRows ?? []}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: <Empty description="暂无平台账号或当年无订单" /> }}
        />
      </Card>

      {report && (
        <Space size="large">
          <Statistic
            title="可分配利润 (账面 − 广告费, USD)"
            value={report.distributableProfitBookUsd}
            precision={2}
            prefix="$"
          />
          <Statistic
            title="可分配利润 (CNY)"
            value={report.distributableProfitBookCny}
            precision={2}
            prefix="¥"
          />
        </Space>
      )}
    </Space>
  );
}
