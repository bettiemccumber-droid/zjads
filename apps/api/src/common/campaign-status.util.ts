/** 广告系列状态筛选模式 */
export type CampaignStatusMode = 'all' | 'active' | 'paused';

/**
 * 判断 Google Ads campaign_status 是否为「已启用」
 */
export function isEnabledCampaignStatus(status: string | null | undefined): boolean {
  const s = (status ?? '').trim().toUpperCase();
  return s === 'ENABLED';
}

/**
 * 是否为暂停/已移除等非启用状态
 */
export function isPausedCampaignStatus(status: string | null | undefined): boolean {
  const s = (status ?? '').trim().toUpperCase();
  if (!s) return false;
  return !isEnabledCampaignStatus(s);
}

/**
 * 规范化 Sheet 中的 campaign_status 文本
 */
export function normalizeCampaignStatus(raw: string): string {
  return (raw ?? '').trim().toUpperCase();
}

/**
 * 按状态模式筛选广告系列行
 */
export function filterRowsByCampaignStatusMode<
  T extends {
    customerId?: string;
    campaignId?: string;
    campaignStatus: string;
    orderCount?: number;
    commission?: number;
  },
>(rows: T[], mode: CampaignStatusMode): T[] {
  if (mode === 'active') {
    return rows.filter((r) => isEnabledCampaignStatus(r.campaignStatus));
  }
  if (mode === 'paused') {
    return rows.filter((r) => isPausedCampaignStatus(r.campaignStatus));
  }
  return rows;
}

/** 子账号截至 endDate 的各 campaign 最新快照 */
export type PhysicalCampaignLatestMeta = {
  date: string;
  status: string;
  campaignName: string;
  affiliateAlias: string;
  merchantId: string;
  campaignBudget: number;
  maxCpc: number;
};

/**
 * 每个子账号在 endDate 前最新一条 ENABLED 系列（对齐 MCC「当前在投」）
 */
export function resolveActiveCampaignIdByCustomer(
  latestByPhysical: Map<string, PhysicalCampaignLatestMeta>,
): Map<string, string> {
  const enabledByCustomer = new Map<string, { campaignId: string; date: string }>();

  for (const [key, meta] of latestByPhysical) {
    if (!isEnabledCampaignStatus(meta.status)) continue;
    const pipe = key.indexOf('|');
    if (pipe < 0) continue;
    const customerId = key.slice(0, pipe);
    const campaignId = key.slice(pipe + 1);
    const prev = enabledByCustomer.get(customerId);
    if (!prev || meta.date > prev.date) {
      enabledByCustomer.set(customerId, { campaignId, date: meta.date });
    }
  }

  return new Map(
    [...enabledByCustomer.entries()].map(([customerId, v]) => [customerId, v.campaignId]),
  );
}

/**
 * 「仅活跃」：每子账号只保留当前 ENABLED 系列，排除同号历史 PAUSED 系列（与 MCC 按系列视图一致）
 */
export function filterActiveCampaignRowsPerSubAccount<
  T extends { customerId: string; campaignId: string; campaignStatus: string },
>(rows: T[], activeCampaignByCustomer: Map<string, string>): T[] {
  return rows.filter((row) => {
    if (!isEnabledCampaignStatus(row.campaignStatus)) return false;
    const customerId = (row.customerId || '').trim();
    if (!customerId || customerId === 'unknown') return true;
    const activeId = activeCampaignByCustomer.get(customerId);
    if (!activeId) return true;
    return row.campaignId === activeId;
  });
}

/**
 * 按天明细：按逻辑系列（campaignGroupKey）取最新状态再筛选，避免换号后旧账号 PAUSED 行被误删
 */
export function filterCampaignDailyByGroupStatus<
  T extends { campaignGroupKey: string; date: string; campaignStatus: string },
>(rows: T[], mode: CampaignStatusMode): T[] {
  if (mode === 'all' || !rows.length) return rows;

  const latestByGroup = new Map<string, { date: string; status: string }>();
  for (const row of rows) {
    const prev = latestByGroup.get(row.campaignGroupKey);
    if (!prev || row.date >= prev.date) {
      latestByGroup.set(row.campaignGroupKey, {
        date: row.date,
        status: row.campaignStatus,
      });
    }
  }

  const allowed = new Set<string>();
  for (const [groupKey, { status }] of latestByGroup) {
    if (mode === 'active' && isEnabledCampaignStatus(status)) {
      allowed.add(groupKey);
    } else if (mode === 'paused' && isPausedCampaignStatus(status)) {
      allowed.add(groupKey);
    }
  }

  return rows.filter((r) => allowed.has(r.campaignGroupKey));
}

/**
 * 解析查询参数中的状态模式（兼容旧版 enabledOnly / hideIdlePaused）
 */
export function resolveCampaignStatusMode(q: {
  statusMode?: CampaignStatusMode;
  enabledOnly?: boolean;
  hideIdlePaused?: boolean;
}): CampaignStatusMode {
  if (q.statusMode === 'all' || q.statusMode === 'active' || q.statusMode === 'paused') {
    return q.statusMode;
  }
  if (q.enabledOnly) return 'active';
  if (q.hideIdlePaused === false) return 'all';
  return 'active';
}
