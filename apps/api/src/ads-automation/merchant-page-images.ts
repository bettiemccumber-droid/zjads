import { spawn } from 'child_process';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { Readable } from 'stream';
import axios from 'axios';

export interface MerchantPageImage {
  url: string;
  alt: string;
}

const MAX_IMAGES = 12;
const MAX_HTML_BYTES = 1_500_000;

/**
 * 打开商家网页，抽出可放进文章的图片地址。不访问内网地址。
 */
export async function crawlMerchantImages(pageUrl: string): Promise<{ pageUrl: string; images: MerchantPageImage[] }> {
  const { html, finalUrl } = await fetchMerchantHtml(pageUrl);
  return { pageUrl: finalUrl, images: extractMerchantImages(html, finalUrl) };
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
    const url = resolveImageUrl(raw, baseUrl);
    if (!url || seen.has(url) || !isUsableImage(url)) return;
    seen.add(url);
    const image = { url, alt: decodeHtml(alt).replace(/\s+/g, ' ').trim().slice(0, 120) };
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
      || largestSrcset(attr(tag, 'srcset') || attr(tag, 'data-srcset'));
    push(src, attr(tag, 'alt'));
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

/**
 * 先直接请求。页面很大时保留前面一段，里面通常已经有主图。
 * 被验证页拦住时再改用系统 curl。
 */
async function requestMerchantPage(url: string): Promise<PageResponse> {
  let response = emptyPage();
  try {
    const viaAxios = await axios.get(url, {
      timeout: 15000,
      maxRedirects: 0,
      responseType: 'stream',
      headers: PAGE_HEADERS,
      validateStatus: () => true,
    });
    response = {
      status: viaAxios.status,
      headers: viaAxios.headers as PageResponse['headers'],
      data: await readLimitedStream(viaAxios.data as Readable),
    };
  } catch {
    response = emptyPage();
  }
  if (isRedirect(response.status) || (pageLooksUsable(response) && !isBotChallenge(response.status, response.data))) {
    return response;
  }
  return requestMerchantPageWithCurl(url);
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
 * 读到上限就停，不把超长页面当成失败。
 * @param {Readable} stream
 */
function readLimitedStream(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8').slice(0, MAX_HTML_BYTES));
    };
    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size >= MAX_HTML_BYTES) {
        stream.destroy();
        finish();
      }
    });
    stream.on('end', finish);
    stream.on('error', () => {
      if (chunks.length) finish();
      else reject(new Error('商家页面没有打开'));
    });
  });
}

/**
 * 验证页不是商家内容，不能从里面挑图片。
 */
function isBotChallenge(status: number, body: string): boolean {
  if (status !== 403 && status !== 503 && status !== 429) return false;
  return /Just a moment|cf-browser-verification|challenge-platform|Attention Required/i.test(body);
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
  return /(apple-pay|google-pay|visa|mastercard|klarna|adyen|paypal|payment|badge|icon|logo|sprite|placeholder|blank)/.test(text);
}

function isUsableImage(url: string): boolean {
  const lower = url.toLowerCase();
  if (/\.(svg|ico)(\?|$)/.test(lower)) return false;
  return !/(sprite|spacer|pixel|1x1|blank\.gif|favicon|analytics|doubleclick|googletagmanager|facebook\.com\/tr|bat\.bing)/.test(lower);
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
