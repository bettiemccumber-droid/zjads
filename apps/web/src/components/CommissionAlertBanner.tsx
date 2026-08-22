import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Space, Tag, Typography } from 'antd';
import { DownOutlined, UpOutlined, WarningOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { api, type ApiResult } from '../api/client';
import {
  groupOpenAlertsByMerchant,
  type ActiveCampaignHint,
  type BannerAlertRow,
  type GroupedMerchantAlert,
} from '../utils/commission-alert.util';

interface CommissionAlertBannerProps {
  /** 用于检测在投广告系列的日期区间（与数据采集页一致） */
  startDate: string;
  endDate: string;
  /** 管理员查看员工数据时传入 */
  viewUserId?: number;
  /** 外部触发刷新（如采集完成后） */
  refreshToken?: number;
}

const BANNER_PREVIEW_COUNT = 3;

function money(v: number) {
  return `$${Number(v).toFixed(2)}`;
}

function pct(v: number) {
  return `${Number(v).toFixed(1)}%`;
}

/** 格式化为 YYYY-MM-DD，便于横幅展示区间 */
function formatBannerDate(value: string) {
  const d = dayjs(value);
  return d.isValid() ? d.format('YYYY-MM-DD') : value.slice(0, 10);
}

function formatDateRange(start: string, end: string) {
  return `${formatBannerDate(start)} ~ ${formatBannerDate(end)}`;
}

function MerchantAlertRow({
  group,
  loading,
  ackingKey,
  onAckGroup,
}: {
  group: GroupedMerchantAlert;
  loading: boolean;
  ackingKey: string | null;
  onAckGroup: (group: GroupedMerchantAlert) => void;
}) {
  const { stillActive, parsed, alerts } = group;

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        alignItems: 'center',
        padding: '6px 0',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
      }}
    >
      {group.severity === 'critical' ? (
        <Tag color="error">严重</Tag>
      ) : (
        <Tag color="warning">警告</Tag>
      )}
      <Typography.Text strong>{group.merchantName}</Typography.Text>
      <Typography.Text type="secondary">
        ID {parsed.merchantId}
        {parsed.affiliateAlias ? ` · ${parsed.affiliateAlias}` : ''}
      </Typography.Text>
      {group.windowCount > 1 ? (
        <Tag color="processing">{group.windowCount} 个统计区间</Tag>
      ) : (
        <Tag color="processing">
          统计区间 {formatDateRange(alerts[0].windowStart, alerts[0].windowEnd)}
        </Tag>
      )}
      <Typography.Text>
        失效 {money(group.rejectedCommission)} · 失效率 {pct(group.rejectionRate)}
        {' '}
        ({group.rejectedOrderCount}/{group.totalOrderCount} 单)
      </Typography.Text>
      {stillActive.length > 0 ? (
        <Tag color="red">
          仍在投放 · {stillActive.length} 个活跃系列
          {stillActive[0]?.campaignName
            ? `（如 ${
                stillActive[0].campaignName.length > 40
                  ? `${stillActive[0].campaignName.slice(0, 40)}…`
                  : stillActive[0].campaignName
              }）`
            : ''}
        </Tag>
      ) : (
        <Tag color="default">未检测到活跃投放</Tag>
      )}
      <Button
        size="small"
        type="link"
        loading={ackingKey === group.merchantKey}
        disabled={loading}
        onClick={() => onAckGroup(group)}
      >
        确认{group.windowCount > 1 ? '全部' : ''}
      </Button>
    </div>
  );
}

/**
 * 数据采集页顶部：待处理佣金风险告警横幅（按商家合并，默认展示 3 条）
 */
