import { Injectable } from '@nestjs/common';
import axios from 'axios';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ADS_ROOT = 'https://googleads.googleapis.com';

export interface GoogleAdsAppConfig {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  loginCustomerId: string;
  apiVersion: string;
}

export interface GoogleAdsCredentials {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  loginCustomerId: string;
  apiVersion: string;
}

export interface GoogleChildAccount {
  customerId: string;
  googleStatus: string;
  currencyCode: string;
  timeZone: string;
  manager: boolean;
}

export interface GoogleIdentityVerification {
  /** NOT_REQUIRED / SUCCESS / PENDING_USER_ACTION / PENDING_REVIEW / FAILURE / UNKNOWN */
  programStatus: string;
  completionDeadline: string;
  actionUrl: string;
}

/**
 * 未完成或失败的广告客户验证，不能拿来投放。
 */
export function isVerificationBlocking(programStatus: string): boolean {
  return programStatus === 'PENDING_USER_ACTION' || programStatus === 'FAILURE';
}

/**
 * 应用级 Google Ads 配置。刷新令牌和经理账号客户号可以只配在某一条 MCC 连接上。
 */
export function googleAdsAppConfig(env: NodeJS.ProcessEnv = process.env): GoogleAdsAppConfig {
  return {
    developerToken: (env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '').trim(),
    clientId: (env.GOOGLE_ADS_CLIENT_ID ?? '').trim(),
    clientSecret: (env.GOOGLE_ADS_CLIENT_SECRET ?? '').trim(),
    refreshToken: (env.GOOGLE_ADS_REFRESH_TOKEN ?? '').trim(),
    loginCustomerId: digitsOnly(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? ''),
    apiVersion: (env.GOOGLE_ADS_API_VERSION ?? '').trim() || 'v26',
  };
}

/**
 * 开发者令牌和 OAuth 客户端是否已经配齐。刷新令牌可以来自 MCC 连接。
 */
export function googleAdsAppReady(config = googleAdsAppConfig()): boolean {
  return Boolean(config.developerToken && config.clientId && config.clientSecret);
}

/**
 * 从 Google Ads 错误体里取出可展示的原因（尽量带上字段路径）。
 */
export function googleAdsErrorMessage(data: unknown, fallback: string): string {
  const error = asRecord(data).error;
  const details = asRecord(error).details;
  const messages: string[] = [];
  if (Array.isArray(details)) {
    for (const detail of details) {
      const errors = asRecord(detail).errors;
      if (!Array.isArray(errors)) continue;
      for (const item of errors) {
        const row = asRecord(item);
        const message = typeof row.message === 'string' ? row.message.trim() : '';
        const location = asRecord(row.location);
        const paths = Array.isArray(location.fieldPathElements)
          ? location.fieldPathElements
              .map((part) => {
                const field = asRecord(part);
                const name = typeof field.fieldName === 'string' ? field.fieldName : '';
                const index = field.index;
                return typeof index === 'number' ? `${name}[${index}]` : name;
              })
              .filter(Boolean)
              .join('.')
          : '';
        const code = asRecord(row.errorCode);
        const codeText = Object.entries(code)
          .filter(([, value]) => value != null && value !== '')
          .map(([key, value]) => `${key}:${String(value)}`)
          .join(',');
        const parts = [message, paths ? `@${paths}` : '', codeText ? `(${codeText})` : ''].filter(Boolean);
        if (parts.length) messages.push(parts.join(' '));
      }
    }
  }
  if (messages.length) return [...new Set(messages)].join('；');
  const top = asRecord(error).message;
  if (typeof top === 'string' && top.trim()) return top.trim();
  return fallback;
}

/**
 * 原子创建成功后，取出真实的系列和预算资源名。临时负数编号不算。
 */
export function readCreatedResources(data: unknown): { campaign: string; budget: string } {
  const responses = asRecord(data).mutateOperationResponses;
  let campaign = '';
  let budget = '';
  if (!Array.isArray(responses)) return { campaign, budget };
  for (const row of responses) {
    const record = asRecord(row);
    const budgetName = asRecord(record.campaignBudgetResult).resourceName;
    const campaignName = asRecord(record.campaignResult).resourceName;
    if (typeof budgetName === 'string' && isRealResource(budgetName)) budget = budgetName;
    if (typeof campaignName === 'string' && isRealResource(campaignName)) campaign = campaignName;
  }
  return { campaign, budget };
}

