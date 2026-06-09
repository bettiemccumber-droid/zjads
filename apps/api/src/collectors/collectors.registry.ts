/** 已接入采集的平台 code */
export const IMPLEMENTED_COLLECTOR_CODES = new Set<string>([
  'partnermatic',
  'linkhaitao',
  'linkbux',
]);

/** 规划中、尚未接入的平台 */
export const PLANNED_COLLECTOR_CODES = new Set<string>([
  'rewardoo',
  'partnerboost',
  'brandsparkhub',
  'creatorflare',
  'collabglow',
]);

/**
 * 判断平台是否已实现采集器
 */
export function isCollectorImplemented(platformCode: string): boolean {
  return IMPLEMENTED_COLLECTOR_CODES.has(platformCode);
}

/**
 * 未接入平台的友好提示
 */
export function collectorNotReadyMessage(platformName: string, platformCode: string): string {
  if (PLANNED_COLLECTOR_CODES.has(platformCode)) {
    return `${platformName} 采集器开发中，当前已接入 PartnerMatic、LinkHaitao、LinkBux`;
  }
  return `平台 ${platformName} 采集器尚未实现，当前已接入 PartnerMatic、LinkHaitao、LinkBux`;
}
