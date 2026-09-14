import {
  fetchNetworkFamilyClicks,
  NetworkClickFetchProgress,
  NetworkMerchantClickAgg,
} from './network-family-clicks';

const CG_CLICK_API = 'https://api.collabglow.com/api/click_report';
const CG_SOURCE = 'collabglow';

export type CgMerchantClickAgg = NetworkMerchantClickAgg;
export type CgClickFetchProgress = NetworkClickFetchProgress;

/**
 * 采集 CollabGlow 联盟点击
 */
export async function fetchCollabGlowClicks(
  apiToken: string,
  startDate: string,
  endDate: string,
  onProgress?: (p: CgClickFetchProgress) => void | Promise<void>,
): Promise<CgMerchantClickAgg[]> {
  return fetchNetworkFamilyClicks(CG_CLICK_API, CG_SOURCE, apiToken, startDate, endDate, onProgress);
}
