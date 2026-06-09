import { Button, Input, Radio, Select, Space, Typography } from 'antd';

export type CampaignStatusMode = 'all' | 'active' | 'paused';

const STATUS_OPTIONS: { value: CampaignStatusMode; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'active', label: '仅活跃' },
  { value: 'paused', label: '仅暂停' },
];

interface CampaignReportToolbarProps {
  campaignSearch: string;
  onCampaignSearchChange: (value: string) => void;
  platform: string;
  platformOptions: { value: string; label: string }[];
  onPlatformChange: (value: string) => void;
  statusMode: CampaignStatusMode;
  onStatusModeChange: (mode: CampaignStatusMode) => void;
  loading?: boolean;
  onQuery: () => void;
  filterHint?: string;
}

/**
 * 广告系列分析：标题 + 筛选卡片
 */
export default function CampaignReportToolbar({
  campaignSearch,
  onCampaignSearchChange,
  platform,
  platformOptions,
  onPlatformChange,
  statusMode,
  onStatusModeChange,
  loading,
  onQuery,
  filterHint,
}: CampaignReportToolbarProps) {
  return (
    <div className="campaign-analysis-block">
      <div className="campaign-analysis-header">
        <Typography.Text className="campaign-analysis-eyebrow">CAMPAIGN REPORT</Typography.Text>
        <Typography.Title level={4} className="campaign-analysis-title">
          广告系列分析
        </Typography.Title>
        <Typography.Paragraph type="secondary" className="campaign-analysis-desc">
          按日期、平台与状态筛选广告系列，展开行可查看按天明细与合计；区间与顶部数据采集日期一致。
        </Typography.Paragraph>
      </div>

      <div className="campaign-filter-card">
        <Space wrap size="middle" align="center">
          <Input.Search
            allowClear
            placeholder="搜索广告系列名称"
            style={{ width: 220 }}
            value={campaignSearch}
            onChange={(e) => onCampaignSearchChange(e.target.value)}
          />
          <Select
            style={{ width: 150 }}
            value={platform}
            options={platformOptions}
            onChange={onPlatformChange}
          />
          <div className="campaign-status-filter">
            <span className="campaign-status-label">显示状态</span>
            <Radio.Group
              optionType="button"
              buttonStyle="solid"
              value={statusMode}
              onChange={(e) => onStatusModeChange(e.target.value as CampaignStatusMode)}
              options={STATUS_OPTIONS}
            />
          </div>
          <Button type="primary" loading={loading} onClick={onQuery}>
            查询
          </Button>
          {filterHint ? (
            <Typography.Text type="secondary" className="campaign-filter-hint">
              {filterHint}
            </Typography.Text>
          ) : null}
        </Space>
      </div>
    </div>
  );
}
