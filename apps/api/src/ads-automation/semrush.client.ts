import axios from 'axios';

export interface SemrushKeywordRow {
  keyword: string;
  position: number | null;
  searchVolume: number | null;
  cpc: number | null;
  traffic: number | null;
}

/** Semrush database 代码；未列出的国家回退 us。 */
const DATABASE_BY_COUNTRY: Record<string, string> = {
  US: 'us',
  GB: 'uk',
  UK: 'uk',
  AU: 'au',
  CA: 'ca',
  DE: 'de',
  FR: 'fr',
  ES: 'es',
  IT: 'it',
  NL: 'nl',
  BE: 'be',
  AT: 'at',
  CH: 'ch',
  SE: 'se',
  DK: 'dk',
  NO: 'no',
  FI: 'fi',
  IE: 'ie',
  PT: 'pt',
  PL: 'pl',
  BR: 'br',
  MX: 'mx',
  AR: 'ar',
  CL: 'cl',
  CO: 'co',
  IN: 'in',
  JP: 'jp',
  KR: 'kr',
  SG: 'sg',
  HK: 'hk',
  TW: 'tw',
  VN: 'vn',
  TH: 'th',
  MY: 'my',
  ID: 'id',
  PH: 'ph',
  NZ: 'nz',
  ZA: 'za',
  TR: 'tr',
  AE: 'ae',
  IL: 'il',
  RU: 'ru',
};

/**
 * Semrush Analytics API（v3 domain_organic）是否已配置密钥。
 */
export function semrushConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean((env.SEMRUSH_API_KEY ?? '').trim());
}

/**
 * 国家代码映射到 Semrush database 代码。
 */
export function semrushDatabase(countryCode: string): string {
  const code = countryCode.trim().toUpperCase();
  return DATABASE_BY_COUNTRY[code] ?? 'us';
}

/**
 * 从商家 URL 取出根域名。
 */
export function domainFromUrl(merchantUrl: string): string {
  try {
    const host = new URL(merchantUrl).hostname.toLowerCase();
    return host.replace(/^www\./, '');
  } catch {
    return merchantUrl.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0] ?? '';
  }
}

/**
 * 拉取域名自然搜索关键词。返回按流量排序的短语列表。
 */
export async function fetchDomainOrganicKeywords(input: {
  domain: string;
  countryCode: string;
  limit?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<SemrushKeywordRow[]> {
  const env = input.env ?? process.env;
  const key = (env.SEMRUSH_API_KEY ?? '').trim();
  if (!key) throw new Error('未配置 SEMRUSH_API_KEY');
  const domain = input.domain.trim().toLowerCase().replace(/^www\./, '');
  if (!domain) throw new Error('商家域名无效');
  const limit = Math.min(100, Math.max(1, input.limit ?? 30));
  const base = (env.SEMRUSH_API_BASE ?? 'https://api.semrush.com').replace(/\/$/, '');
  const params = new URLSearchParams({
    type: 'domain_organic',
    key,
    domain,
    database: semrushDatabase(input.countryCode),
    display_limit: String(limit),
    display_sort: 'tr_desc',
    export_columns: 'Ph,Po,Nq,Cp,Tr',
  });
  const response = await axios.get(`${base}/?${params.toString()}`, {
    timeout: 60000,
    responseType: 'text',
    validateStatus: () => true,
  });
  const body = typeof response.data === 'string' ? response.data : String(response.data ?? '');
  if (response.status >= 300) {
    throw new Error(body.slice(0, 200) || `Semrush HTTP ${response.status}`);
  }
  if (/^ERROR/i.test(body.trim())) {
    throw new Error(body.trim().split(/\r?\n/)[0] || 'Semrush 返回错误');
  }
  return parseSemrushCsv(body);
}

/**
 * 解析 Semrush 导出的 CSV（首行为列名）。
 */
export function parseSemrushCsv(csv: string): SemrushKeywordRow[] {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(';').map((item) => item.trim());
  const indexOf = (name: string) => header.findIndex((item) => item.toLowerCase() === name.toLowerCase());
  const ph = indexOf('Keyword') >= 0 ? indexOf('Keyword') : indexOf('Ph');
  const po = indexOf('Position') >= 0 ? indexOf('Position') : indexOf('Po');
  const nq = indexOf('Search Volume') >= 0 ? indexOf('Search Volume') : indexOf('Nq');
  const cp = indexOf('CPC') >= 0 ? indexOf('CPC') : indexOf('Cp');
  const tr = indexOf('Traffic (%)') >= 0 ? indexOf('Traffic (%)') : indexOf('Tr');
  if (ph < 0) return [];
  const rows: SemrushKeywordRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(';');
    const keyword = (cols[ph] ?? '').trim();
    if (!keyword) continue;
    rows.push({
      keyword,
      position: numOrNull(cols[po]),
      searchVolume: numOrNull(cols[nq]),
      cpc: numOrNull(cols[cp]),
      traffic: numOrNull(cols[tr]),
    });
  }
  return rows;
}

function numOrNull(value: string | undefined): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
