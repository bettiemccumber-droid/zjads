import {
  fetchNetworkFamilyClicks,
  NetworkClickFetchProgress,
  NetworkMerchantClickAgg,
} from './network-family-clicks';

const BSH_CLICK_API = 'https://api.brandsparkhub.com/api/click_report';
const BSH_SOURCE = 'brandsparkhub';

export type BshMerchantClickAgg = NetworkMerchantClickAgg;
export type BshClickFetchProgress = NetworkClickFetchProgress;

/**
 * 采集 Brandsparkhub 联盟点击
 */
export async function fetchBrandsparkhubClicks(
  apiToken: string,
  startDate: string,
  endDate: string,
  onProgress?: (p: BshClickFetchProgress) => void | Promise<void>,
): Promise<BshMerchantClickAgg[]> {
  return fetchNetworkFamilyClicks(
    BSH_CLICK_API,
    BSH_SOURCE,
    apiToken,
    startDate,
    endDate,
    onProgress,
  );
}
