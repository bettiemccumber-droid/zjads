/** 平台正式域名。OAuth 首页和隐私政策都使用这个来源。 */
export const PLATFORM_ORIGIN = 'https://zjads.top';

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
