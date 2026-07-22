import { useCallback, useEffect, useState } from 'react';
import { Button, Input, message, Pagination, Select, Spin, Table } from 'antd';
import { FileExcelOutlined } from '@ant-design/icons';
import { api, type ApiResult } from '../../api/client';
import { exportMerchantAnalysisExcel } from '../../utils/exportExcel';
import './AdminMerchantAnalysis.css';

interface CampaignRow {
  userId: number;
  username: string;
  campaignId: string;
  campaignName: string;
  affiliateAlias: string;
  dailyBudget: number;
  impressions: number;
  clicks: number;
  cost: number;
  orderCount: number;
  commission: number;
  affiliateClicks: number;
  cr: number;
  epc: number;
  cpc: number;
  roi: number;
}

interface MerchantItem {
  rank: number;
  merchantId: string;
  totalBudget: number;
  totalCost: number;
  totalCommission: number;
  totalOrders: number;
  roi: number;
  campaigns: CampaignRow[];
}

interface MerchantAnalysisData {
  total: number;
  page: number;
  pageSize: number;
  items: MerchantItem[];
}

interface AdminMerchantAnalysisProps {
  /** 父级点击「查询」后提交的日期区间 */
  startDate: string;
  endDate: string;
}

/** ROI 颜色：正绿负红 */
function roiColor(v: number): string {
  if (v >= 1) return '#16a34a';
  if (v >= 0) return '#ca8a04';
  return '#dc2626';
}

function money(v: number): string {
  return `$${v.toFixed(2)}`;
}

const campaignColumns = [
  { title: '用户', dataIndex: 'username', width: 88 },
  {
    title: '广告系列',
    dataIndex: 'campaignName',
    ellipsis: true,
    render: (name: string, r: CampaignRow) => (
      <span title={name}>
        {name || r.campaignId}
        {r.affiliateAlias ? (
          <span style={{ marginLeft: 6, color: '#64748b', fontSize: 11 }}>{r.affiliateAlias}</span>
        ) : null}
      </span>
    ),
  },
  {
    title: '预算',
    dataIndex: 'dailyBudget',
    width: 72,
    align: 'right' as const,
    render: (v: number) => money(v),
  },
  {
    title: '展示',
    dataIndex: 'impressions',
    width: 72,
    align: 'right' as const,
    render: (v: number) => v.toLocaleString(),
  },
  {
    title: '点击',
    dataIndex: 'clicks',
    width: 72,
    align: 'right' as const,
    render: (v: number) => v.toLocaleString(),
  },
  {
    title: '广告费',
    dataIndex: 'cost',
    width: 88,
    align: 'right' as const,
    render: (v: number) => money(v),
  },
  {
    title: '订单',
    dataIndex: 'orderCount',
    width: 64,
    align: 'right' as const,
  },
  {
    title: '佣金',
    dataIndex: 'commission',
    width: 88,
    align: 'right' as const,
    render: (v: number) => money(v),
  },
  {
    title: 'CR',
    dataIndex: 'cr',
    width: 64,
    align: 'right' as const,
    render: (v: number) => `${v.toFixed(2)}%`,
  },
  {
    title: 'EPC',
    dataIndex: 'epc',
    width: 72,
    align: 'right' as const,
    render: (v: number) => money(v),
  },
  {
    title: 'CPC',
    dataIndex: 'cpc',
    width: 72,
    align: 'right' as const,
    render: (v: number) => money(v),
  },
  {
    title: 'ROI',
    dataIndex: 'roi',
    width: 64,
    align: 'right' as const,
    defaultSortOrder: 'descend' as const,
    sorter: (a: CampaignRow, b: CampaignRow) => a.roi - b.roi,
    render: (v: number) => <span style={{ color: roiColor(v), fontWeight: 600 }}>{v.toFixed(2)}</span>,
  },
];

/**
 * 管理员全公司商家分析：按商家 ID 聚合，展示各员工广告系列明细
 */
