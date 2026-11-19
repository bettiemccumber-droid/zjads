import axios from 'axios';
import http from 'http';
import https from 'https';

const ipv4Http = new http.Agent({ family: 4 });
const ipv4Https = new https.Agent({ family: 4 });

export interface PreparedAdImage {
  name: string;
  data: string;
  width: number;
  height: number;
  square: boolean;
}

/**
 * 代理下载公网图片，供前端 canvas 裁切（绕过跨域污染）。
 */
export async function fetchPublicImageBuffer(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) throw new Error('图片地址无效');
  const response = await axios.get<ArrayBuffer>(trimmed, {
    timeout: 15000,
    responseType: 'arraybuffer',
    maxContentLength: 5_500_000,
    maxRedirects: 3,
    httpAgent: ipv4Http,
    httpsAgent: ipv4Https,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; zjads-ad-images/1.0)',
      Accept: 'image/jpeg,image/png,image/webp,*/*;q=0.8',
    },
    validateStatus: (status) => status >= 200 && status < 400,
  });
  const buffer = Buffer.from(response.data);
  if (buffer.length < 100 || buffer.length > 5_242_880) throw new Error('图片过大或无效');
  const headerType = String(response.headers['content-type'] || '').split(';')[0].trim();
  const contentType = /^image\//i.test(headerType) ? headerType : (sniffMime(buffer) || 'application/octet-stream');
  return { buffer, contentType };
}

/**
 * 下载广告图并转成 Google Ads imageAsset.data（base64）。
 * 优先保留正方形；最多 20 张；单张 ≤ 5MB。
 */
export async function prepareAdImageAssets(urls: string[]): Promise<PreparedAdImage[]> {
  const unique = [...new Set(
    urls.map((url) => url.trim()).filter((url) => /^https?:\/\//i.test(url) || /^data:image\/(?:jpeg|png);base64,/i.test(url)),
  )].slice(0, 20);
  const prepared: PreparedAdImage[] = [];
  for (const [index, url] of unique.entries()) {
    try {
      const row = url.startsWith('data:image/')
        ? fromDataUrl(url, index)
        : await downloadAdImage(url, index);
      if (row) prepared.push(row);
    } catch {
      // 单张失败不阻断其它图
    }
  }
  const squares = prepared.filter((item) => item.square);
  const rest = prepared.filter((item) => !item.square);
  return [...squares, ...rest].slice(0, 20);
}

function fromDataUrl(dataUrl: string, index: number): PreparedAdImage | null {
  const match = dataUrl.match(/^data:image\/(jpeg|png);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const buf = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (buf.length < 100 || buf.length > 5_242_880) return null;
  const dims = readImageSize(buf);
  if (!dims || dims.width < 300 || dims.height < 300) return null;
  const ratio = dims.width / dims.height;
  return {
    name: `ad-image-square-${index + 1}`,
    data: buf.toString('base64'),
    width: dims.width,
    height: dims.height,
    square: ratio >= 0.9 && ratio <= 1.11,
  };
}

async function downloadAdImage(url: string, index: number): Promise<PreparedAdImage | null> {
  const response = await axios.get<ArrayBuffer>(url, {
    timeout: 15000,
    responseType: 'arraybuffer',
    maxContentLength: 5_500_000,
    maxRedirects: 3,
    httpAgent: ipv4Http,
    httpsAgent: ipv4Https,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; zjads-ad-images/1.0)',
      Accept: 'image/jpeg,image/png,image/webp,*/*;q=0.8',
    },
    validateStatus: (status) => status >= 200 && status < 400,
  });
  const buf = Buffer.from(response.data);
  if (buf.length < 100 || buf.length > 5_242_880) return null;
  const type = String(response.headers['content-type'] || '');
  const dims = readImageSize(buf);
  if (!dims) return null;
  if (dims.width < 300 || dims.height < 300) return null;
  const mime = /^image\/(png|jpeg|jpg|webp)/i.test(type)
    ? type.toLowerCase().replace('jpg', 'jpeg')
    : sniffMime(buf);
  if (!mime) return null;
  // Google AD_IMAGE 更稳妥用 jpeg/png；webp 若嗅探到也尝试（API 可能拒）
  if (mime === 'image/webp') return null;
  const ratio = dims.width / dims.height;
  const square = ratio >= 0.9 && ratio <= 1.11;
  return {
    name: `ad-image-${index + 1}`,
    data: buf.toString('base64'),
    width: dims.width,
    height: dims.height,
    square,
  };
}

function sniffMime(buf: Buffer): string | null {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

function readImageSize(buf: Buffer): { width: number; height: number } | null {
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf.length >= 24) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) break;
      const marker = buf[offset + 1];
      const size = buf.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3) {
        return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
      }
      offset += 2 + size;
    }
  }
  return null;
}
