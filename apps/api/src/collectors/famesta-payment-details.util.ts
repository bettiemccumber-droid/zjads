import {
  aggregateNetworkV2PaymentDetailsForSettlement,
  type NetworkV2PaymentDetailRow,
  type NetworkV2PaymentHalfTotals,
} from './network-v2-payment-details.util';
import { fetchNetworkV2PaymentDetailAll } from './network-v2-payment-api.client';

export type FamestaPaymentDetailRow = NetworkV2PaymentDetailRow;
export type FamestaPaymentHalfTotals = NetworkV2PaymentHalfTotals;

const FS_CONFIG = {
  detailUrl: 'https://api.famesta.com/api/payment_detail',
  source: 'famesta',
  networkLabel: 'Famesta',
};

/**
 * 按打款日拉取明细（用于实收）
 * @see https://app.famesta.com/tools/apis/payment_detail_api/94
 */
export async function fetchFamestaPaymentDetailsByPaidDate(
  token: string,
  paidDateBegin: string,
  paidDateEnd: string,
): Promise<FamestaPaymentDetailRow[]> {
  return fetchNetworkV2PaymentDetailAll(FS_CONFIG, token, {
    paidDateBegin,
    paidDateEnd,
  });
}

/**
 * 按校验批准日拉取明细（含未打款行，用于应收）
 */
export async function fetchFamestaPaymentDetailsByValidationDate(
  token: string,
  validationDateBegin: string,
  validationDateEnd: string,
): Promise<FamestaPaymentDetailRow[]> {
  return fetchNetworkV2PaymentDetailAll(FS_CONFIG, token, {
    validationDateBegin,
    validationDateEnd,
    paidDateBegin: '2000-01-01',
    paidDateEnd: '2099-12-31',
  });
}

/**
 * 拉取结算月所需打款明细（打款日 + 批准日各一次）
 */
export async function fetchFamestaPaymentDetailsForSettlement(
  token: string,
  beginDate: string,
  endDate: string,
): Promise<{ paidRows: FamestaPaymentDetailRow[]; validationRows: FamestaPaymentDetailRow[] }> {
  const paidRows = await fetchFamestaPaymentDetailsByPaidDate(token, beginDate, endDate);
  const validationRows = await fetchFamestaPaymentDetailsByValidationDate(
    token,
    beginDate,
    endDate,
  );
  return { paidRows, validationRows };
}

export const aggregateFamestaPaymentDetailsForSettlement =
  aggregateNetworkV2PaymentDetailsForSettlement;