/**
 * 把 customer_client 查询结果收成可投放的子账号。经理账号自己不算。
 */
export function parseChildAccounts(results: unknown[]): GoogleChildAccount[] {
  const accounts: GoogleChildAccount[] = [];
  for (const row of results) {
    const client = asRecord(asRecord(row).customerClient);
    if (client.manager === true) continue;
    const customerId = customerIdFrom(client.clientCustomer) || digitsOnly(String(client.id ?? ''));
    if (customerId.length < 6) continue;
    accounts.push({
      customerId,
      googleStatus: typeof client.status === 'string' ? client.status : 'UNKNOWN',
      currencyCode: typeof client.currencyCode === 'string' ? client.currencyCode : '',
      timeZone: typeof client.timeZone === 'string' ? client.timeZone : '',
      manager: false,
    });
  }
  return accounts;
}

/**
 * 调用 Google Ads REST。访问令牌按刷新令牌缓存在进程内。
 */
@Injectable()
export class GoogleAdsClient {
  private readonly tokens = new Map<string, { value: string; expiresAt: number }>();

  async listChildAccounts(credentials: GoogleAdsCredentials): Promise<GoogleChildAccount[]> {
    const query = [
      'SELECT customer_client.client_customer, customer_client.id, customer_client.status,',
      'customer_client.currency_code, customer_client.time_zone, customer_client.manager, customer_client.level',
      'FROM customer_client',
      'WHERE customer_client.level <= 1',
    ].join(' ');
    const results = await this.searchAll(credentials.loginCustomerId, query, credentials);
    return parseChildAccounts(results).filter((row) => row.customerId !== credentials.loginCustomerId);
  }

  async countEnabledCampaigns(customerId: string, credentials: GoogleAdsCredentials): Promise<number> {
    const results = await this.searchAll(
      customerId,
      "SELECT campaign.id FROM campaign WHERE campaign.status = 'ENABLED'",
      credentials,
    );
    return results.length;
  }

  /**
   * 广告客户验证状态。空响应表示当前不要求验证。
   * 该接口有单独配额，调用方应限流并缓存结果。
   */
  async getIdentityVerification(
    customerId: string,
    credentials: GoogleAdsCredentials,
  ): Promise<GoogleIdentityVerification> {
    try {
      const data = asRecord(
        await this.get(`customers/${digitsOnly(customerId)}/getIdentityVerification`, credentials),
      );
      const list = Array.isArray(data.identityVerification) ? data.identityVerification : [];
      if (!list.length) {
        return { programStatus: 'NOT_REQUIRED', completionDeadline: '', actionUrl: '' };
      }
      const first = asRecord(list[0]);
      const progress = asRecord(first.verificationProgress);
      const requirement = asRecord(first.identityVerificationRequirement);
      const programStatus =
        typeof progress.programStatus === 'string' && progress.programStatus
          ? progress.programStatus
          : 'UNKNOWN';
      return {
        programStatus,
        completionDeadline:
          typeof requirement.verificationCompletionDeadlineTime === 'string'
            ? requirement.verificationCompletionDeadlineTime
            : '',
        actionUrl: typeof progress.actionUrl === 'string' ? progress.actionUrl : '',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      // 信用卡结算等账号 API 读不到验证状态，需人工标记。
      if (/BILLING_NOT_ON_MONTHLY_INVOICING/i.test(message)) {
        return { programStatus: 'API_UNAVAILABLE', completionDeadline: '', actionUrl: '' };
      }
      if (/PERMISSION_DENIED|CUSTOMER_NOT_ENABLED/i.test(message)) {
        return { programStatus: 'UNKNOWN', completionDeadline: '', actionUrl: '' };
      }
      return { programStatus: 'UNKNOWN', completionDeadline: '', actionUrl: '' };
    }
  }

  async mutate(customerId: string, body: Record<string, unknown>, credentials: GoogleAdsCredentials): Promise<unknown> {
    return this.post(`customers/${digitsOnly(customerId)}/googleAds:mutate`, body, credentials);
  }

  /**
   * 查出系列绑定的预算资源名。只读 GAQL，不改任何本地报表数据。
   */
  async lookupCampaignBudgetResource(
    customerId: string,
    campaignId: string,
    credentials: GoogleAdsCredentials,
  ): Promise<string> {
    const cid = digitsOnly(customerId);
    const id = digitsOnly(campaignId);
    if (!cid || !id) return '';
    const results = await this.searchAll(
      cid,
      `SELECT campaign.campaign_budget FROM campaign WHERE campaign.id = ${id}`,
      credentials,
    );
    if (!results.length) return '';
    const campaign = asRecord(asRecord(results[0]).campaign);
    const budget = typeof campaign.campaignBudget === 'string' ? campaign.campaignBudget : '';
    return isRealResource(budget) ? budget : '';
  }

  private async get(path: string, credentials: GoogleAdsCredentials): Promise<unknown> {
    const accessToken = await this.accessToken(credentials);
    const url = `${ADS_ROOT}/${credentials.apiVersion}/${path}`;
    try {
      const response = await axios.get(url, {
        timeout: 30000,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'developer-token': credentials.developerToken,
          'login-customer-id': credentials.loginCustomerId,
        },
        validateStatus: () => true,
      });
      if (response.status >= 200 && response.status < 300) return response.data;
      throw new Error(googleAdsErrorMessage(response.data, `Google Ads HTTP ${response.status}`));
    } catch (error) {
      if (error instanceof Error && !axios.isAxiosError(error)) throw error;
      const message = axios.isAxiosError(error) ? googleAdsErrorMessage(error.response?.data, error.message) : 'Google Ads 请求失败';
      throw new Error(message);
    }
  }