export default function AdminMerchantAnalysis({
  startDate,
  endDate,
}: AdminMerchantAnalysisProps) {
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortBy, setSortBy] = useState<'roi' | 'commission'>('roi');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [data, setData] = useState<MerchantAnalysisData | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await api.get<ApiResult<MerchantAnalysisData>>('/admin/merchant-analysis', {
        params: { startDate, endDate, search, page, pageSize, sortBy },
      });
      if (res.success) setData(res.data);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, search, page, pageSize, sortBy]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [search, startDate, endDate, sortBy]);

  const handleSearch = () => {
    setSearch(searchInput.trim());
    setPage(1);
  };

  /** 导出当前筛选条件下全部商家数据 */
  const handleExport = async () => {
    setExporting(true);
    try {
      const { data: res } = await api.get<ApiResult<MerchantAnalysisData>>('/admin/merchant-analysis', {
        params: { startDate, endDate, search, all: '1', sortBy },
      });
      if (!res.success || !res.data.items.length) {
        message.warning('暂无数据可导出');
        return;
      }
      await exportMerchantAnalysisExcel(res.data.items, startDate, endDate);
      message.success(`已导出 ${res.data.items.length} 个商家`);
    } catch {
      message.error('导出失败，请稍后重试');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <div className="merchant-analysis-toolbar">
        <Input.Search
          allowClear
          placeholder="搜索商家ID、用户名或广告系列..."
          style={{ width: 320 }}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onSearch={handleSearch}
        />
        {data && (
          <span style={{ color: '#64748b', fontSize: 13 }}>
            共 {data.total} 个商家，显示第 {(data.page - 1) * data.pageSize + 1} –{' '}
            {Math.min(data.page * data.pageSize, data.total)} 条
          </span>
        )}
        <Select
          value={sortBy}
          style={{ width: 140 }}
          options={[
            { value: 'roi', label: '按 ROI 排序' },
            { value: 'commission', label: '按佣金排序' },
          ]}
          onChange={(v) => {
            setSortBy(v as 'roi' | 'commission');
            setPage(1);
          }}
        />
        <Select
          value={pageSize}
          style={{ width: 120, marginLeft: 'auto' }}
          options={[
            { value: 10, label: '10 条/页' },
            { value: 20, label: '20 条/页' },
            { value: 50, label: '50 条/页' },
          ]}
          onChange={(v) => {
            setPageSize(v);
            setPage(1);
          }}
        />
        <Button
          type="primary"
          className="merchant-export-btn"
          icon={<FileExcelOutlined />}
          loading={exporting}
          onClick={() => void handleExport()}
        >
          导出Excel
        </Button>
      </div>

      <Spin spinning={loading}>
        {!loading && data?.items.length === 0 && (
          <div className="merchant-analysis-empty">当前筛选条件下暂无商家数据</div>
        )}

        {data?.items.map((m) => (
          <div key={m.merchantId} className="merchant-analysis-card">
            <div className="merchant-analysis-card-header">
              <div className="merchant-analysis-card-title">
                #{m.rank} 商家ID: {m.merchantId}
              </div>
              <div className="merchant-analysis-card-metrics">
                <span>
                  总预算<strong>{money(m.totalBudget)}</strong>
                </span>
                <span>
                  总广告费<strong>{money(m.totalCost)}</strong>
                </span>
                <span>
                  总佣金<strong>{money(m.totalCommission)}</strong>
                </span>
                <span>
                  总ROI<strong style={{ color: roiColor(m.roi) }}>{m.roi.toFixed(2)}</strong>
                </span>
              </div>
            </div>
            <div className="merchant-analysis-card-body">
              <Table
                rowKey={(r) => `${r.userId}|${r.campaignName}|${r.affiliateAlias}`}
                dataSource={m.campaigns}
                columns={campaignColumns}
                pagination={false}
                size="small"
                scroll={{ x: 1100 }}
              />
            </div>
          </div>
        ))}

        {data && data.total > 0 && (
          <Pagination
            current={page}
            pageSize={pageSize}
            total={data.total}
            showSizeChanger={false}
            style={{ marginTop: 8, textAlign: 'right' }}
            onChange={(p) => setPage(p)}
          />
        )}
      </Spin>
    </div>
  );
}
