/** 联盟采集状态中文 */
export const AFFILIATE_STATUS_LABELS: Record<string, string> = {
  pending: '等待中',
  running: '采集中',
  completed: '成功',
  failed: '失败',
  partial: '部分成功',
};

/** 联盟采集 Tag 颜色 */
export function affiliateStatusColor(status: string | null | undefined): string {
  switch (status) {
    case 'completed':
      return 'green';
    case 'running':
      return 'processing';
    case 'partial':
      return 'orange';
    case 'failed':
      return 'red';
    case 'pending':
      return 'default';
    default:
      return 'default';
  }
}

/**
 * 格式化为本地日期时间
 */
export function formatCollectionTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 相对时间（便于判断「多久前采集」）
 */
export function formatRelativeTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return '刚刚';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return formatCollectionTime(iso);
}
