import {
  fetchNetworkFamilyClicks,
  NetworkClickFetchProgress,
  NetworkMerchantClickAgg,
} from './network-family-clicks';

const FS_CLICK_API = 'https://api.famesta.com/api/click_report';
const FS_SOURCE = 'famesta';

export type FsMerchantClickAgg = NetworkMerchantClickAgg;
export type FsClickFetchProgress = NetworkClickFetchProgress;

/**
 * 采集 Famesta 联盟点击
 */
export async function fetchFamestaClicks(
  apiToken: string,
  startDate: string,
  endDate: string,
  onProgress?: (p: FsClickFetchProgress) => void | Promise<void>,
): Promise<FsMerchantClickAgg[]> {
  return fetchNetworkFamilyClicks(FS_CLICK_API, FS_SOURCE, apiToken, startDate, endDate, onProgress);
}
