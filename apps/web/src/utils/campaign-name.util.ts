/**
 * 从广告系列联盟序号推断平台名（与后端 campaign-name.util 一致）
 */
export function inferPlatformNameFromAlias(alias: string): string {
  const a = (alias || '').toLowerCase();
  if (a.startsWith('lh')) return 'LinkHaitao';
  if (a.startsWith('pm')) return 'PartnerMatic';
  if (a.startsWith('lb')) return 'LinkBux';
  if (a.startsWith('rw')) return 'Rewardoo';
  return '';
}
