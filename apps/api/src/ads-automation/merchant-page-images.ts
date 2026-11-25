import { spawn } from 'child_process';
import { lookup } from 'dns/promises';
import http from 'http';
import https from 'https';
import { isIP } from 'net';
import axios from 'axios';

export interface MerchantPageImage {
  url: string;
  alt: string;
}

export interface MerchantImageSource {
  kind: 'site' | 'social' | 'search';
  url: string;
  imageCount: number;
}

/** 首页导航里抽出的同站内链，用来给站内链接分配不同落地页。 */
export interface MerchantNavLink {
  url: string;
  label: string;
}

const MAX_IMAGES = 40;
const MAX_DEEP_PAGES = 10;
const MAX_SOCIAL_PAGES = 4;
const MAX_SEARCH_IMAGES = 10;
const MAX_NAV_LINKS = 40;
const MAX_HTML_BYTES = 1_500_000;

/**
 * 打开商家网页，抽出可放进文章的图片地址。不访问内网地址。
 * 多源：官网深爬 + 首页发现的社媒主页 + 可选 Google CSE 按域名搜图。
 * 探测：验活优先，再用未验活候选填满额度，避免只剩几张。
 */
export async function crawlMerchantImages(
  pageUrl: string,
  options: { deep?: boolean; social?: boolean; search?: boolean } = {},
): Promise<{ pageUrl: string; images: MerchantPageImage[]; sources: MerchantImageSource[] }> {
  const { html, finalUrl } = await fetchMerchantHtml(pageUrl);
  const extracted = extractMerchantImages(html, finalUrl);
  const seen = new Set(extracted.map((item) => item.url));
  let siteCount = extracted.length;

  const pushUnique = (image: MerchantPageImage) => {
    if (seen.has(image.url) || extracted.length >= MAX_IMAGES) return false;
    seen.add(image.url);
    extracted.push(image);
    return true;
  };

  if (options.deep !== false) {
    const links = prioritizeDeepLinks(extractMerchantNavLinks(html, finalUrl)).slice(0, MAX_DEEP_PAGES);
    for (const link of links) {
      if (extracted.length >= MAX_IMAGES) break;
      try {
        const nested = await fetchMerchantHtml(link.url);
        for (const image of extractMerchantImages(nested.html, nested.finalUrl)) {
          if (pushUnique(image)) siteCount += 1;
        }
      } catch {
        // 内页失败不影响首页图
      }
    }
  }

  const sources: MerchantImageSource[] = [{ kind: 'site', url: finalUrl, imageCount: siteCount }];

  if (options.social !== false) {
    for (const social of extractSocialProfileLinks(html, finalUrl).slice(0, MAX_SOCIAL_PAGES)) {
      if (extracted.length >= MAX_IMAGES) break;
      let added = 0;
      try {
        const nested = await fetchMerchantHtml(social.url);
        for (const image of extractMerchantImages(nested.html, nested.finalUrl)) {
          if (pushUnique(image)) added += 1;
        }
      } catch {
        // 社媒拦爬则跳过
      }
      if (added) sources.push({ kind: 'social', url: social.url, imageCount: added });
    }
  }

  if (options.search !== false) {
    const searchHits = await searchGoogleImagesByDomain(finalUrl, MAX_SEARCH_IMAGES);
    let searchAdded = 0;
    for (const image of searchHits) {
      if (pushUnique(image)) searchAdded += 1;
    }
    if (searchAdded) {
      try {
        sources.push({ kind: 'search', url: new URL(finalUrl).hostname, imageCount: searchAdded });
      } catch {
        sources.push({ kind: 'search', url: finalUrl, imageCount: searchAdded });
      }
    }
  }

  const images = await probeMerchantImages(extracted, MAX_IMAGES);
  return { pageUrl: finalUrl, images, sources };
}

/** 商品/分类向内链优先，再按路径深度。 */
export function prioritizeDeepLinks(links: MerchantNavLink[]): MerchantNavLink[] {
  return [...links]
    .filter((link) => !isNoiseNavPath(safePathname(link.url)))
    .sort((a, b) => productPathScore(b.url) - productPathScore(a.url) || navDepth(a.url) - navDepth(b.url) || a.url.localeCompare(b.url));
}

