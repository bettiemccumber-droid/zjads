import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Space, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { WarningOutlined } from '@ant-design/icons';
import { api, type ApiResult } from '../api/client';
import {
  isAlertMerchantStillAdvertising,
  parseCommissionAlertMerchantKey,
  type ActiveCampaignHint,
} from '../utils/commission-alert.util';

interface CommissionAlertRow {
  id: number;
  merchantId: string;
  merchantName: string;
  rejectedCommission: number;
  rejectionRate: number;
  rejectedOrderCount: number;
  totalOrderCount: number;
  severity: string;
  triggerReason: string;
  username?: string;
}

interface CommissionAlertBannerProps {
  /** 用于检测在投广告系列的日期区间（与数据采集页一致） */
  startDate: string;
  endDate: string;
  /** 管理员查看员工数据时传入 */
  viewUserId?: number;
  /** 外部触发刷新（如采集完成后） */
  refreshToken?: number;
}

function money(v: number) {
  return `$${Number(v).toFixed(2)}`;
}

function pct(v: number) {
  return `${Number(v).toFixed(1)}%`;
}

/**
 * 数据采集页顶部：待处理佣金风险告警横幅（确认前持续提醒，并标注是否仍在投放）
 */
export default function CommissionAlertBanner({
  startDate,
  endDate,
  viewUserId,
  refreshToken,
}: CommissionAlertBannerProps) {
  const [alerts, setAlerts] = useState<CommissionAlertRow[]>([]);
  const [activeCampaigns, setActiveCampaigns] = useState<ActiveCampaignHint[]>([]);
  const [loading, setLoading] = useState(false);
  const [ackingId, setAckingId] = useState<number | null>(null);

  const loadBannerData = useCallback(async () => {
    setLoading(true);
    try {
      const alertParams = {
        status: 'open',
        limit: 50,
        ...(viewUserId != null ? { userId: viewUserId } : {}),
      };
      const campaignParams = {
        startDate,
        endDate,
        statusMode: 'active',
        ...(viewUserId != null ? { userId: viewUserId } : {}),
      };

      const [alertRes, campaignRes] = await Promise.all([
        api.get<ApiResult<CommissionAlertRow[]>>('/commission-alerts', { params: alertParams }),
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

  const ackAlert = async (id: number) => {
    setAckingId(id);
    try {
      const { data } = await api.post<ApiResult<unknown>>(`/commission-alerts/${id}/ack`);
      if (data.success) {
        setAlerts((prev) => prev.filter((a) => a.id !== id));
      }
    } finally {
      setAckingId(null);
    }
  };

  const enrichedAlerts = useMemo(
    () =>
      alerts.map((alert) => {
        const stillActive = isAlertMerchantStillAdvertising(alert.merchantId, activeCampaigns);
        const parsed = parseCommissionAlertMerchantKey(alert.merchantId);
        return { alert, stillActive, parsed };
      }),
    [alerts, activeCampaigns],
  );

  const stillAdvertisingCount = enrichedAlerts.filter((e) => e.stillActive.length > 0).length;

  if (alerts.length === 0) {
    return null;
  }

  const hasCriticalActive = enrichedAlerts.some(
    (e) => e.stillActive.length > 0 && e.alert.severity === 'critical',
  );

  return (
    <Alert
      type={hasCriticalActive ? 'error' : 'warning'}
      showIcon
      icon={<WarningOutlined />}
      style={{ marginBottom: 16 }}
      message={
        <Space wrap>
          <span>
            结算风险提醒：{alerts.length} 个待处理风险商家
            {stillAdvertisingCount > 0 ? (
              <Typography.Text type="danger" strong style={{ marginLeft: 8 }}>
                其中 {stillAdvertisingCount} 个仍在投放活跃广告系列
              </Typography.Text>
            ) : (
              <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                当前查询区间内未发现活跃投放
              </Typography.Text>
            )}
          </span>
          <Link to="/settlement">前往结算查询 →</Link>
        </Space>
      }
      description={
        <div style={{ marginTop: 8 }}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            以下告警来自结算查询的「待处理告警」，确认后将不再提示。在投状态依据当前报表日期区间内
            ENABLED 广告系列判断。
          </Typography.Paragraph>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {enrichedAlerts.map(({ alert, stillActive, parsed }) => (
              <div
                key={alert.id}
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 8,
                  alignItems: 'center',
                  padding: '6px 0',
                  borderBottom: '1px solid rgba(0,0,0,0.06)',
                }}
              >
                {alert.severity === 'critical' ? (
                  <Tag color="error">严重</Tag>
                ) : (
                  <Tag color="warning">警告</Tag>
                )}
                <Typography.Text strong>
                  {alert.merchantName || parsed.merchantId}
                </Typography.Text>
                <Typography.Text type="secondary">
                  ID {parsed.merchantId}
                  {parsed.affiliateAlias ? ` · ${parsed.affiliateAlias}` : ''}
                </Typography.Text>
                <Typography.Text>
                  失效 {money(Number(alert.rejectedCommission))} · 失效率 {pct(Number(alert.rejectionRate))}
                  {' '}
                  ({alert.rejectedOrderCount}/{alert.totalOrderCount} 单)
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
                  loading={ackingId === alert.id}
                  disabled={loading}
                  onClick={() => void ackAlert(alert.id)}
                >
                  确认
                </Button>
              </div>
            ))}
          </Space>
        </div>
      }
    />
  );
}