export default function CommissionAlertBanner({
  startDate,
  endDate,
  viewUserId,
  refreshToken,
}: CommissionAlertBannerProps) {
  const [alerts, setAlerts] = useState<BannerAlertRow[]>([]);
  const [activeCampaigns, setActiveCampaigns] = useState<ActiveCampaignHint[]>([]);
  const [loading, setLoading] = useState(false);
  const [ackingKey, setAckingKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const loadBannerData = useCallback(async () => {
    setLoading(true);
    try {
      const alertParams = {
        status: 'open',
        limit: 100,
        ...(viewUserId != null ? { userId: viewUserId } : {}),
      };
      const campaignParams = {
        startDate,
        endDate,
        statusMode: 'active',
        ...(viewUserId != null ? { userId: viewUserId } : {}),
      };

      const [alertRes, campaignRes] = await Promise.all([
        api.get<ApiResult<BannerAlertRow[]>>('/commission-alerts', { params: alertParams }),
        api.get<ApiResult<{ summary: ActiveCampaignHint[] }>>('/reports/campaign-summary', {
          params: campaignParams,
        }),
      ]);

      if (alertRes.data.success) {
        setAlerts(alertRes.data.data);
      }
      if (campaignRes.data.success) {
        setActiveCampaigns(campaignRes.data.data.summary);
      }
    } catch {
      /* 横幅加载失败不影响主页面 */
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, viewUserId]);

  useEffect(() => {
    void loadBannerData();
  }, [loadBannerData, refreshToken]);

  useEffect(() => {
    setExpanded(false);
  }, [alerts.length, refreshToken]);

  /** 从其他标签页确认告警后，回到本页时刷新 */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void loadBannerData();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadBannerData]);

  const ackGroup = async (group: GroupedMerchantAlert) => {
    setAckingKey(group.merchantKey);
    try {
      const ids = new Set(group.alerts.map((a) => a.id));
      await Promise.all(
        group.alerts.map((a) => api.post<ApiResult<unknown>>(`/commission-alerts/${a.id}/ack`)),
      );
      setAlerts((prev) => prev.filter((a) => !ids.has(a.id)));
    } finally {
      setAckingKey(null);
    }
  };

  const merchantGroups = useMemo(
    () => groupOpenAlertsByMerchant(alerts, activeCampaigns),
    [alerts, activeCampaigns],
  );

  const stillAdvertisingCount = merchantGroups.filter((g) => g.stillActive.length > 0).length;
  const reportDateRangeLabel = formatDateRange(startDate, endDate);
  const visibleGroups = expanded
    ? merchantGroups
    : merchantGroups.slice(0, BANNER_PREVIEW_COUNT);
  const hiddenCount = Math.max(0, merchantGroups.length - BANNER_PREVIEW_COUNT);

  if (merchantGroups.length === 0) {
    return null;
  }

  const hasCriticalActive = merchantGroups.some(
    (g) => g.stillActive.length > 0 && g.severity === 'critical',
  );

  return (
    <Alert
      type={hasCriticalActive ? 'error' : 'warning'}
      showIcon
      icon={<WarningOutlined />}
      style={{ marginBottom: 16 }}
      message={
        <Space wrap align="center">
          <span>
            结算风险提醒：共 {merchantGroups.length} 个商家待处理
            {alerts.length > merchantGroups.length ? (
              <Typography.Text type="secondary" style={{ marginLeft: 4 }}>
                （{alerts.length} 条告警）
              </Typography.Text>
            ) : null}
            {stillAdvertisingCount > 0 ? (
              <Typography.Text type="danger" strong style={{ marginLeft: 8 }}>
                其中 {stillAdvertisingCount} 个仍在投放
              </Typography.Text>
            ) : (
              <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                当前查询区间内未发现活跃投放
              </Typography.Text>
            )}
          </span>
          <Tag color="blue">在投检测区间 {reportDateRangeLabel}</Tag>
          <Link to="/settlement">前往结算查询 →</Link>
        </Space>
      }
      description={
        <div style={{ marginTop: 8 }}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            按商家汇总展示。确认后不再提醒，除非失效佣金、失效单数或失效率增加。在投状态依据上方
            <Typography.Text strong> 在投检测区间 </Typography.Text>
            内 ENABLED 广告系列判断。
          </Typography.Paragraph>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {visibleGroups.map((group) => (
              <MerchantAlertRow
                key={group.merchantKey}
                group={group}
                loading={loading}
                ackingKey={ackingKey}
                onAckGroup={(g) => void ackGroup(g)}
              />
            ))}
            {hiddenCount > 0 && !expanded ? (
              <Button
                type="link"
                size="small"
                icon={<DownOutlined />}
                style={{ paddingLeft: 0 }}
                onClick={() => setExpanded(true)}
              >
                展开更多 {hiddenCount} 个商家
              </Button>
            ) : null}
            {expanded && merchantGroups.length > BANNER_PREVIEW_COUNT ? (
              <Button
                type="link"
                size="small"
                icon={<UpOutlined />}
                style={{ paddingLeft: 0 }}
                onClick={() => setExpanded(false)}
              >
                收起
              </Button>
            ) : null}
          </Space>
        </div>
      }
    />
  );
}