function productPathScore(url: string): number {
  const path = safePathname(url).toLowerCase();
  if (/(product|collection|shop|catalog|category|store|item|goods)/i.test(path)) return 3;
  if (/(new|sale|best|featured|arrival)/i.test(path)) return 2;
  return 0;
}

/**
 * 从首页抽出品牌社媒主页（Instagram / Facebook / X / LinkedIn）。
 */
export function extractSocialProfileLinks(html: string, baseUrl: string): MerchantNavLink[] {
  const byHost = new Map<string, MerchantNavLink>();
  for (const tag of tags(html, 'a')) {
    const href = attr(tag, 'href').trim();
    if (!href || href.startsWith('#') || /^(mailto:|tel:|javascript:)/i.test(href)) continue;
    let absolute: URL;
    try {
      absolute = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') continue;
    const host = normalizeHost(absolute.hostname);
    const kind = socialKind(host, absolute.pathname);
    if (!kind) continue;
    absolute.hash = '';
    const label = decodeHtml(stripTags(tag)).replace(/\s+/g, ' ').trim().slice(0, 80) || kind;
    const key = `${kind}:${absolute.pathname.replace(/\/+$/, '').toLowerCase()}`;
    if (!byHost.has(key)) byHost.set(key, { url: absolute.toString(), label });
  }
  return [...byHost.values()].slice(0, MAX_SOCIAL_PAGES);
}

function socialKind(host: string, pathname: string): string | null {
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) {
    if (/^\/(p|reel|tv|stories)\b/i.test(pathname)) return null;
    return 'instagram';
  }
  if (host === 'facebook.com' || host === 'fb.com' || host.endsWith('.facebook.com')) {
    if (/^\/(sharer|dialog|plugins)\b/i.test(pathname)) return null;
    return 'facebook';
  }
  if (host === 'x.com' || host === 'twitter.com' || host.endsWith('.twitter.com')) {
    if (/^\/(intent|share|home)\b/i.test(pathname)) return null;
    return 'x';
  }
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) {
    if (!/^\/company\//i.test(pathname)) return null;
    return 'linkedin';
  }
  return null;
}

/**
 * Google Programmable Search 图片搜索 site:域名。未配置 CSE 时返回空。
 */
