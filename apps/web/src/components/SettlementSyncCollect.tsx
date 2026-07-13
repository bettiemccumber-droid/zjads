import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Space, Typography, message } from 'antd';
import { api, type ApiResult } from '../api/client';
import SyncJobStatus, { type SyncJobDetail } from './SyncJobStatus';

interface SyncAccountPick {
  id: number;
  platformCode: string;
  platformName: string;
  displayName: string;
  affiliateAlias: string;
}

export interface SettlementSyncCollectProps {
  startDate: string;
  endDate: string;
  platformCode: string;
  channelAccountId: number | 'all';
  /** 管理员代采：指定员工 userId；未指定时不发起采集 */
  targetUserId?: number | null;
  isAdmin: boolean;
  companyWideScope: boolean;
  onCompleted?: () => void;
}

/**
 * 结算页联盟订单重采集（同步最新佣金状态后再刷新结算）
 */
export default function SettlementSyncCollect({
  startDate,
  endDate,
  platformCode,
  channelAccountId,
  targetUserId,
  isAdmin,
  companyWideScope,
  onCompleted,
}: SettlementSyncCollectProps) {
  const [syncAccounts, setSyncAccounts] = useState<SyncAccountPick[]>([]);
  const [includeClicks, setIncludeClicks] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncJob, setSyncJob] = useState<SyncJobDetail | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const collectBlocked = isAdmin && companyWideScope && targetUserId == null;

  const loadAccounts = useCallback(async () => {
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
      params: targetUserId ? { userId: targetUserId } : undefined,
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
    setSyncAccounts(picks);
  }, [targetUserId]);

  useEffect(() => {
    if (collectBlocked) {
      setSyncAccounts([]);
      return;
    }
    void loadAccounts();
  }, [loadAccounts, collectBlocked]);

  const accountIdsToCollect = useMemo(() => {
    if (channelAccountId !== 'all') {
      return syncAccounts.some((a) => a.id === channelAccountId) ? [channelAccountId] : [];
    }
    if (platformCode !== 'all') {
      return syncAccounts.filter((a) => a.platformCode === platformCode).map((a) => a.id);
    }
    return syncAccounts.map((a) => a.id);
  }, [syncAccounts, channelAccountId, platformCode]);

  const collectScopeLabel = useMemo(() => {
    if (channelAccountId !== 'all') {
      const one = syncAccounts.find((a) => a.id === channelAccountId);
      return one ? `${one.displayName} (${one.affiliateAlias})` : '所选渠道账号';
    }
    if (platformCode !== 'all') {
      const name = syncAccounts.find((a) => a.platformCode === platformCode)?.platformName;
      return name ?? platformCode;
    }
    return `全部可采集账号（${accountIdsToCollect.length} 个）`;
  }, [syncAccounts, channelAccountId, platformCode, accountIdsToCollect.length]);

  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const fetchSyncJob = useCallback(async (jobId: number) => {
    try {
      const { data } = await api.get<ApiResult<SyncJobDetail>>(`/sync/jobs/${jobId}`);
      if (data.success) {
        setSyncJob(data.data);
        return data.data;
      }
    } catch {
      /* 轮询瞬时错误忽略 */
    }
    return null;
  }, []);

  const startPolling = useCallback(
    (jobId: number) => {
      stopPolling();
      void fetchSyncJob(jobId);
      pollTimer.current = setInterval(async () => {
        const job = await fetchSyncJob(jobId);
        if (job && ['completed', 'failed', 'partial'].includes(job.status)) {
          stopPolling();
          if (job.status === 'completed') {
            message.success('采集已完成，正在刷新结算…');
          } else if (job.status === 'failed') {
            message.error('采集失败，请查看任务详情');
          } else {
            message.warning('部分账号采集失败，请查看任务详情');
          }
          onCompletedRef.current?.();
        }
      }, 2000);
    },
    [fetchSyncJob, stopPolling],
  );

  useEffect(() => {
    if (collectBlocked) return;
    void (async () => {
      const { data } = await api.get<ApiResult<SyncJobDetail[]>>('/sync/jobs/recent', {
        params: { limit: 1, ...(targetUserId ? { userId: targetUserId } : {}) },
      });
      if (!data.success || !data.data.length) return;
      const latest = data.data[0];
      if (latest.status === 'pending' || latest.status === 'running') {
        startPolling(latest.id);
      }
    })();
  }, [collectBlocked, targetUserId, startPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const startCollect = async () => {
    if (collectBlocked) {
      message.warning('全公司汇总下请先选择具体员工，再对该员工发起采集');
      return;
    }
    if (!accountIdsToCollect.length) {
      message.warning('当前筛选下没有可采集的联盟账号');
      return;
    }

    setSyncing(true);
    try {
      const { data } = await api.post<ApiResult<SyncJobDetail>>('/sync/jobs', {
        startDate,
        endDate,
        includeClicks,
        channelAccountIds: accountIdsToCollect,
        ...(targetUserId ? { targetUserId } : {}),
      });
      if (data.success) {
        const full = await fetchSyncJob(data.data.id);
        setSyncJob(full ?? data.data);
        startPolling(data.data.id);
        message.info(
          includeClicks
            ? `采集已开始（${collectScopeLabel}，含联盟点击）`
            : `采集已开始（${collectScopeLabel}，仅订单/佣金状态）`,
        );
      } else {
        message.error(data.message);
      }
    } catch {
      message.error('采集请求失败');
    } finally {
      setSyncing(false);
    }
  };

  const cancelJob = async (jobId: number) => {
    setCancelling(true);
    try {
      const { data } = await api.post<ApiResult<SyncJobDetail>>(`/sync/jobs/${jobId}/cancel`);
      if (data.success) {
        setSyncJob(data.data);
        message.info('任务已取消');
      } else {
        message.error(data.message);
      }
    } finally {
      setCancelling(false);
    }
  };

  const jobActive = syncJob != null && ['pending', 'running'].includes(syncJob.status);

  return (
    <div style={{ marginBottom: 16 }}>
      <Space wrap align="center">
        <Button
          type="default"
          loading={syncing || jobActive}
          disabled={collectBlocked || jobActive}
          onClick={() => void startCollect()}
        >
          重新采集
        </Button>
        <Checkbox
          checked={includeClicks}
          disabled={jobActive}
          onChange={(e) => setIncludeClicks(e.target.checked)}
        >
          含联盟点击
        </Checkbox>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {collectBlocked
            ? '全公司视图请先选员工再采集'
            : `将拉取 ${startDate} ~ ${endDate} · ${collectScopeLabel}（更新拒付/结算状态）`}
        </Typography.Text>
      </Space>
      <SyncJobStatus
        job={syncJob}
        onCancel={jobActive ? cancelJob : undefined}
        cancelling={cancelling}
      />
    </div>
  );
}