  private async searchAll(customerId: string, query: string, credentials: GoogleAdsCredentials): Promise<unknown[]> {
    const rows: unknown[] = [];
    let pageToken = '';
    for (let page = 0; page < 20; page += 1) {
      const data = asRecord(
        await this.post(
          `customers/${digitsOnly(customerId)}/googleAds:search`,
          pageToken ? { query, pageToken } : { query },
          credentials,
        ),
      );
      if (Array.isArray(data.results)) rows.push(...data.results);
      pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
      if (!pageToken) break;
    }
    return rows;
  }

  private async post(path: string, body: Record<string, unknown>, credentials: GoogleAdsCredentials): Promise<unknown> {
    const accessToken = await this.accessToken(credentials);
    const url = `${ADS_ROOT}/${credentials.apiVersion}/${path}`;
    try {
      const response = await axios.post(url, body, {
        timeout: 60000,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'developer-token': credentials.developerToken,
          'login-customer-id': credentials.loginCustomerId,
          'Content-Type': 'application/json',
        },
        validateStatus: () => true,
      });
      if (response.status >= 200 && response.status < 300) return response.data;
      throw new Error(googleAdsErrorMessage(response.data, `Google Ads HTTP ${response.status}`));
    } catch (error) {
      if (error instanceof Error && !axios.isAxiosError(error)) throw error;
      const message = axios.isAxiosError(error) ? googleAdsErrorMessage(error.response?.data, error.message) : 'Google Ads 请求失败';
      throw new Error(message);
    }
  }

  private async accessToken(credentials: GoogleAdsCredentials): Promise<string> {
    const cached = this.tokens.get(credentials.refreshToken);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
    });
    const response = await axios.post(TOKEN_URL, body.toString(), {
      timeout: 20000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: () => true,
    });
    const token = asRecord(response.data).access_token;
    if (response.status >= 300 || typeof token !== 'string' || !token) {
      const reason = asRecord(response.data).error_description ?? asRecord(response.data).error;
      throw new Error(typeof reason === 'string' && reason ? `Google 授权失败：${reason}` : 'Google 授权失败');
    }
    const expiresIn = Number(asRecord(response.data).expires_in ?? 3600);
    this.tokens.set(credentials.refreshToken, {
      value: token,
      expiresAt: Date.now() + Math.max(60, expiresIn - 120) * 1000,
    });
    return token;
  }
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function customerIdFrom(value: unknown): string {
  if (typeof value !== 'string') return '';
  const matched = value.match(/(\d+)\s*$/);
  return matched ? matched[1] : '';
}

function isRealResource(value: string): boolean {
  return value.includes('/') && !value.includes('/-');
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