export async function searchGoogleImagesByDomain(pageUrl: string, limit = MAX_SEARCH_IMAGES): Promise<MerchantPageImage[]> {
  const key = (process.env.GOOGLE_CSE_API_KEY || '').trim();
  const cx = (process.env.GOOGLE_CSE_CX || '').trim();
  if (!key || !cx) return [];
  let domain = '';
  try {
    domain = normalizeHost(new URL(pageUrl).hostname);
  } catch {
    return [];
  }
  if (!domain) return [];
  try {
    const res = await axios.get<{
      items?: Array<{ link?: string; title?: string; image?: { contextLink?: string } }>;
    }>('https://www.googleapis.com/customsearch/v1', {
      timeout: 12000,
      params: {
        key,
        cx,
        q: `site:${domain}`,
        searchType: 'image',
        num: Math.min(10, Math.max(1, limit)),
        safe: 'active',
      },
      validateStatus: () => true,
    });
    if (res.status < 200 || res.status >= 300) return [];
    const out: MerchantPageImage[] = [];
    const seen = new Set<string>();
    for (const item of res.data.items ?? []) {
      const url = (item.link || '').trim();
      if (!url || seen.has(url) || !isUsableImage(url)) continue;
      seen.add(url);
      out.push({ url, alt: (item.title || '').slice(0, 120) });
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

function safePathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

/**
 * 打开商家首页，抽出同站内链（带锚文本）。抓取失败时返回空列表，不阻断生成。
 */
export async function crawlMerchantNavLinks(pageUrl: string): Promise<MerchantNavLink[]> {
  const { pageLinks } = await crawlMerchantAdContext(pageUrl);
  return pageLinks;
}

/**
 * 一次抓取：站内链接 + 页面文本线索（供节日证据检测）。
 * siteScan=failed 只表示抓取失败，不能据此断定商家未做活动。
 */
export async function crawlMerchantAdContext(pageUrl: string): Promise<{
  pageLinks: MerchantNavLink[];
  pageTextHints: string[];
  siteScan: 'ok' | 'failed';
}> {
  try {
    const { html, finalUrl } = await fetchMerchantHtml(pageUrl);
    const pageLinks = extractMerchantNavLinks(html, finalUrl);
    const pageTextHints = extractPageTextHints_(html, pageLinks);
    return { pageLinks, pageTextHints, siteScan: 'ok' };
  } catch {
    return { pageLinks: [], pageTextHints: [], siteScan: 'failed' };
  }
}

function extractPageTextHints_(html: string, pageLinks: MerchantNavLink[]): string[] {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeHtml(stripTags(titleMatch[1])).trim() : '';
  const metaBits: string[] = [];
  for (const tag of tags(html, 'meta')) {
    const name = `${attr(tag, 'name')} ${attr(tag, 'property')}`.toLowerCase();
    if (!/(description|og:title|og:description|twitter:title|twitter:description|keywords)/i.test(name)) continue;
    const content = decodeHtml(attr(tag, 'content')).trim();
    if (content) metaBits.push(content);
  }
  const bodyText = decodeHtml(stripTags(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 5000);
  return [
    title,
    ...metaBits.slice(0, 8),
    bodyText,
    ...pageLinks.map((item) => `${item.label} ${safePathname(item.url)}`),
  ].filter(Boolean);
}

/**
 * 从 HTML 抽出同主机内链。单测用，不发起请求。
 */
export function extractMerchantNavLinks(html: string, baseUrl: string): MerchantNavLink[] {
  let home: URL;
  try {
    home = new URL(baseUrl);
  } catch {
    return [];
  }
  const homeHost = normalizeHost(home.hostname);
  const homeKey = pageKey(home);
  const byUrl = new Map<string, MerchantNavLink>();

  for (const tag of tags(html, 'a')) {
    const href = attr(tag, 'href').trim();
    if (!href || href.startsWith('#') || /^(mailto:|tel:|javascript:)/i.test(href)) continue;
    let absolute: URL;
    try {
      absolute = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') continue;
    if (normalizeHost(absolute.hostname) !== homeHost) continue;
    absolute.hash = '';
    if (pageKey(absolute) === homeKey) continue;
    if (isNoiseNavPath(absolute.pathname)) continue;
    const label = decodeHtml(stripTags(tag)).replace(/\s+/g, ' ').trim().slice(0, 80);
    const url = absolute.toString();
    const existing = byUrl.get(url);
    if (!existing || (label && label.length > existing.label.length)) {
      byUrl.set(url, { url, label });
    }
  }

  return [...byUrl.values()]
    .sort((a, b) => navDepth(a.url) - navDepth(b.url) || a.url.localeCompare(b.url))
    .slice(0, MAX_NAV_LINKS);
}

function navDepth(url: string): number {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).length;
  } catch {
    return 99;
  }
}

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

function pageKey(url: URL): string {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  return `${normalizeHost(url.hostname)}${path.toLowerCase()}`;
}

function isNoiseNavPath(pathname: string): boolean {
  const path = pathname.toLowerCase();
  return /(\.(jpg|jpeg|png|gif|webp|svg|pdf|css|js|zip|xml)$|\/(cart|checkout|login|signin|signup|account|wishlist|cdn-cgi)\b)/i.test(path);
}

function stripTags(tag: string): string {
  const inner = tag.replace(/^<a\b[^>]*>/i, '').replace(/<\/a\s*>$/i, '');
  return inner.replace(/<[^>]+>/g, ' ');
}

/**
 * 从已经拿到的 HTML 里挑图片。单测用，不发起请求。
 */
export function extractMerchantImages(html: string, baseUrl: string): MerchantPageImage[] {
  const source = html
    .replace(/\\\//g, '/')
    .replace(/\\u002f/gi, '/')
    .replace(/\\"/g, '"');
  const images: MerchantPageImage[] = [];
  const weak: MerchantPageImage[] = [];
  const seen = new Set<string>();

  const push = (raw: string, alt: string) => {
    if (looksLikeScriptNoise(raw) || looksLikeScriptNoise(alt)) return;
    const url = resolveImageUrl(raw, baseUrl);
    if (!url || seen.has(url) || !isUsableImage(url)) return;
    seen.add(url);
    const image = { url, alt: decodeHtml(alt).replace(/\s+/g, ' ').trim().slice(0, 120) };
    if (looksLikeScriptNoise(image.alt)) image.alt = '';
    const bucket = isWeakImage(url, image.alt) ? weak : images;
    if (bucket.length < MAX_IMAGES) bucket.push(image);
  };

  for (const tag of tags(source, 'meta')) {
    const key = `${attr(tag, 'property')} ${attr(tag, 'name')}`.toLowerCase();
    if (!/(og:image|twitter:image)/.test(key) || /width|height|type|alt/.test(key)) continue;
    push(attr(tag, 'content'), '');
  }

  for (const tag of tags(source, 'link')) {
    const rel = attr(tag, 'rel').toLowerCase();
    if (rel !== 'image_src' && !rel.includes('preload')) continue;
    if (rel.includes('preload') && attr(tag, 'as').toLowerCase() !== 'image') continue;
    push(attr(tag, 'href'), '');
  }

  for (const block of jsonLdBlocks(source)) {
    collectJsonImages(block, (url) => push(url, ''));
  }

  for (const tag of tags(source, 'img')) {
    const width = Number(attr(tag, 'width'));
    const height = Number(attr(tag, 'height'));
    if ((width > 0 && width < 80) || (height > 0 && height < 80)) continue;
    const src = attr(tag, 'src')
      || attr(tag, 'data-src')
      || attr(tag, 'data-original')
      || attr(tag, 'data-lazy-src')
      || attr(tag, 'data-image')
      || attr(tag, 'data-zoom-image')
      || attr(tag, 'data-large')
      || attr(tag, 'data-large_image')
      || largestSrcset(attr(tag, 'srcset') || attr(tag, 'data-srcset'));
    push(src, attr(tag, 'alt'));
  }

  for (const tag of tags(source, 'source')) {
    push(attr(tag, 'src') || largestSrcset(attr(tag, 'srcset')), '');
  }

  for (const match of source.matchAll(/background(?:-image)?\s*:\s*url\(\s*['"]?([^'")\s]+)['"]?\s*\)/gi)) {
    push(match[1] || '', '');
  }

  for (const match of source.matchAll(/(?:https?:)?\/\/[^\s"'()<>]+?\.(?:jpe?g|png|webp)(?:\?[^\s"'()<>]*)?/gi)) {
    push(match[0], '');
  }

  return images.concat(weak).slice(0, MAX_IMAGES);
}

/**
 * 跟着少量跳转抓 HTML。每一跳都重新检查是不是公网地址。
 */
async function fetchMerchantHtml(pageUrl: string): Promise<{ html: string; finalUrl: string }> {
  let current = pageUrl.trim();
  for (let hop = 0; hop < 4; hop += 1) {
    await assertPublicHttpUrl(current);
    const response = await requestMerchantPage(current);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.location;
      if (!location || Array.isArray(location)) throw new Error('商家页面跳转没有目标');
      current = new URL(location, current).toString();
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      if (isBotChallenge(response.status, response.data)) {
        throw new Error('商家页面有人机验证，没有抓到图片');
      }
      throw new Error(`商家页面返回 ${response.status}`);
    }
    const type = String(response.headers['content-type'] || '');
    const htmlLike = /<!doctype|<html|<head/i.test(response.data.slice(0, 800));
    if (type && !/text\/html|application\/xhtml/i.test(type) && !htmlLike) {
      throw new Error('商家页面不是网页');
    }
    const html = typeof response.data === 'string' ? response.data : '';
    return { html: html.slice(0, MAX_HTML_BYTES), finalUrl: current };
  }
  throw new Error('商家页面跳转次数过多');
}

export interface LandingPageProbeResult {
  ok: boolean;
  url: string;
  finalUrl: string;
  status: number;
  message: string;
  /** ok | not_found | blocked | timeout | invalid | redirect | error */
  reason?: string;
}

/**
 * 多方面探测落地页：跟随跳转、识别人机/WAF、区分 404 与拦截，给出可读原因。
 */
export async function probeLandingPageUrl(pageUrl: string): Promise<LandingPageProbeResult> {
  const url = pageUrl.trim();
  if (!url) {
    return { ok: false, url, finalUrl: '', status: 0, message: '网址为空', reason: 'invalid' };
  }
  let current = url;
  try {
    for (let hop = 0; hop < 5; hop += 1) {
      await assertPublicHttpUrl(current);
      const response = await requestMerchantPage(current);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.location;
        if (!location || Array.isArray(location)) {
          return {
            ok: false,
            url,
            finalUrl: current,
            status: response.status,
            message: `跳转失败（HTTP ${response.status}，无 Location）`,
            reason: 'redirect',
          };
        }
        current = new URL(location, current).toString();
        continue;
      }
      if (response.status >= 200 && response.status < 300) {
        if (pageLooksUsable(response) || response.data.length > 0) {
          return {
            ok: true,
            url,
            finalUrl: current,
            status: response.status,
            message: hop > 0 ? `落地页可打开（经 ${hop} 次跳转）` : '落地页可打开',
            reason: 'ok',
          };
        }
        return {
          ok: true,
          url,
          finalUrl: current,
          status: response.status,
          message: '服务器返回成功，但页面内容很少',
          reason: 'ok',
        };
      }
      if (isBotChallenge(response.status, response.data)) {
        return {
          ok: true,
          url,
          finalUrl: current,
          status: response.status,
          message: `疑似人机/WAF 拦截（HTTP ${response.status}），已按可达处理`,
          reason: 'blocked',
        };
      }
      if (response.status === 404 || response.status === 410) {
        return {
          ok: false,
          url,
          finalUrl: current,
          status: response.status,
          message: `页面不存在（HTTP ${response.status}）`,
          reason: 'not_found',
        };
      }
      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          url,
          finalUrl: current,
          status: response.status,
          message: `访问被拒绝（HTTP ${response.status}），可能需登录或 IP 被拦；可人工标记可达`,
          reason: 'blocked',
        };
      }
      if (response.status === 429 || response.status === 503) {
        return {
          ok: false,
          url,
          finalUrl: current,
          status: response.status,
          message: `服务暂不可用或限流（HTTP ${response.status}），稍后重试或人工确认`,
          reason: 'blocked',
        };
      }
      if (!response.status) {
        return {
          ok: false,
          url,
          finalUrl: current,
          status: 0,
          message: '无响应（超时或网络失败）',
          reason: 'timeout',
        };
      }
      return {
        ok: false,
        url,
        finalUrl: current,
        status: response.status,
        message: `打不开（HTTP ${response.status}）`,
        reason: 'error',
      };
    }
    return { ok: false, url, finalUrl: current, status: 0, message: '跳转次数过多', reason: 'redirect' };
  } catch (error) {
    const message = error instanceof Error ? error.message : '探测失败';
    const timeout = /timeout|ETIMEDOUT|ECONNABORTED|exceeded/i.test(message);
    return {
      ok: false,
      url,
      finalUrl: current,
      status: 0,
      message: timeout ? `请求超时：${message}` : message,
      reason: timeout ? 'timeout' : 'error',
    };
  }
}

interface PageResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  data: string;
}

const PAGE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
};

const ipv4Http = new http.Agent({ family: 4 });
const ipv4Https = new https.Agent({ family: 4 });

/**
 * 先用 IPv4 直接请求。页面很大时只保留前面一段。
 * 被验证页拦住、或服务器没有 curl 时，不把已经打开的页面丢掉。
 */
async function requestMerchantPage(url: string): Promise<PageResponse> {
  const first = await requestWithNode(url);
  if (isRedirect(first.status) || (pageLooksUsable(first) && !isBotChallenge(first.status, first.data))) {
    return first;
  }
  try {
    const second = await requestMerchantPageWithCurl(url);
    if (second.data || second.status) return second;
  } catch {
    // 线上镜像不一定有 curl。没有的话沿用第一次的结果。
  }
  if (first.data || first.status) return first;
  throw new Error('商家页面没有打开');
}

/**
 * 走 IPv4。部分服务器优先连 IPv6，商家站连不上就会变成打不开。
 */
async function requestWithNode(url: string): Promise<PageResponse> {
  try {
    const viaAxios = await axios.get<string>(url, {
      timeout: 20000,
      maxRedirects: 0,
      responseType: 'text',
      maxContentLength: 8_000_000,
      maxBodyLength: 8_000_000,
      httpAgent: ipv4Http,
      httpsAgent: ipv4Https,
      headers: PAGE_HEADERS,
      validateStatus: () => true,
    });
    const data = typeof viaAxios.data === 'string' ? viaAxios.data : '';
    return {
      status: viaAxios.status,
      headers: viaAxios.headers as PageResponse['headers'],
      data: data.slice(0, MAX_HTML_BYTES),
    };
  } catch {
    return emptyPage();
  }
}

/**
 * @returns {PageResponse}
 */
function emptyPage(): PageResponse {
  return { status: 0, headers: {}, data: '' };
}

/**
 * @param {number} status
 */
function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

/**
 * 200 且像网页，才拿来抽图片。截断后的长页面也算。
 */
function pageLooksUsable(response: PageResponse): boolean {
  if (response.status < 200 || response.status >= 300 || !response.data) return false;
  const type = String(response.headers['content-type'] || '');
  if (/text\/html|application\/xhtml/i.test(type)) return true;
  return /<!doctype|<html|<head/i.test(response.data.slice(0, 800));
}

/**
 * 常见 CDN / WAF / 人机验证页。命中时探测按「可达」处理（浏览器里通常能过）。
 */
function isBotChallenge(status: number, body: string): boolean {
  if (status !== 401 && status !== 403 && status !== 503 && status !== 429 && status !== 202) {
    return false;
  }
  const sample = (body || '').slice(0, 8000);
  return /Just a moment|cf-browser-verification|challenge-platform|Attention Required|cf-challenge|cloudflare|Enable JavaScript and cookies|Akamai|Access Denied|Request unsuccessful|distil|perimeterx|human.?verification|captcha|hcaptcha|recaptcha|Bot Detection|Security Check|checking your browser|ray id/i.test(sample);
}

/**
 * 用系统 curl 拉取一页，不跟随跳转，地址已经确认过是公网网址。
 */
function requestMerchantPageWithCurl(url: string): Promise<PageResponse> {
  return new Promise((resolve, reject) => {
    const bin = process.platform === 'win32' ? 'curl.exe' : 'curl';
    const child = spawn(bin, [
      '-sS',
      '-D', '-',
      '--ipv4',
      '--compressed',
      '--max-redirs', '0',
      '--max-time', '15',
      '-A', PAGE_HEADERS['User-Agent'],
      '-H', `Accept: ${PAGE_HEADERS.Accept}`,
      '-H', `Accept-Language: ${PAGE_HEADERS['Accept-Language']}`,
      url,
    ], { windowsHide: true });
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_HTML_BYTES + 8192) {
        child.kill();
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', () => reject(new Error('商家页面没有打开')));
    child.on('close', (code) => {
      if (code && !chunks.length) {
        reject(new Error(stderr.trim() ? '商家页面没有打开' : '商家页面没有打开'));
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      const splitAt = raw.search(/\r?\n\r?\n/);
      const headerText = splitAt >= 0 ? raw.slice(0, splitAt) : raw;
      const body = splitAt >= 0 ? raw.slice(splitAt).replace(/^\r?\n\r?\n/, '') : '';
      const status = Number(headerText.match(/\s(\d{3})/)?.[1] || 0);
      const headers: Record<string, string> = {};
      for (const line of headerText.split(/\r?\n/).slice(1)) {
        const index = line.indexOf(':');
        if (index > 0) headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
      }
      resolve({ status, headers, data: body.slice(0, MAX_HTML_BYTES) });
    });
  });
}

/**
 * 只允许 http(s) 的公网主机。内网、本机和云元数据地址直接拒绝。
 */
async function assertPublicHttpUrl(value: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('商家网址无法打开');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('商家网址需要以 http 或 https 开头');
  }
  if (url.username || url.password) throw new Error('这个网址不能抓取');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('这个网址不能抓取');
  }
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('这个网址不能抓取');
    return;
  }
  let records;
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error('商家网址没有解析到地址');
  }
  if (!records.length || records.some((record) => isPrivateAddress(record.address))) {
    throw new Error('这个网址不能抓取');
  }
}

