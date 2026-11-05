import {
  aggregateNetworkV2PaymentDetailsForSettlement,
  type NetworkV2PaymentDetailRow,
  type NetworkV2PaymentHalfTotals,
} from './network-v2-payment-details.util';
import { fetchNetworkV2PaymentDetailAll } from './network-v2-payment-api.client';

export type LinkhaitaoPaymentDetailRow = NetworkV2PaymentDetailRow;
export type LinkhaitaoPaymentHalfTotals = NetworkV2PaymentHalfTotals;

const LH_CONFIG = {
  detailUrl: 'https://api.linkhaitao.com/api/payment_detail',
  source: 'linkhaitao',
  networkLabel: 'LinkHaitao',
};

/**
 * 按打款日拉取明细（用于实收）
 * @see https://www.linkhaitao.com/apis-v2/payment_detail_api/84
 */
export async function fetchLinkhaitaoPaymentDetailsByPaidDate(
  token: string,
  paidDateBegin: string,
  paidDateEnd: string,
): Promise<LinkhaitaoPaymentDetailRow[]> {
  return fetchNetworkV2PaymentDetailAll(LH_CONFIG, token, {
    paidDateBegin,
    paidDateEnd,
  });
}

/**
 * 按校验批准日拉取明细（含未打款行，用于应收）
 */
export async function fetchLinkhaitaoPaymentDetailsByValidationDate(
  token: string,
  validationDateBegin: string,
  validationDateEnd: string,
): Promise<LinkhaitaoPaymentDetailRow[]> {
  return fetchNetworkV2PaymentDetailAll(LH_CONFIG, token, {
    validationDateBegin,
    validationDateEnd,
    paidDateBegin: '2000-01-01',
    paidDateEnd: '2099-12-31',
  });
}

/**
 * 拉取结算月所需打款明细（打款日 + 批准日各一次）
 */
export async function fetchLinkhaitaoPaymentDetailsForSettlement(
  token: string,
  beginDate: string,
  endDate: string,
): Promise<{ paidRows: LinkhaitaoPaymentDetailRow[]; validationRows: LinkhaitaoPaymentDetailRow[] }> {
  const paidRows = await fetchLinkhaitaoPaymentDetailsByPaidDate(token, beginDate, endDate);
  const validationRows = await fetchLinkhaitaoPaymentDetailsByValidationDate(
    token,
    beginDate,
    endDate,
  );
  return { paidRows, validationRows };
}

export const aggregateLinkhaitaoPaymentDetailsForSettlement =
  aggregateNetworkV2PaymentDetailsForSettlement;
