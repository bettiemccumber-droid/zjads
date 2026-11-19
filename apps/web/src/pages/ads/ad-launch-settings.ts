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
 * 数据源占位键（如 s23）原样返回，避免被剥成「23」。
 */
export function formatCustomerId(raw: string) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  if (/^[A-Za-z]/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return digits.replace(/(\d{3})(?=\d)/g, '$1-');
}

/** 已绑定的 Google 经理账号客户号（纯数字，至少 6 位）；排除 s23 这类数据源占位。 */
export function isGoogleMccId(raw: string) {
  const trimmed = String(raw || '').trim();
  if (!trimmed || /^[A-Za-z]/.test(trimmed)) return false;
  return /^\d{6,16}$/.test(trimmed.replace(/\D/g, ''));
}

/** 全球目标国家（与 API geoTargetConstants 对齐）。 */
export const AD_COUNTRY_OPTIONS = [...GEO_COUNTRY_OPTIONS];

/** 全球广告语言（与 API languageConstants 对齐）。 */
export const AD_LANGUAGE_OPTIONS = [...GEO_LANGUAGE_OPTIONS];

/** 国家 → 市场常用语言（含波兰 pl）。 */
const DEFAULT_LANGUAGE_BY_COUNTRY: Record<string, string> = {
  PL: 'pl', DE: 'de', AT: 'de', CH: 'de', FR: 'fr', BE: 'fr', ES: 'es', MX: 'es',
  AR: 'es', CL: 'es', CO: 'es', PE: 'es', IT: 'it', PT: 'pt', BR: 'pt', NL: 'nl',
  SE: 'sv', NO: 'no', DK: 'da', FI: 'fi', CZ: 'cs', SK: 'sk', HU: 'hu', RO: 'ro',
  BG: 'bg', HR: 'hr', SI: 'sl', RS: 'sr', UA: 'uk', RU: 'ru', TR: 'tr', GR: 'el',
  IL: 'he', AE: 'ar', SA: 'ar', JP: 'ja', KR: 'ko', CN: 'zh', TW: 'zh-TW', HK: 'zh-TW',
  VN: 'vi', TH: 'th', ID: 'id', MY: 'ms', PH: 'tl', IN: 'hi',
  US: 'en', GB: 'en', UK: 'en', IE: 'en', AU: 'en', NZ: 'en', CA: 'en', SG: 'en', ZA: 'en',
};

/**
 * 目标国家未选手动语言时，用该市场常用语（如 PL → pl）。
 */
export function defaultLanguageForCountry(countryCode: string): string {
  return DEFAULT_LANGUAGE_BY_COUNTRY[countryCode.trim().toUpperCase()] || 'en';
}
