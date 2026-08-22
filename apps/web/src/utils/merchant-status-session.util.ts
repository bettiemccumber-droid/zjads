/** 浏览器 session 缓存版本（结构变更时递增） */
const CACHE_VERSION = 1;

/** 缓存有效期（毫秒），超时后不再恢复 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const KEY_PREFIX = 'zjads:merchant-status';

/** 可序列化的查询结果摘要 */
export interface MerchantStatusSessionSummary {
  total: number;
  actionable: number;
  pending: number;
  rejected: number;
  notJoined: number;
  notFound: number;
  offline: number;
  unknown: number;
  failed: number;
}

/** 可序列化的查询行（JSON 往返，读取时在页面侧断言为 MerchantStatusRow） */
export type MerchantStatusSessionRow = unknown;

export interface MerchantStatusSessionCache {
  version: typeof CACHE_VERSION;
  savedAt: string;
  activeTab: string;
  singleInput: string;
  pasteText: string;
  parsedPreview: Array<{ merchantId?: string; mcid?: string; domain?: string }>;
  selectedAccountIds: number[];
  relationshipFilters: string[];
  rows: MerchantStatusSessionRow[];
  summary: MerchantStatusSessionSummary | null;
  adminSummary?: unknown[];
  adminGrandTotal?: MerchantStatusSessionSummary | null;
  selectedEmployeeIds?: number[];
}

/**
 * 生成 sessionStorage 键（按登录用户 + 查询对象区分，避免串数据）
 */
export function merchantStatusSessionKey(
  loginUserId: number,
  viewUserId?: number,
): string {
  const scope = viewUserId != null ? `view-${viewUserId}` : 'self';
  return `${KEY_PREFIX}:v${CACHE_VERSION}:${loginUserId}:${scope}`;
}

/**
 * 读取上次商家状态查询缓存（仅 sessionStorage，不写数据库）
 */
export function loadMerchantStatusSession(
  loginUserId: number,
  viewUserId?: number,
): MerchantStatusSessionCache | null {
  try {
    const raw = sessionStorage.getItem(merchantStatusSessionKey(loginUserId, viewUserId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MerchantStatusSessionCache;
    if (parsed.version !== CACHE_VERSION) return null;
    const age = Date.now() - new Date(parsed.savedAt).getTime();
    if (!Number.isFinite(age) || age > CACHE_TTL_MS) {
      sessionStorage.removeItem(merchantStatusSessionKey(loginUserId, viewUserId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 写入商家状态查询缓存
 */
export function saveMerchantStatusSession(
  loginUserId: number,
  viewUserId: number | undefined,
  payload: Omit<MerchantStatusSessionCache, 'version' | 'savedAt'>,
): void {
  try {
    const data: MerchantStatusSessionCache = {
      version: CACHE_VERSION,
      savedAt: new Date().toISOString(),
      ...payload,
    };
    sessionStorage.setItem(
      merchantStatusSessionKey(loginUserId, viewUserId),
      JSON.stringify(data),
    );
  } catch {
    /* 存储满或隐私模式时静默失败，不影响查询 */
  }
}

/**
 * 清除商家状态查询缓存
 */
export function clearMerchantStatusSession(
  loginUserId: number,
  viewUserId?: number,
): void {
  try {
    sessionStorage.removeItem(merchantStatusSessionKey(loginUserId, viewUserId));
  } catch {
    /* ignore */
  }
}
