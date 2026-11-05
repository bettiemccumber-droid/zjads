import {
  aggregateNetworkV2PaymentDetailsForSettlement,
  type NetworkV2PaymentDetailRow,
  type NetworkV2PaymentHalfTotals,
} from './network-v2-payment-details.util';
import { fetchNetworkV2PaymentDetailAll } from './network-v2-payment-api.client';

export type CollabglowPaymentDetailRow = NetworkV2PaymentDetailRow;
export type CollabglowPaymentHalfTotals = NetworkV2PaymentHalfTotals;

const CG_CONFIG = {
  detailUrl: 'https://api.collabglow.com/api/payment_detail',
  source: 'collabglow',
  networkLabel: 'CollabGlow',
};

/**
 * 按打款日拉取明细（用于实收）
 * @see https://app.collabglow.com/tools/apis/payment_detail_api/14
 */
export async function fetchCollabglowPaymentDetailsByPaidDate(
  token: string,
  paidDateBegin: string,
  paidDateEnd: string,
): Promise<CollabglowPaymentDetailRow[]> {
  return fetchNetworkV2PaymentDetailAll(CG_CONFIG, token, {
    paidDateBegin,
    paidDateEnd,
  });
}

/**
 * 按校验批准日拉取明细（含未打款行，用于应收）
 */
export async function fetchCollabglowPaymentDetailsByValidationDate(
  token: string,
  validationDateBegin: string,
  validationDateEnd: string,
): Promise<CollabglowPaymentDetailRow[]> {
  return fetchNetworkV2PaymentDetailAll(CG_CONFIG, token, {
    validationDateBegin,
    validationDateEnd,
    paidDateBegin: '2000-01-01',
    paidDateEnd: '2099-12-31',
  });
}

/**
 * 拉取结算月所需打款明细（打款日 + 批准日各一次）
 */
export async function fetchCollabglowPaymentDetailsForSettlement(
  token: string,
  beginDate: string,
  endDate: string,
): Promise<{
  paidRows: CollabglowPaymentDetailRow[];
  validationRows: CollabglowPaymentDetailRow[];
}> {
  const paidRows = await fetchCollabglowPaymentDetailsByPaidDate(token, beginDate, endDate);
  const validationRows = await fetchCollabglowPaymentDetailsByValidationDate(
    token,
    beginDate,
    endDate,
  );
  return { paidRows, validationRows };
}

export const aggregateCollabglowPaymentDetailsForSettlement =
  aggregateNetworkV2PaymentDetailsForSettlement;
