export interface AdLaunchSettings {
  bidding: 'MAXIMIZE_CLICKS' | 'MANUAL_CPC';
  cpcBidCeilingUsd: string;
  dailyBudgetUsd: string;
  targetCountry: string;
  languageCode: string;
}

const DEFAULTS: AdLaunchSettings = {
  bidding: 'MAXIMIZE_CLICKS',
  cpcBidCeilingUsd: '0.50',
  dailyBudgetUsd: '3.00',
  targetCountry: 'US',
  languageCode: 'en',
};

/**
 * 读取当前员工保存在本机的投放默认值。
 */
export function loadAdSettings(userId: number): AdLaunchSettings {
  try {
    const raw = localStorage.getItem(`zjads.adLaunchSettings.${userId}`);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * 保存投放默认值。新增广告时带上这些数字。
 */
export function saveAdSettings(userId: number, value: AdLaunchSettings) {
  localStorage.setItem(`zjads.adLaunchSettings.${userId}`, JSON.stringify(value));
}

/**
 * 把客户号排成 750-357-9184。十位数字按 3-3-4。
 */
export function formatCustomerId(raw: string) {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return digits.replace(/(\d{3})(?=\d)/g, '$1-');
}
