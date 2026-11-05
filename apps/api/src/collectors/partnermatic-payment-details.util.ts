import {
  aggregateNetworkV2PaymentDetailsForSettlement,
  type NetworkV2PaymentDetailRow,
  type NetworkV2PaymentHalfTotals,
} from './network-v2-payment-details.util';
import { fetchNetworkV2PaymentDetailAll } from './network-v2-payment-api.client';

export type PartnermaticPaymentDetailRow = NetworkV2PaymentDetailRow;
export type PartnermaticPaymentHalfTotals = NetworkV2PaymentHalfTotals;

const PM_PAYMENT_DETAIL_URL = 'https://api.partnermatic.com/api/payment_detail';
const PM_CONFIG = {
  detailUrl: PM_PAYMENT_DETAIL_URL,
  source: 'partnermatic',
  networkLabel: 'Partnermatic',
};

/**
 * 按打款日拉取明细（用于实收）
 * @see https://app.partnermatic.com/tools/apis/payment_detail_api
 */
export async function fetchPartnermaticPaymentDetailsByPaidDate(
  token: string,
  paidDateBegin: string,
  paidDateEnd: string,
): Promise<PartnermaticPaymentDetailRow[]> {
  return fetchNetworkV2PaymentDetailAll(PM_CONFIG, token, {
    paidDateBegin,
    paidDateEnd,
  });
}

/**
 * 按校验批准日拉取明细（含未打款行，用于应收）
 */
export async function fetchPartnermaticPaymentDetailsByValidationDate(
  token: string,
  validationDateBegin: string,
  validationDateEnd: string,
): Promise<PartnermaticPaymentDetailRow[]> {
  return fetchNetworkV2PaymentDetailAll(PM_CONFIG, token, {
    validationDateBegin,
    validationDateEnd,
    paidDateBegin: '2000-01-01',
    paidDateEnd: '2099-12-31',
  });
}

/**
 * 拉取结算月所需打款明细（打款日 + 批准日各一次）
 */
export async function fetchPartnermaticPaymentDetailsForSettlement(
  token: string,
  beginDate: string,
  endDate: string,
): Promise<{ paidRows: PartnermaticPaymentDetailRow[]; validationRows: PartnermaticPaymentDetailRow[] }> {
  const paidRows = await fetchPartnermaticPaymentDetailsByPaidDate(token, beginDate, endDate);
  const validationRows = await fetchPartnermaticPaymentDetailsByValidationDate(
    token,
    beginDate,
    endDate,
  );
  return { paidRows, validationRows };
}

export const aggregatePartnermaticPaymentDetailsForSettlement =
  aggregateNetworkV2PaymentDetailsForSettlement;