/**
 * @param {string} address
 */
function isPrivateAddress(address: string): boolean {
  const ip = address.toLowerCase();
  const v4 = ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
  if (v4.includes('.')) {
    const parts = v4.split('.').map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
    const [a, b, c] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && (b === 168 || (b === 0 && c === 2))) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && b === 51 && c === 100) return true;
    if (a === 203 && b === 0 && c === 113) return true;
    if (a >= 224) return true;
    return false;
  }
  if (ip === '::' || ip === '::1') return true;
  return ip.startsWith('fc') || ip.startsWith('fd') || /^fe[89ab]/.test(ip);
}

/**
 * @param {string} raw
 * @param {string} baseUrl
 */
function resolveImageUrl(raw: string, baseUrl: string): string {
  const value = decodeHtml(raw).trim();
  if (!value || value.startsWith('data:') || value.startsWith('blob:')) return '';
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

/**
 * @param {string} url
 */
/**
 * 支付图标和站标留到最后，避免把商品图挤掉。
 */
function isWeakImage(url: string, alt: string): boolean {
  const text = `${url} ${alt}`.toLowerCase();
  // logo 不一定弱：og/hero 常带 brand，只有明显支付/图标类才后置
  return /(apple-pay|google-pay|visa|mastercard|klarna|adyen|paypal|payment|badge|icon|sprite|placeholder|blank|favicon)/.test(text);
}

function isUsableImage(url: string): boolean {
  const lower = url.toLowerCase();
  if (looksLikeScriptNoise(url)) return false;
  if (/\.(svg|ico|gif)(\?|$)/.test(lower)) return false;
  if (!/\.(jpe?g|png|webp)(\?|$)/i.test(lower) && !/(cdn|images?|img|media|static|assets?|cloudinary|shopify|imgix)\//i.test(lower)) {
    return false;
  }
  return !/(sprite|spacer|pixel|1x1|blank\.gif|favicon|analytics|doubleclick|googletagmanager|facebook\.com\/tr|bat\.bing)/.test(lower);
}

/**
 * 页面 JS/模板字符串误进 src/alt 时丢掉。
 */
export function looksLikeScriptNoise(value: string): boolean {
  const text = (value || '').trim();
  if (!text) return false;
  if (/\$\{|`|\bvoid\s+0\b|\bnull\s*\?|=>|function\s*\(/.test(text)) return true;
  if (/[{}]/.test(text) && /[=;]/.test(text)) return true;
  return false;
}

/**
 * 探测候选图是否真能打开。有验活成功的优先返回；
 * 若 CDN 拦掉服务端请求导致全部失败，则回退到字符串过滤结果，交给前端再剔裂图。
 */
export async function probeMerchantImages(
  candidates: MerchantPageImage[],
  limit = MAX_IMAGES,
): Promise<MerchantPageImage[]> {
  const filtered = candidates.filter((item) => !looksLikeScriptNoise(item.url) && isUsableImage(item.url));
  const alive: MerchantPageImage[] = [];
  const aliveUrls = new Set<string>();
  for (const item of filtered) {
    if (alive.length >= limit) break;
    try {
      await assertPublicHttpUrl(item.url);
      if (await imageUrlLooksAlive(item.url)) {
        alive.push(item);
        aliveUrls.add(item.url);
      }
    } catch {
      // 单张失败不影响其它图
    }
  }
  // 验活优先，再用未验活候选填满，避免 CDN 只放过几张时列表过短。
  const filled = [...alive];
  for (const item of filtered) {
    if (filled.length >= limit) break;
    if (aliveUrls.has(item.url)) continue;
    filled.push(item);
  }
  return filled;
}

async function imageUrlLooksAlive(url: string): Promise<boolean> {
  try {
    const head = await axios.head(url, {
      timeout: 8000,
      maxRedirects: 3,
      httpAgent: ipv4Http,
      httpsAgent: ipv4Https,
      headers: { ...PAGE_HEADERS, Accept: 'image/*,*/*;q=0.8' },
      validateStatus: () => true,
    });
    if (head.status >= 200 && head.status < 400) {
      const type = String(head.headers['content-type'] || '');
      if (/^image\//i.test(type)) return true;
      if (!type && /\.(jpe?g|png|webp)(\?|$)/i.test(url)) return true;
    }
  } catch {
    // HEAD 常被拒，再试短 GET
  }
  try {
    const get = await axios.get(url, {
      timeout: 10000,
      maxRedirects: 3,
      responseType: 'arraybuffer',
      maxContentLength: 2_000_000,
      httpAgent: ipv4Http,
      httpsAgent: ipv4Https,
      headers: { ...PAGE_HEADERS, Accept: 'image/*,*/*;q=0.8', Range: 'bytes=0-2047' },
      validateStatus: () => true,
    });
    if (get.status < 200 || get.status >= 400) return false;
    const type = String(get.headers['content-type'] || '');
    if (/^image\//i.test(type)) return true;
    const buf = Buffer.isBuffer(get.data) ? get.data : Buffer.from(get.data);
    return isImageMagic(buf);
  } catch {
    return false;
  }
}

function isImageMagic(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true; // jpeg
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true; // png
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return true;
  return false;
}

/**
 * @param {string} html
 * @param {string} name
 */
function tags(html: string, name: string): string[] {
  return html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) ?? [];
}

/**
 * @param {string} tag
 * @param {string} name
 */
function attr(tag: string, name: string): string {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return (match?.[1] ?? match?.[2] ?? '').trim();
}

/**
 * @param {string} srcset
 */
function largestSrcset(srcset: string): string {
  let best = '';
  let bestWidth = -1;
  for (const part of srcset.split(',')) {
    const bits = part.trim().split(/\s+/);
    const url = bits[0] || '';
    const width = Number((bits[1] || '').replace(/w$/i, ''));
    const score = Number.isFinite(width) && width > 0 ? width : 0;
    if (!best || score >= bestWidth) {
      best = url;
      bestWidth = score;
    }
  }
  return best;
}

/**
 * @param {string} html
 */
function jsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const pattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      blocks.push(JSON.parse(match[1]));
    } catch {
      // 坏掉的结构化数据跳过，页面上的 img 仍可用。
    }
  }
  return blocks;
}

/**
 * @param {unknown} value
 * @param {(url: string) => void} push
 */
function collectJsonImages(value: unknown, push: (url: string) => void): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectJsonImages(item, push));
    return;
  }
  const record = value as Record<string, unknown>;
  const image = record.image;
  if (typeof image === 'string') push(image);
  else if (Array.isArray(image)) {
    image.forEach((item) => {
      if (typeof item === 'string') push(item);
      else if (item && typeof item === 'object' && typeof (item as { url?: unknown }).url === 'string') {
        push((item as { url: string }).url);
      }
    });
  } else if (image && typeof image === 'object' && typeof (image as { url?: unknown }).url === 'string') {
    push((image as { url: string }).url);
  }
  if (record['@type'] === 'ImageObject' && typeof record.url === 'string') push(record.url);
  if (Array.isArray(record['@graph'])) collectJsonImages(record['@graph'], push);
}

/**
 * @param {string} value
 */
function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
