import { AD_COUNTRY_OPTIONS as GEO_COUNTRY_OPTIONS, AD_LANGUAGE_OPTIONS as GEO_LANGUAGE_OPTIONS } from './ad-geo-language-options';

export interface AdLaunchSettings {
  bidding: 'MAXIMIZE_CLICKS' | 'MANUAL_CPC';
  cpcBidCeilingUsd: string;
  dailyBudgetUsd: string;
  targetCountry: string;
  languageCode: string;
}

const DEFAULTS: AdLaunchSettings = {
  bidding: 'MAXIMIZE_CLICKS',
  cpcBidCeilingUsd: '',
  dailyBudgetUsd: '3.00',
  targetCountry: 'US',
  languageCode: 'en',
};

/**
 * 尽可能多点击时不带最高 CPC；兼容旧本地配置里残留的 0.50。
 */
export function normalizeAdSettings(value: Partial<AdLaunchSettings>): AdLaunchSettings {
  const next = { ...DEFAULTS, ...value };
  if (next.bidding !== 'MANUAL_CPC') next.cpcBidCeilingUsd = '';
  return next;
}

/**
 * 读取当前员工保存在本机的投放默认值。
 */
export function loadAdSettings(userId: number): AdLaunchSettings {
  try {
    const raw = localStorage.getItem(`zjads.adLaunchSettings.${userId}`);
    if (!raw) return { ...DEFAULTS };
    return normalizeAdSettings(JSON.parse(raw) as Partial<AdLaunchSettings>);
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * 保存投放默认值。新增广告时带上这些数字。
 */
export function saveAdSettings(userId: number, value: AdLaunchSettings) {
  localStorage.setItem(`zjads.adLaunchSettings.${userId}`, JSON.stringify(normalizeAdSettings(value)));
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

/** 全球目标国家（与 API geoTargetConstants 对齐）。 */
export const AD_COUNTRY_OPTIONS = [...GEO_COUNTRY_OPTIONS];

/** 全球广告语言（与 API languageConstants 对齐）。 */
export const AD_LANGUAGE_OPTIONS = [...GEO_LANGUAGE_OPTIONS];
