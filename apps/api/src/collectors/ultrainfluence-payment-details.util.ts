import {
  aggregateNetworkV2PaymentDetailsForSettlement,
  type NetworkV2PaymentDetailRow,
  type NetworkV2PaymentHalfTotals,
} from './network-v2-payment-details.util';
import { fetchNetworkV2PaymentDetailAll } from './network-v2-payment-api.client';

export type UltrainfluencePaymentDetailRow = NetworkV2PaymentDetailRow;
export type UltrainfluencePaymentHalfTotals = NetworkV2PaymentHalfTotals;

const UI_CONFIG = {
  detailUrl: 'https://api.ultrainfluence.com/api/payment_detail',
  source: 'ultrainfluence',
  networkLabel: 'UltraInfluence',
};

/**
 * 按打款日拉取明细（用于实收）
 * @see https://app.ultrainfluence.com/tools/apis/payment_detail_api/54
 */
export async function fetchUltrainfluencePaymentDetailsByPaidDate(
  token: string,
  paidDateBegin: string,
  paidDateEnd: string,
): Promise<UltrainfluencePaymentDetailRow[]> {
  return fetchNetworkV2PaymentDetailAll(UI_CONFIG, token, {
    paidDateBegin,
    paidDateEnd,
  });
}

/**
 * 按校验批准日拉取明细（含未打款行，用于应收）
 */
export async function fetchUltrainfluencePaymentDetailsByValidationDate(
  token: string,
  validationDateBegin: string,
  validationDateEnd: string,
): Promise<UltrainfluencePaymentDetailRow[]> {
  return fetchNetworkV2PaymentDetailAll(UI_CONFIG, token, {
    validationDateBegin,
    validationDateEnd,
    paidDateBegin: '2000-01-01',
    paidDateEnd: '2099-12-31',
  });
}

/**
 * 拉取结算月所需打款明细（打款日 + 批准日各一次）
 */
export async function fetchUltrainfluencePaymentDetailsForSettlement(
  token: string,
  beginDate: string,
  endDate: string,
): Promise<{
  paidRows: UltrainfluencePaymentDetailRow[];
  validationRows: UltrainfluencePaymentDetailRow[];
}> {
  const paidRows = await fetchUltrainfluencePaymentDetailsByPaidDate(token, beginDate, endDate);
  const validationRows = await fetchUltrainfluencePaymentDetailsByValidationDate(
    token,
    beginDate,
    endDate,
  );
  return { paidRows, validationRows };
}

export const aggregateUltrainfluencePaymentDetailsForSettlement =
  aggregateNetworkV2PaymentDetailsForSettlement;
