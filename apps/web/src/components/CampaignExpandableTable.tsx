import { useMemo, useState } from 'react';
import { EditOutlined, EyeOutlined } from '@ant-design/icons';
import { Button, Input, Modal, Popover, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { isEnabledCampaignStatus } from '../utils/campaign-status';
import './CampaignExpandableTable.css';

/** 主表列宽合计 + 展开列留白 */
export const CAMPAIGN_MAIN_SCROLL_X = 1600;

/** 按天子表列宽合计 */
export const CAMPAIGN_DAILY_SCROLL_X = 1176;

export interface CampaignDailyRow {
  date: string;
  campaignGroupKey?: string;
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
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

export interface CampaignSummaryRow {
  rank: number;
  campaignGroupKey?: string;
  campaignId: string;
  campaignName: string;
  campaignStatus?: string;
  affiliateAlias: string;
  merchantId: string;
  /** 曾投放过的 Google 子账号（换号时综合展示） */
  linkedCustomerIds?: string[];
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
  daily: CampaignDailyRow[];
}

function roiColor(v: number) {
  if (v >= 1) return '#16a34a';
  if (v >= 0) return '#ca8a04';
  return '#dc2626';
}

function calcCr(orderCount: number, clicks: number) {
  return clicks > 0 ? (orderCount / clicks) * 100 : 0;
}

function formatDayLabel(dateStr: string) {
  const parts = dateStr.split('-');
  if (parts.length >= 3) return `${parts[1]}-${parts[2]}`;
  return dateStr;
}

function campaignKey(row: {
  campaignGroupKey?: string;
  campaignId: string;
  campaignName: string;
}) {
  return row.campaignGroupKey || `${row.campaignId}|${row.campaignName}`;
}

/** 将每日明细挂到对应广告系列行 */
export function attachDailyToCampaigns(
  campaigns: Omit<CampaignSummaryRow, 'daily'>[],
  dailyRows: CampaignDailyRow[],
): CampaignSummaryRow[] {
  const dailyMap = new Map<string, CampaignDailyRow[]>();
  for (const d of dailyRows) {
    const key = campaignKey(d);
    if (!dailyMap.has(key)) dailyMap.set(key, []);
    dailyMap.get(key)!.push(d);
  }
  for (const list of dailyMap.values()) {
    list.sort((a, b) => b.date.localeCompare(a.date));
  }
  return campaigns.map((c) => ({
    ...c,
    daily: dailyMap.get(campaignKey(c)) ?? [],
  }));
}

function NumCell({
  value,
  tone = 'default',
}: {
  value: number;
  tone?: 'default' | 'accent' | 'affiliate';
}) {
  const cls =
    tone === 'accent'
      ? 'cell-num cell-num-accent'
      : tone === 'affiliate'
        ? 'cell-num cell-num-affiliate'
        : 'cell-num';
  return <span className={cls}>{(value ?? 0).toLocaleString('en-US')}</span>;
}

function MoneyCell({
  value,
  variant = 'default',
  kpi = false,
}: {
  value: number;
  variant?: 'default' | 'cost' | 'commission';
  /** 核心指标列：广告费 / 佣金 */
  kpi?: boolean;
}) {
  const cls = [
    'cell-money',
    variant === 'commission' ? 'cell-money-commission' : '',
    variant === 'cost' ? 'cell-money-cost' : '',
    kpi ? 'cell-kpi-value' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return <span className={cls}>${Number(value ?? 0).toFixed(2)}</span>;
}

function RoiCell({ value, size = 'main' }: { value: number; size?: 'main' | 'daily' }) {
  const v = Number(value ?? 0);
  const tier = v >= 1 ? 'high' : v >= 0 ? 'mid' : 'low';
  const cls =
    size === 'main' ? `cell-roi-pill cell-roi-pill--main cell-roi-pill--${tier}` : `cell-roi-pill cell-roi-pill--daily cell-roi-pill--${tier}`;
  return (
    <span className={cls} style={{ color: roiColor(v) }}>
      {v.toFixed(2)}
    </span>
  );
}

/** 核心指标列：表头与单元格背景强调 */
function kpiColumn(kind: 'cost' | 'commission' | 'roi') {
  const cls = `col-kpi col-kpi-${kind}`;
  return {
    className: cls,
    onHeaderCell: () => ({ className: cls }),
    onCell: () => ({ className: cls }),
  };
}

function pct(v: number) {
  return <span className="cell-metric-warn">{(v ?? 0).toFixed(2)}%</span>;
}

function suggestionStatusClass(text: string) {
  if (!text) return '';
  if (text === '维持现状') return 'status-keep';
  if (text.includes('暂停')) return 'status-pause';
  return 'status-watch';
}

/**
 * 操作建议列：状态文案 + 编辑 + 查看（对齐参考表）
 */
function OperationSuggestionCell({ row }: { row: CampaignSummaryRow }) {
  const text = row.operationSuggestion || '';
  const [editOpen, setEditOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [userNote, setUserNote] = useState('');
  const [savedNote, setSavedNote] = useState('');

  const detailContent = (
    <div className="operation-suggestion-popover">
      <Typography.Text strong>建议依据</Typography.Text>
      <ul className="operation-suggestion-facts">
        <li>
          ROI：<strong>{row.roi.toFixed(2)}</strong>（佣金 ${row.commission.toFixed(2)} / 花费 $
          {row.cost.toFixed(2)}）
        </li>
        <li>
          订单：<strong>{row.orderCount}</strong>，MCC 点击：<strong>{row.clicks}</strong>，联盟点击：
          <strong>{row.affiliateClicks ?? 0}</strong>
        </li>
        <li>系统建议：<strong>{text || '—'}</strong></li>
        {savedNote ? <li>备注：{savedNote}</li> : null}
      </ul>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
        复核后可调整预算与 CPC；执行调整需在 Google Ads 或 Sheet 流程中操作。
      </Typography.Paragraph>
    </div>
  );

  const handleSaveNote = () => {
    setSavedNote(userNote.trim());
    setEditOpen(false);
  };

  return (
    <>
      <div className="operation-suggestion-cell">
        <div className="operation-suggestion-body">
          <div className="operation-suggestion-left">
            <div className={`operation-suggestion-status ${suggestionStatusClass(text)}`}>
              {text || '—'}
            </div>
            <Button
              type="link"
              size="small"
              className="operation-edit-link"
              icon={<EditOutlined />}
              onClick={() => {
                setUserNote(savedNote);
                setEditOpen(true);
              }}
            >
              编辑
            </Button>
          </div>
          <Popover
            open={viewOpen}
            onOpenChange={setViewOpen}
            trigger="click"
            placement="leftTop"
            content={detailContent}
            title="操作建议详情"
          >
            <Button
              type="text"
              size="small"
              className="operation-view-btn"
              icon={<EyeOutlined />}
              aria-label="查看建议"
            />
          </Popover>
        </div>
        {savedNote ? (
          <div className="operation-suggestion-note" title={savedNote}>
            {savedNote}
          </div>
        ) : null}
      </div>

      <Modal
        title="编辑操作建议"
        open={editOpen}
        onOk={handleSaveNote}
        onCancel={() => setEditOpen(false)}
        okText="保存备注"
        cancelText="取消"
        destroyOnClose
        width={400}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <Typography.Text type="secondary">广告系列</Typography.Text>
            <div>{row.campaignName}</div>
          </div>
          <div>
            <Typography.Text type="secondary">系统建议</Typography.Text>
            <div>
              <Typography.Text strong>{text || '—'}</Typography.Text>
            </div>
          </div>
          <div>
            <Typography.Text type="secondary">我的备注（仅本页会话）</Typography.Text>
            <Input.TextArea
              rows={3}
              placeholder="记录复核结论，如：维持预算、下调 CPC 等"
              value={userNote}
              onChange={(e) => setUserNote(e.target.value)}
            />
          </div>
        </Space>
      </Modal>
    </>
  );
}

/** 按天明细合计 */
function sumDailyRows(days: CampaignDailyRow[]) {
  const acc = {
    dailyBudget: 0,
    impressions: 0,
    clicks: 0,
    cost: 0,
    orderCount: 0,
    commission: 0,
    affiliateClicks: 0,
    weightedBgt: 0,
    weightedRnk: 0,
  };
  for (const d of days) {
    acc.dailyBudget = Math.max(acc.dailyBudget, d.dailyBudget);
    acc.impressions += d.impressions;
    acc.clicks += d.clicks;
    acc.cost += d.cost;
    acc.orderCount += d.orderCount;
    acc.commission += d.commission;
    acc.affiliateClicks += d.affiliateClicks ?? 0;
    acc.weightedBgt += d.searchBudgetLostIs * d.impressions;
    acc.weightedRnk += d.searchRankLostIs * d.impressions;
  }
  const roi = acc.cost > 0 ? (acc.commission - acc.cost) / acc.cost : 0;
  const epc = acc.clicks > 0 ? acc.commission / acc.clicks : 0;
  const cpc = acc.clicks > 0 ? acc.cost / acc.clicks : 0;
  const cr = calcCr(acc.orderCount, acc.clicks);
  const isBgt = acc.impressions > 0 ? acc.weightedBgt / acc.impressions : 0;
  const isRnk = acc.impressions > 0 ? acc.weightedRnk / acc.impressions : 0;
  return { ...acc, roi, epc, cpc, cr, isBgt, isRnk };
}

interface CampaignExpandableTableProps {
  rows: CampaignSummaryRow[];
  loading?: boolean;
  /** 查询区间自然日数，用于提示 MCC 日数据是否不完整 */
  queryDayCount?: number;
  scroll?: { x?: number; y?: number };
  pagination?: false | {
    pageSize: number;
    showSizeChanger: boolean;
    pageSizeOptions: number[];
    showTotal: (total: number) => string;
    onShowSizeChange: (_: number, size: number) => void;
  };
  rowClassName?: (row: CampaignSummaryRow) => string;
}

/**
 * 广告系列表：主行区间汇总，展开后显示按天详细数据
 */
export default function CampaignExpandableTable({
  rows,
  loading,
  queryDayCount,
  scroll,
  pagination,
  rowClassName,
}: CampaignExpandableTableProps) {
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  const dailyColumns: ColumnsType<CampaignDailyRow> = useMemo(
    () => [
      {
        title: '日期',
        dataIndex: 'date',
        width: 64,
        align: 'center',
        render: (d: string) => <span className="cell-day">{formatDayLabel(d)}</span>,
      },
      {
        title: '预算',
        dataIndex: 'dailyBudget',
        width: 72,
        align: 'center',
        render: (v: number) => <MoneyCell value={v} />,
      },
      {
        title: '展示',
        dataIndex: 'impressions',
        width: 64,
        align: 'center',
        render: (v: number) => <NumCell value={v} />,
      },
      {
        title: 'MCC点击',
        dataIndex: 'clicks',
        width: 76,
        align: 'center',
        render: (v: number) => <NumCell value={v} />,
      },
      {
        title: '联盟点击',
        dataIndex: 'affiliateClicks',
        width: 76,
        align: 'center',
        render: (v: number) => <NumCell value={v ?? 0} tone="affiliate" />,
      },
      {
        title: '广告费',
        dataIndex: 'cost',
        width: 80,
        align: 'center',
        ...kpiColumn('cost'),
        render: (v: number) => <MoneyCell value={v} variant="cost" kpi />,
      },
      {
        title: '订单',
        dataIndex: 'orderCount',
        width: 56,
        align: 'center',
        render: (v: number) => <NumCell value={v} />,
      },
      {
        title: '佣金',
        dataIndex: 'commission',
        width: 84,
        align: 'center',
        ...kpiColumn('commission'),
        render: (v: number) => <MoneyCell value={v} variant="commission" kpi />,
      },
      {
        title: 'CR',
        width: 64,
        align: 'center',
        render: (_, r) => {
          const cr = calcCr(r.orderCount, r.clicks);
          return r.clicks > 0 ? (
            <span className="cell-metric-muted">{cr.toFixed(2)}%</span>
          ) : (
            '—'
          );
        },
      },
      {
        title: 'EPC',
        dataIndex: 'epc',
        width: 64,
        align: 'center',
        render: (v: number) => (
          <span className="cell-metric-muted">${Number(v).toFixed(2)}</span>
        ),
      },
      {
        title: 'CPC',
        dataIndex: 'avgCpc',
        width: 64,
        align: 'center',
        render: (v: number, r) => (
          <span className="cell-metric-muted">
            ${(r.clicks > 0 ? r.cost / r.clicks : v).toFixed(2)}
          </span>
        ),
      },
      {
        title: 'ROI',
        dataIndex: 'roi',
        width: 72,
        align: 'center',
        ...kpiColumn('roi'),
        render: (v: number) => <RoiCell value={v} size="daily" />,
      },
      {
        title: 'IS_Bgt',
        dataIndex: 'searchBudgetLostIs',
        width: 72,
        align: 'center',
        render: (v: number) => pct(v),
      },
      {
        title: 'IS_Rnk',
        dataIndex: 'searchRankLostIs',
        width: 72,
        align: 'center',
        render: (v: number) => pct(v),
      },
    ],
    [],
  );

  const columns: ColumnsType<CampaignSummaryRow> = useMemo(
    () => [
      {
        title: '排名',
        dataIndex: 'rank',
        width: 52,
        align: 'center',
        render: (v: number) => <span className="cell-rank">{v}</span>,
      },
      {
        title: '广告系列',
        dataIndex: 'campaignName',
        width: 280,
        ellipsis: true,
        render: (name: string, r) => {
          const linked = r.linkedCustomerIds?.filter(Boolean) ?? [];
          const multiAccount = linked.length > 1;
          return (
          <div className="campaign-name-cell">
            <span
              className={`campaign-status-dot ${isEnabledCampaignStatus(r.campaignStatus ?? '') ? 'on' : 'off'}`}
            />
            <span className="campaign-name-text" title={name}>
              {name}
            </span>
            {multiAccount ? (
              <span
                className="campaign-account-badge"
                title={`曾用 ${linked.length} 个 Google 子账号：${linked.join('、')}`}
              >
                {linked.length}账号
              </span>
            ) : null}
            {r.daily.length > 0 ? (
              <span className="campaign-day-badge">{r.daily.length}天</span>
            ) : null}
          </div>
          );
        },
      },
      {
        title: '商家ID',
        dataIndex: 'merchantId',
        width: 88,
        align: 'center',
        render: (v: string) => <span className="cell-merchant-id">{v || '—'}</span>,
      },
      {
        title: '预算',
        dataIndex: 'dailyBudget',
        width: 72,
        align: 'center',
        render: (v: number) => <MoneyCell value={v} />,
      },
      {
        title: '展示',
        dataIndex: 'impressions',
        width: 68,
        align: 'center',
        render: (v: number) => <NumCell value={v} />,
      },
      {
        title: 'MCC点击',
        dataIndex: 'clicks',
        width: 80,
        align: 'center',
        render: (v: number) => <NumCell value={v} />,
      },
      {
        title: '联盟点击',
        dataIndex: 'affiliateClicks',
        width: 80,
        align: 'center',
        render: (v: number) => <NumCell value={v ?? 0} tone="affiliate" />,
      },
      {
        title: '广告费',
        dataIndex: 'cost',
        width: 92,
        align: 'center',
        ...kpiColumn('cost'),
        render: (v: number) => <MoneyCell value={v} variant="cost" kpi />,
      },
      {
        title: '订单数',
        dataIndex: 'orderCount',
        width: 64,
        align: 'center',
        render: (v: number) => <NumCell value={v} />,
      },
      {
        title: '总佣金',
        dataIndex: 'commission',
        width: 96,
        align: 'center',
        ...kpiColumn('commission'),
        render: (v: number) => <MoneyCell value={v} variant="commission" kpi />,
      },
      {
        title: 'CR',
        width: 68,
        align: 'center',
        render: (_, r) => {
          const cr = calcCr(r.orderCount, r.clicks);
          return r.clicks > 0 ? (
            <span className="cell-metric-muted">{cr.toFixed(2)}%</span>
          ) : (
            '—'
          );
        },
      },
      {
        title: 'EPC',
        dataIndex: 'epc',
        width: 68,
        align: 'center',
        render: (v: number) => (
          <span className="cell-metric-muted">${Number(v).toFixed(2)}</span>
        ),
      },
      {
        title: 'CPC',
        dataIndex: 'avgCpc',
        width: 68,
        align: 'center',
        render: (v: number) => (
          <span className="cell-metric-muted">${Number(v).toFixed(2)}</span>
        ),
      },
      {
        title: 'ROI',
        dataIndex: 'roi',
        width: 88,
        align: 'center',
        ...kpiColumn('roi'),
        defaultSortOrder: 'descend',
        sorter: (a, b) => a.roi - b.roi,
        render: (v: number) => <RoiCell value={v} size="main" />,
      },
      {
        title: '操作建议',
        dataIndex: 'operationSuggestion',
        width: 128,
        align: 'left',
        className: 'operation-suggestion-td',
        onCell: () => ({ className: 'operation-suggestion-td' }),
        render: (_, row) => <OperationSuggestionCell row={row} />,
      },
    ],
    [],
  );

  return (
    <div className="campaign-report-wrap">
      <Table<CampaignSummaryRow>
        className="campaign-report-table"
        rowKey={(r) => campaignKey(r)}
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={scroll ?? { x: CAMPAIGN_MAIN_SCROLL_X }}
        pagination={pagination}
        tableLayout="fixed"
        rowClassName={(r) => {
          const key = campaignKey(r);
          const expanded = expandedKeys.includes(key);
          const extra = rowClassName?.(r) ?? '';
          return [expanded ? 'campaign-row-expanded' : '', extra].filter(Boolean).join(' ');
        }}
        expandable={{
          expandedRowKeys: expandedKeys,
          onExpandedRowsChange: (keys) => setExpandedKeys(keys as string[]),
          rowExpandable: (r) => r.daily.length > 0,
          expandRowByClick: false,
          expandedRowRender: (r) => {
            const tot = sumDailyRows(r.daily);
            const dailyCostGap =
              r.cost > 0 && tot.cost + 0.05 < r.cost
                ? Math.round((r.cost - tot.cost) * 100) / 100
                : 0;
            const likelyIncompleteMcc =
              queryDayCount != null &&
              queryDayCount > 1 &&
              r.daily.length > 0 &&
              r.daily.length < queryDayCount &&
              (r.orderCount > 0 || r.cost > 0);
            return (
              <div className="campaign-daily-panel">
                <div className="campaign-daily-panel-title">
                  按天详细数据（共 {r.daily.length} 天）
                </div>
                {likelyIncompleteMcc && (
                  <Typography.Paragraph type="warning" style={{ margin: '0 0 8px', fontSize: 12 }}>
                    MCC 日数据仅 {r.daily.length}/{queryDayCount} 天，与 Google 后台不一致时请在 Sheet
                    脚本跑完回溯窗口后重新导入。
                    {dailyCostGap > 0 ? ` 区间汇总比按天合计多约 $${dailyCostGap.toFixed(2)}。` : ''}
                  </Typography.Paragraph>
                )}
                <div className="campaign-daily-scroll">
                  <Table<CampaignDailyRow>
                    className="campaign-daily-inner-table"
                    rowKey={(d) => `${d.date}|${d.campaignId}`}
                    columns={dailyColumns}
                    dataSource={r.daily}
                    pagination={false}
                    size="small"
                    showHeader
                    bordered={false}
                    tableLayout="fixed"
                    scroll={{ x: CAMPAIGN_DAILY_SCROLL_X }}
                    summary={() => (
                      <Table.Summary>
                        <Table.Summary.Row className="campaign-daily-summary-row">
                          <Table.Summary.Cell index={0} align="center">
                            <span className="cell-day">合计</span>
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={1} align="center">
                            <MoneyCell value={tot.dailyBudget} />
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={2} align="center">
                            <NumCell value={tot.impressions} />
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={3} align="center">
                            <NumCell value={tot.clicks} tone="accent" />
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={4} align="center">
                            <NumCell value={tot.affiliateClicks} tone="affiliate" />
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={5} align="center" className="col-kpi col-kpi-cost">
                            <MoneyCell value={tot.cost} variant="cost" kpi />
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={6} align="center">
                            <NumCell value={tot.orderCount} />
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={7} align="center" className="col-kpi col-kpi-commission">
                            <MoneyCell value={tot.commission} variant="commission" kpi />
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={8} align="center">
                            {tot.clicks > 0 ? (
                              <span className="cell-metric-muted">{tot.cr.toFixed(2)}%</span>
                            ) : (
                              '—'
                            )}
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={9} align="center">
                            <span className="cell-metric-muted">${tot.epc.toFixed(2)}</span>
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={10} align="center">
                            <span className="cell-metric-muted">${tot.cpc.toFixed(2)}</span>
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={11} align="center" className="col-kpi col-kpi-roi">
                            <RoiCell value={tot.roi} size="daily" />
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={12} align="center">
                            {pct(tot.isBgt)}
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={13} align="center">
                            {pct(tot.isRnk)}
                          </Table.Summary.Cell>
                        </Table.Summary.Row>
                      </Table.Summary>
                    )}
                  />
                </div>
              </div>
            );
          },
        }}
      />
    </div>
  );
}
