/**
 * Google Ads 系列是否视为「投放中」
 */
export function isEnabledCampaignStatus(status: string): boolean {
  const s = (status || '').toUpperCase();
  return s === 'ENABLED' || s === 'ACTIVE';
}
