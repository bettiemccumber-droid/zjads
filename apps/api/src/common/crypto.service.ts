import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * 渠道凭证 AES-256-GCM 加解密
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const hex = config.get<string>('CREDENTIALS_ENCRYPTION_KEY') ?? '';
    if (hex.length !== 64) {
      throw new Error('CREDENTIALS_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
    }
    this.key = Buffer.from(hex, 'hex');
  }

  encrypt(plain: object): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const text = JSON.stringify(plain);
    const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
  }

  decrypt<T extends object>(payload: string): T {
    const buf = Buffer.from(payload, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    return JSON.parse(dec) as T;
  }

  maskToken(token: string): string {
    if (!token || token.length < 4) return '****';
    return `****${token.slice(-4)}`;
  }
}
