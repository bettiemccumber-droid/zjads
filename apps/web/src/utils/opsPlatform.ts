/**
 * 运营名单平台码：导入归一 + 界面简称。
 * 违规 / 推荐共用，避免一边显示 CG、一边还是 chuizhan_cg。
 */

/** 表内写法 → 系统 platformCode */
export const OPS_PLATFORM_ALIASES: Record<string, string> = {
  linkhaitao: 'linkhaitao',
  lh: 'linkhaitao',
  rewardoo: 'rewardoo',
  rewardme: 'rewardoo',
  rw: 'rewardoo',
  linkbux: 'linkbux',
  linkbuy: 'linkbux',
  lb: 'linkbux',
  partnermatic: 'partnermatic',
  pm: 'partnermatic',
  shoplooks: 'shoplooks',
  shoplookz: 'shoplooks',
  bsh: 'shoplooks',
  collabglow: 'collabglow',
  cg: 'collabglow',
  ultrainfluence: 'ultrainfluence',
  ui: 'ultrainfluence',
  famesta: 'famesta',
  fs: 'famesta',
  chuizhan_lh: 'linkhaitao',
  chuizhanlh: 'linkhaitao',
  chuizhan_rw: 'rewardoo',
  chuizhanrw: 'rewardoo',
  chuizhan_pm: 'partnermatic',
  chuizhanpm: 'partnermatic',
  chuizhan_bsh: 'shoplooks',
  chuizhanbsh: 'shoplooks',
  chuizhan_cg: 'collabglow',
  chuizhancg: 'collabglow',
  chuizhan_ui: 'ultrainfluence',
  chuizhanui: 'ultrainfluence',
  chuizhan_fs: 'famesta',
  chuizhanfs: 'famesta',
};

/** 系统码 → 列表简称 */
export const OPS_PLATFORM_SHORT: Record<string, string> = {
  partnermatic: 'PM',
  rewardoo: 'RW',
  linkhaitao: 'LH',
  linkbux: 'LB',
  ultrainfluence: 'UI',
  collabglow: 'CG',
  famesta: 'FS',
  shoplooks: 'BSH',
};

/**
 * 把 BU / 别名归一成系统 platformCode。
 */
export function normalizeOpsPlatform(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const key = trimmed.toLowerCase().replace(/[\s_\-]/g, '');
  if (OPS_PLATFORM_ALIASES[key]) return OPS_PLATFORM_ALIASES[key];
  const withUnderscore = trimmed.toLowerCase().replace(/\s+/g, '_');
  if (OPS_PLATFORM_ALIASES[withUnderscore]) return OPS_PLATFORM_ALIASES[withUnderscore];
  const lower = trimmed.toLowerCase();
  if (OPS_PLATFORM_ALIASES[lower]) return OPS_PLATFORM_ALIASES[lower];
  return lower.slice(0, 50);
}

/**
 * 列表/筛选用简称：collabglow、chuizhan_cg → CG。
 */
export function opsPlatformShort(code: string): string {
  const key = (code || '').trim().toLowerCase();
  if (!key) return '—';
  const canonical = normalizeOpsPlatform(key);
  if (OPS_PLATFORM_SHORT[canonical]) return OPS_PLATFORM_SHORT[canonical];
  if (OPS_PLATFORM_SHORT[key]) return OPS_PLATFORM_SHORT[key];
  const bu = key.match(/^chuizhan[_-]?([a-z0-9]+)$/);
  if (bu) return bu[1].toUpperCase();
  return canonical.slice(0, 3).toUpperCase();
}
