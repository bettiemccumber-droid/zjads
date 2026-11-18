/**
 * 投放国家 → 市场常用广告语言（Google languageConstants 代码）。
 * 未列出的国家回退 en。
 */
const DEFAULT_LANGUAGE_BY_COUNTRY: Record<string, string> = {
  PL: 'pl',
  DE: 'de',
  AT: 'de',
  CH: 'de',
  FR: 'fr',
  BE: 'fr',
  LU: 'fr',
  ES: 'es',
  MX: 'es',
  AR: 'es',
  CL: 'es',
  CO: 'es',
  PE: 'es',
  IT: 'it',
  PT: 'pt',
  BR: 'pt',
  NL: 'nl',
  SE: 'sv',
  NO: 'no',
  DK: 'da',
  FI: 'fi',
  CZ: 'cs',
  SK: 'sk',
  HU: 'hu',
  RO: 'ro',
  BG: 'bg',
  HR: 'hr',
  SI: 'sl',
  RS: 'sr',
  UA: 'uk',
  RU: 'ru',
  TR: 'tr',
  GR: 'el',
  IL: 'he',
  AE: 'ar',
  SA: 'ar',
  EG: 'ar',
  JP: 'ja',
  KR: 'ko',
  CN: 'zh',
  TW: 'zh-TW',
  HK: 'zh-TW',
  VN: 'vi',
  TH: 'th',
  ID: 'id',
  MY: 'ms',
  PH: 'tl',
  IN: 'hi',
  US: 'en',
  GB: 'en',
  UK: 'en',
  IE: 'en',
  AU: 'en',
  NZ: 'en',
  CA: 'en',
  SG: 'en',
  ZA: 'en',
};

/**
 * 国家常用语言。波兰 → pl，巴西 → pt，未配置则 en。
 */
export function defaultLanguageForCountry(countryCode: string): string {
  const country = countryCode.trim().toUpperCase();
  return DEFAULT_LANGUAGE_BY_COUNTRY[country] || 'en';
}

/**
 * 领取时：显式语言优先，否则用目标国家常用语。
 */
export function resolveAdLanguage(countryCode: string, languageCode?: string): string {
  const explicit = (languageCode ?? '').trim();
  if (explicit) return explicit;
  return defaultLanguageForCountry(countryCode);
}
