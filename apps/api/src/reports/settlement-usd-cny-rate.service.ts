import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
function roundRate(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

export interface UsdCnyRateQuote {
  rate: number;
  /** 展示用说明（中文） */
  rateNote: string;
  /** 是否来自外部实时接口（false 表示兜底） */
  isLive: boolean;
  source: string;
  /** ISO 8601 */
  fetchedAt: string;
}

interface CacheEntry {
  quote: UsdCnyRateQuote;
  expiresAt: number;
}

/**
 * 结算报表 USD→CNY 汇率：优先拉取公开实时中间价，失败时用环境变量兜底。
 */
@Injectable()
export class SettlementUsdCnyRateService {
  private readonly logger = new Logger(SettlementUsdCnyRateService.name);
  private cache: CacheEntry | null = null;

  /**
   * 获取当前 USD/CNY 汇率（带进程内短缓存，避免报表每次请求都打外部 API）
   * @param forceRefresh 为 true 时跳过缓存并重新拉取
   */
  async getQuote(forceRefresh = false): Promise<UsdCnyRateQuote> {
    const ttlMs = this.resolveCacheTtlMs();
    const now = Date.now();
    if (!forceRefresh && this.cache && this.cache.expiresAt > now) {
      return this.cache.quote;
    }

    const fetchedAt = new Date();
    const live = await this.fetchLiveRate(fetchedAt);
    const quote = live ?? this.buildFallbackQuote(fetchedAt);

    this.cache = {
      quote,
      expiresAt: now + ttlMs,
    };
    return quote;
  }

  private resolveCacheTtlMs(): number {
    const raw = process.env.SETTLEMENT_FX_CACHE_SECONDS;
    const sec = raw ? Number(raw) : 300;
    if (!Number.isFinite(sec) || sec < 30) {
      return 300_000;
    }
    return Math.min(sec, 86_400) * 1000;
  }

  private resolveFallbackRate(): number {
    const raw = process.env.SETTLEMENT_USD_CNY_RATE;
    const n = raw ? Number(raw) : 7.25;
    return Number.isFinite(n) && n > 0 ? n : 7.25;
  }

  private formatFetchedAtShanghai(d: Date): string {
    return d.toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  private buildRateNote(
    rate: number,
    isLive: boolean,
    source: string,
    fetchedAt: Date,
  ): string {
    const at = this.formatFetchedAtShanghai(fetchedAt);
    if (isLive) {
      return `1 USD = ${rate} CNY（实时汇率 · ${source} · 更新 ${at} 北京时间）`;
    }
    return `1 USD = ${rate} CNY（实时接口不可用，已用兜底 SETTLEMENT_USD_CNY_RATE · ${at}）`;
  }

  private buildFallbackQuote(fetchedAt: Date): UsdCnyRateQuote {
    const rate = roundRate(this.resolveFallbackRate());
    return {
      rate,
      isLive: false,
      source: 'SETTLEMENT_USD_CNY_RATE',
      fetchedAt: fetchedAt.toISOString(),
      rateNote: this.buildRateNote(rate, false, 'SETTLEMENT_USD_CNY_RATE', fetchedAt),
    };
  }

  /**
   * 依次尝试 Frankfurter（ECB）、open.er-api.com
   */
  private async fetchLiveRate(fetchedAt: Date): Promise<UsdCnyRateQuote | null> {
    const frankfurter = await this.tryFrankfurter(fetchedAt);
    if (frankfurter) return frankfurter;
    const erApi = await this.tryOpenErApi(fetchedAt);
    if (erApi) return erApi;
    this.logger.warn('USD/CNY 实时汇率均不可用，使用 SETTLEMENT_USD_CNY_RATE 兜底');
    return null;
  }

  private async tryFrankfurter(fetchedAt: Date): Promise<UsdCnyRateQuote | null> {
    try {
      const { data } = await axios.get<{ rates?: { CNY?: number } }>(
        'https://api.frankfurter.app/latest',
        {
          params: { from: 'USD', to: 'CNY' },
          timeout: 8_000,
        },
      );
      const cny = Number(data?.rates?.CNY);
      if (!Number.isFinite(cny) || cny <= 0) return null;
      const rate = roundRate(cny);
      return {
        rate,
        isLive: true,
        source: 'Frankfurter',
        fetchedAt: fetchedAt.toISOString(),
        rateNote: this.buildRateNote(rate, true, 'Frankfurter', fetchedAt),
      };
    } catch (err) {
      this.logger.debug(`Frankfurter 汇率失败: ${String(err)}`);
      return null;
    }
  }

  private async tryOpenErApi(fetchedAt: Date): Promise<UsdCnyRateQuote | null> {
    try {
      const { data } = await axios.get<{ result?: string; rates?: { CNY?: number } }>(
        'https://open.er-api.com/v6/latest/USD',
        { timeout: 8_000 },
      );
      if (data?.result !== 'success') return null;
      const cny = Number(data?.rates?.CNY);
      if (!Number.isFinite(cny) || cny <= 0) return null;
      const rate = roundRate(cny);
      return {
        rate,
        isLive: true,
        source: 'open.er-api.com',
        fetchedAt: fetchedAt.toISOString(),
        rateNote: this.buildRateNote(rate, true, 'open.er-api.com', fetchedAt),
      };
    } catch (err) {
      this.logger.debug(`open.er-api.com 汇率失败: ${String(err)}`);
      return null;
    }
  }
}
