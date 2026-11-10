/**
 * Google Ads API 申请使用的产品站。
 * 公司官网是另一个域名，不写进这里。
 */
export const PLATFORM_ORIGIN = 'https://www.zjads.top';

/**
 * 把当前公开页的规范地址写成平台域名，避免爬虫把 Railway 子域名当成首页。
 */
export function setCanonical(path: string): void {
  const href = `${PLATFORM_ORIGIN}${path}`;
  let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'canonical';
    document.head.appendChild(link);
  }
  link.href = href;
}
