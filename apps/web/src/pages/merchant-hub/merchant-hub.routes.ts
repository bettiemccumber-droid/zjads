/**
 * 我的商家模块：与竞品「我的商家 + 多 Tab」一致。
 * 新增 Tab：在此注册 enabled，并在 App.tsx 的 merchants 下增加 Route。
 */

export const MERCHANT_HUB_BASE = '/merchants';

export interface MerchantHubTabDef {
  path: string;
  label: string;
  enabled: boolean;
}

/** Tab 顺序（左 → 右） */
export const MERCHANT_HUB_TABS: MerchantHubTabDef[] = [
  { path: 'status', label: '商家状态', enabled: true },
  { path: 'chargebacks', label: '拒付商家', enabled: true },
  // 预留，与竞品对齐时可启用：
  // { path: 'active', label: '活跃商家', enabled: false },
  // { path: 'violations', label: '违规商家', enabled: false },
  // { path: 'recommended', label: '推荐商家', enabled: false },
];

export function merchantHubPath(tabPath: string): string {
  return `${MERCHANT_HUB_BASE}/${tabPath}`;
}

export function enabledMerchantHubTabs(): MerchantHubTabDef[] {
  return MERCHANT_HUB_TABS.filter((t) => t.enabled);
}

/** 侧边栏「我的商家」默认进入第一个 Tab */
export function merchantHubDefaultPath(): string {
  const first = enabledMerchantHubTabs()[0];
  return first ? merchantHubPath(first.path) : MERCHANT_HUB_BASE;
}
