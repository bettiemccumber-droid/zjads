import {
  aggregateNetworkV2PaymentDetailsForSettlement,
  type NetworkV2PaymentDetailRow,
  type NetworkV2PaymentHalfTotals,
} from './network-v2-payment-details.util';
import { fetchNetworkV2PaymentDetailAll } from './network-v2-payment-api.client';

export type BrandsparkhubPaymentDetailRow = NetworkV2PaymentDetailRow;
export type BrandsparkhubPaymentHalfTotals = NetworkV2PaymentHalfTotals;

const BSH_CONFIG = {
  detailUrl: 'https://api.brandsparkhub.com/api/payment_detail',
  source: 'brandsparkhub',
  networkLabel: 'Brandsparkhub',
};

/**
 * 按打款日拉取明细（用于实收）
 * @see https://app.brandsparkhub.com/tools/apis/payment_detail_api/34
 */
export async function fetchBrandsparkhubPaymentDetailsByPaidDate(
  token: string,
  paidDateBegin: string,
  paidDateEnd: string,
): Promise<BrandsparkhubPaymentDetailRow[]> {
  return fetchNetworkV2PaymentDetailAll(BSH_CONFIG, token, {
    paidDateBegin,
    paidDateEnd,
  });
}

/**
 * 按校验批准日拉取明细（含未打款行，用于应收）
 */
export async function fetchBrandsparkhubPaymentDetailsByValidationDate(
  token: string,
  validationDateBegin: string,
  validationDateEnd: string,
): Promise<BrandsparkhubPaymentDetailRow[]> {
  return fetchNetworkV2PaymentDetailAll(BSH_CONFIG, token, {
    validationDateBegin,
    validationDateEnd,
    paidDateBegin: '2000-01-01',
    paidDateEnd: '2099-12-31',
  });
}

/**
 * 拉取结算月所需打款明细（打款日 + 批准日各一次）
 */
export async function fetchBrandsparkhubPaymentDetailsForSettlement(
  token: string,
  beginDate: string,
  endDate: string,
): Promise<{
  paidRows: BrandsparkhubPaymentDetailRow[];
  validationRows: BrandsparkhubPaymentDetailRow[];
}> {
  const paidRows = await fetchBrandsparkhubPaymentDetailsByPaidDate(token, beginDate, endDate);
  const validationRows = await fetchBrandsparkhubPaymentDetailsByValidationDate(
    token,
    beginDate,
    endDate,
  );
  return { paidRows, validationRows };
}

export const aggregateBrandsparkhubPaymentDetailsForSettlement =
  aggregateNetworkV2PaymentDetailsForSettlement;
