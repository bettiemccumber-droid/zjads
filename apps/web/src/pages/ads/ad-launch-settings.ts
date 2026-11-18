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

/** 领取广告时常用目标国家。 */
export const AD_COUNTRY_OPTIONS = [
  { value: 'US', label: 'US - 美国' },
  { value: 'GB', label: 'GB - 英国' },
  { value: 'CA', label: 'CA - 加拿大' },
  { value: 'AU', label: 'AU - 澳大利亚' },
  { value: 'DE', label: 'DE - 德国' },
  { value: 'FR', label: 'FR - 法国' },
  { value: 'ES', label: 'ES - 西班牙' },
  { value: 'IT', label: 'IT - 意大利' },
  { value: 'NL', label: 'NL - 荷兰' },
  { value: 'IE', label: 'IE - 爱尔兰' },
  { value: 'JP', label: 'JP - 日本' },
  { value: 'SG', label: 'SG - 新加坡' },
  { value: 'HK', label: 'HK - 香港' },
  { value: 'TW', label: 'TW - 台湾' },
  { value: 'VN', label: 'VN - 越南' },
  { value: 'MX', label: 'MX - 墨西哥' },
  { value: 'BR', label: 'BR - 巴西' },
  { value: 'IN', label: 'IN - 印度' },
];

/** 广告语言。可留空，默认跟设置走。 */
export const AD_LANGUAGE_OPTIONS = [
  { value: 'en', label: 'en - English' },
  { value: 'de', label: 'de - Deutsch' },
  { value: 'fr', label: 'fr - Français' },
  { value: 'es', label: 'es - Español' },
  { value: 'vi', label: 'vi - Tiếng Việt' },
  { value: 'zh', label: 'zh - 中文' },
];
