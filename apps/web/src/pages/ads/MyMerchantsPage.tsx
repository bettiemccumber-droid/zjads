import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Button, Card, Checkbox, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tabs, Tag, Typography, message } from 'antd';
import {
  AlertOutlined,
  CalendarOutlined,
  FireOutlined,
  FundOutlined,
  SaveOutlined,
  SearchOutlined,
  SettingOutlined,
  ShopOutlined,
  StarOutlined,
  ThunderboltOutlined,
  UserOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { api, type ApiResult } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { parseScopedViewUserId } from '../../utils/team-scope.util';
import { lastNDaysToYesterday } from '../../utils/date-range.util';
import { formatCustomerId, loadAdSettings, saveAdSettings, type AdLaunchSettings } from './ad-launch-settings';
import ChargebackMerchantsPage from '../merchant-hub/ChargebackMerchantsPage';
import './MyMerchantsPage.css';

interface ChannelAccount {
  id: number;
  displayName: string;
  platformCode: string;
}

interface CatalogMerchant {
  id: number;
  channelAccountId: number;
  name: string;
  mid: string;
  merchantUrl: string;
  countryCode: string;
  blockReason: string;
  platformCode: string;
}

interface AdvertisedCampaign {
  campaignName: string;
  customerId: string;
  status: string;
  localId: number | null;
}

interface AdvertisedMerchant {
  name: string;
  mid: string;
  platformCode: string;
  merchantUrl: string;
  countryCode: string;
  channelAccountId: number;
  enabled: boolean;
  campaigns?: AdvertisedCampaign[];
  logo?: string;
}

interface AdSource {
  id: number;
  name: string;
}

interface DiscoverRow {
  channelAccountId: number;
  platformCode: string;
  platformName: string;
  accountName: string;
  mid: string;
  name: string;
  merchantUrl: string;
  commRate: string;
  categories: string;
  countryCode: string;
  supportRegion: string;
  tags: string;
  logo: string;
  relationshipLabel: string;
  claimed: boolean;
}

interface DiscoverResult {
  total: number;
  page: number;
  pageSize: number;
  rows: DiscoverRow[];
  errors: Array<{ message: string }>;
  hint: string;
}

interface AdJob {
  id: string;
  status: string;
  progress: number;
  progressMessage: string;
  errorMessage: string | null;
  draft?: { headlines?: string[]; merchantUrl?: string; dailyBudgetUsd?: string; cpcBidCeilingUsd?: string } | null;
}

interface SettlementRow {
  merchantId: string;
  merchantName: string;
  platformCode: string;
  orderCount: number;
  totalCommission: number;
  rejectionRate: number;
}

interface EnginePrefs {
  landingProof: boolean;
  singleProduct: boolean;
  ecpc: boolean;
}

/**
 * 分类标题前的小图标。选中后跟标签一起变蓝。
 */
function tabLabel(icon: ReactNode, text: string, tone: string) {
  return (
    <span className="merchant-tab">
      <span className={`merchant-tab__icon merchant-tab__icon--${tone}`}>{icon}</span>
      {text}
    </span>
  );
}

const PLATFORM_SHORT: Record<string, string> = {
  partnermatic: 'PM',
  rewardoo: 'RW',
  linkhaitao: 'LH',
  linkbux: 'LB',
  ultrainfluence: 'UI',
  collabglow: 'CG',
  famesta: 'FS',
};
/**
 * 平台代码显示成参考页上的短标签。
 */
const BLOCK_LABEL: Record<string, string> = {
  adult: '成人',
  prohibited: '禁止',
  violation: '违规',
};

/**
 * 上广告引擎的两个开关只记在这台电脑上，不提交到 Google。
 */
function engineStorageKey(userId: number) {
  return `zjads.adEngines.${userId}`;
}

function loadEngines(userId: number): EnginePrefs {
  try {
    const parsed = JSON.parse(localStorage.getItem(engineStorageKey(userId)) || '') as Partial<EnginePrefs>;
    return {
      landingProof: parsed.landingProof === true,
      singleProduct: parsed.singleProduct === true,
      ecpc: parsed.ecpc === true,
    };
  } catch {
    return { landingProof: false, singleProduct: false, ecpc: false };
  }
}

function saveEngines(userId: number, value: EnginePrefs) {
  localStorage.setItem(engineStorageKey(userId), JSON.stringify(value));
}

/**
 * 还没有数据来源的分类。不放示例商家。
 */
function EmptyList({ name }: { name: string }) {
  return <div className="merchant-empty">还没有{name}的数据。</div>;
}

function platformTag(code: string) {
  const short = PLATFORM_SHORT[code] || (code ? code.slice(0, 2).toUpperCase() : '—');
  return <span className={`merchant-platform merchant-platform--${code || 'default'}`}>{short}</span>;
}

/**
 * 空字段用横线，避免编造拒付率、结算率这些日报里没有的数。
 */
function blank(value?: string) {
  const text = value?.trim();
  return text ? text : <span className="merchant-blank">—</span>;
}

/**
 * 有商标地址用图片。没有商标时，用商家网址的站点图标。都没有再用名称首字。
 */
function markSrc(logo?: string, merchantUrl?: string) {
  const direct = logo?.trim();
  if (direct) return direct;
  try {
    const host = new URL(merchantUrl || '').hostname;
    if (!host) return '';
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  } catch {
    return '';
  }
}

/**
 * 商家名称前的圆形商标。
 */
function MerchantMark({ name, logo, merchantUrl }: { name: string; logo?: string; merchantUrl?: string }) {
  const [broken, setBroken] = useState(false);
  const letter = name.trim().slice(0, 1).toUpperCase() || '?';
  const src = broken ? '' : markSrc(logo, merchantUrl);
  return (
    <span className="merchant-mark">
      {src ? (
        <img className="merchant-mark__logo" src={src} alt="" width={36} height={36} referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      ) : (
        <span className="merchant-mark__letter">{letter}</span>
      )}
      <span className="merchant-mark__name">{name}</span>
    </span>
  );
}

/**
 * 支持地区拆成小标签。没有地区时留空。
 */
function regionTags(value?: string) {
  const parts = (value || '').split(/[,，/\s]+/).map((item) => item.trim()).filter(Boolean).slice(0, 4);
  if (parts.length === 0) return <span className="merchant-blank">—</span>;
  return (
    <span className="merchant-regions">
      {parts.map((item) => <span key={item} className="merchant-region">{item}</span>)}
    </span>
  );
}

/**
 * 系列状态文案。日报用已启用/已暂停，本地系列用待提交。
 */
function campaignStatusView(status: string) {
  if (status === 'ENABLED') return { text: '已启用', tone: 'on' };
  if (status === 'PAUSED') return { text: '已暂停', tone: 'off' };
  if (status === 'WAITING_SUBMIT') return { text: '待提交', tone: 'wait' };
  if (status === 'WAITING_PAUSE') return { text: '待暂停', tone: 'off' };
  if (status === 'WAITING_ENABLE') return { text: '待启用', tone: 'on' };
  return { text: status || '—', tone: 'wait' };
}

/**
 * 商家展开后的广告系列。日报里的系列只展示，本地系列可以记为待暂停或待启用。
 */
function CampaignList({
  row,
  onStatus,
}: {
  row: AdvertisedMerchant;
  onStatus: (localId: number, status: 'ENABLED' | 'PAUSED') => void;
}) {
  const campaigns = row.campaigns ?? [];
  if (campaigns.length === 0) {
    return (
      <div className="merchant-campaigns">
        <div className="merchant-campaigns__title">广告系列</div>
        <div className="merchant-campaigns__empty">最近一天没有这个商家的广告系列</div>
      </div>
    );
  }
  return (
    <div className="merchant-campaigns">
      <div className="merchant-campaigns__title">广告系列</div>
      <div className="merchant-campaigns__head">
        <span>系列名称</span>
        <span>CID</span>
        <span>状态</span>
        <span>操作</span>
      </div>
      {campaigns.map((item) => {
        const view = campaignStatusView(item.status);
        return (
          <div className="merchant-campaigns__row" key={`${item.customerId}:${item.campaignName}`}>
            <span className="merchant-campaigns__name" title={item.campaignName}>{item.campaignName}</span>
            <span>{formatCustomerId(item.customerId)}</span>
            <span className={`merchant-state merchant-state--${view.tone}`}>{view.text}</span>
            <span className="merchant-actions">
              {item.localId == null ? <span className="merchant-blank">—</span> : (
                <>
                  <Popconfirm title="记为待启用？不会立刻改 Google。" onConfirm={() => onStatus(item.localId as number, 'ENABLED')}>
                    <Button type="link" size="small">重投此条</Button>
                  </Popconfirm>
                  <Popconfirm title="记为待暂停？不会立刻改 Google。" onConfirm={() => onStatus(item.localId as number, 'PAUSED')}>
                    <Button type="link" size="small" danger>拒登</Button>
                  </Popconfirm>
                </>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function hiddenStorageKey(userId: number) {
  return `zjads.hiddenMerchants.${userId}`;
}

function readHiddenMids(userId: number): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(hiddenStorageKey(userId)) || '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * 员工自己的商家和投放默认值。新增广告写入待提交，不调用 Google。
 */
export default function MyMerchantsPage() {
  const { user, isAdmin } = useAuth();
  const [searchParams] = useSearchParams();
  const viewUserId = parseScopedViewUserId(user, isAdmin, searchParams.get('userId'));
  const scopeUserId = viewUserId ?? user?.id;
  const viewName = searchParams.get('username');
  const [accounts, setAccounts] = useState<ChannelAccount[]>([]);
  const [advertised, setAdvertised] = useState<AdvertisedMerchant[]>([]);
  const [hiddenMids, setHiddenMids] = useState<string[]>([]);
  const [minePlatform, setMinePlatform] = useState('');
  const [mineQuery, setMineQuery] = useState('');
  const [pickTag, setPickTag] = useState('');
  const [sources, setSources] = useState<AdSource[]>([]);
  const [blocked, setBlocked] = useState<CatalogMerchant[]>([]);
  const [chargebacks, setChargebacks] = useState<SettlementRow[]>([]);
  const [engines, setEngines] = useState<EnginePrefs>({ landingProof: false, singleProduct: false, ecpc: false });
  const [settings, setSettings] = useState<AdLaunchSettings | null>(null);
  const [launchMerchant, setLaunchMerchant] = useState<DiscoverRow | null>(null);
  const [job, setJob] = useState<AdJob | null>(null);
  const [settingsForm] = Form.useForm<AdLaunchSettings>();
  const [claimForm] = Form.useForm();
  const [tab, setTab] = useState('mine');
  const [discoverAccountId, setDiscoverAccountId] = useState<number | undefined>();
  const [discoverQuery, setDiscoverQuery] = useState('');
  const [discover, setDiscover] = useState<DiscoverResult | null>(null);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [claimingKey, setClaimingKey] = useState('');

  const load = useCallback(async () => {
    const params = viewUserId ? { userId: viewUserId } : undefined;
    const [accountRes, advertisedRes, sourceRes, catalogRes] = await Promise.all([
      api.get<ApiResult<Array<{ platformCode: string; accounts: ChannelAccount[] }>>>('/channel-accounts/by-platform', { params }).catch(() => null),
      api.get<ApiResult<AdvertisedMerchant[]>>('/catalog-merchants/advertised', { params }).catch(() => null),
      api.get<ApiResult<AdSource[]>>('/ad-sources', { params }).catch(() => null),
      api.get<ApiResult<CatalogMerchant[]>>('/catalog-merchants', { params }).catch(() => null),
    ]);
    if (accountRes?.data.success) {
      setAccounts(accountRes.data.data.flatMap((group) => group.accounts.map((account) => ({ ...account, platformCode: group.platformCode }))));
    }
    if (advertisedRes?.data.success) setAdvertised(advertisedRes.data.data);
    else message.error('加载商家失败');
    if (sourceRes?.data.success) setSources(sourceRes.data.data.map((item) => ({ id: item.id, name: item.name })));
    if (catalogRes?.data.success) {
      setBlocked(catalogRes.data.data.filter((item) => item.blockReason && item.blockReason !== 'none'));
    }
  }, [viewUserId]);

  const searchDiscover = useCallback(async (page = 1, query = discoverQuery) => {
    setDiscoverLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (discoverAccountId) params.set('channelAccountId', String(discoverAccountId));
      if (query.trim()) params.set('q', query.trim());
      if (viewUserId) params.set('userId', String(viewUserId));
      const res = await api.get<ApiResult<DiscoverResult>>(`/catalog-merchants/discover?${params.toString()}`);
      if (!res.data.success) {
        message.error(res.data.message || '查找商家失败');
        return;
      }
      setDiscover(res.data.data);
    } catch (err) {
      const apiMessage = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(apiMessage || '查找商家失败');
    } finally {
      setDiscoverLoading(false);
    }
  }, [discoverAccountId, discoverQuery, viewUserId]);

  const openLaunch = useCallback((row: DiscoverRow) => {
    if (!/^https?:\/\//i.test(row.merchantUrl)) {
      message.warning('这个商家没有网址，不能领取');
      return;
    }
    const regions = row.supportRegion.split(/[,，/\s]+/).map((item) => item.trim().toUpperCase()).filter((item) => /^[A-Z]{2}$/.test(item));
    setJob(null);
    setLaunchMerchant(row);
    claimForm.setFieldsValue({
      mccCustomerId: sources[0] ? `s${sources[0].id}` : undefined,
      targetCountry: regions[0] || settings?.targetCountry || row.countryCode || 'US',
      languageCode: settings?.languageCode || 'en',
    });
  }, [claimForm, settings, sources]);

  useEffect(() => {
    if (discoverAccountId === undefined && accounts[0]) setDiscoverAccountId(accounts[0].id);
  }, [accounts, discoverAccountId]);

  useEffect(() => {
    if (tab !== 'pick' || discoverAccountId === undefined) return;
    void searchDiscover(1);
  }, [tab, discoverAccountId]);

  useEffect(() => {
    if (!user || scopeUserId == null) return;
    const saved = loadAdSettings(scopeUserId);
    setSettings(saved);
    settingsForm.setFieldsValue(saved);
    setEngines(loadEngines(scopeUserId));
    setHiddenMids(readHiddenMids(scopeUserId));
    void load().catch(() => message.error('加载商家失败'));
    const [start, end] = lastNDaysToYesterday(30);
    void api.get<ApiResult<{ items: SettlementRow[] }>>('/orders/settlement/merchant-summary', {
      params: {
        startDate: start.format('YYYY-MM-DD'),
        endDate: end.format('YYYY-MM-DD'),
        ...(viewUserId ? { userId: viewUserId } : {}),
      },
    }).then((res) => {
      if (res.data.success) setChargebacks(res.data.data.items ?? []);
    }).catch(() => setChargebacks([]));
  }, [user, scopeUserId, viewUserId, load, settingsForm]);

  useEffect(() => {
    if (!job || job.status === 'READY_FOR_REVIEW' || job.status === 'COMPLETED' || job.status === 'FAILED') return;
    const timer = window.setInterval(() => {
      void api.get<ApiResult<AdJob>>(`/ad-jobs/${job.id}`).then((res) => {
        if (res.data.success) setJob(res.data.data);
      });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [job]);

  const hiddenSet = useMemo(() => new Set(hiddenMids), [hiddenMids]);
  const visibleAdvertised = useMemo(() => {
    const query = mineQuery.trim().toLowerCase();
    return advertised.filter((item) => {
      if (hiddenSet.has(item.mid)) return false;
      if (minePlatform && item.platformCode !== minePlatform) return false;
      if (!query) return true;
      return `${item.name} ${item.mid}`.toLowerCase().includes(query);
    });
  }, [advertised, hiddenSet, minePlatform, mineQuery]);
  const minePlatforms = useMemo(
    () => [...new Set(advertised.map((item) => item.platformCode).filter(Boolean))],
    [advertised],
  );
  const pickTags = useMemo(() => {
    const tags = new Set<string>();
    (discover?.rows ?? []).forEach((row) => row.tags.split(/[,，]/).map((item) => item.trim()).filter(Boolean).forEach((item) => tags.add(item)));
    return [...tags];
  }, [discover]);
  const pickRows = useMemo(
    () => (discover?.rows ?? []).filter((row) => !pickTag || row.tags.split(/[,，]/).map((item) => item.trim()).includes(pickTag)),
    [discover, pickTag],
  );

  const hideAdvertised = useCallback((row: AdvertisedMerchant) => {
    if (!user) return;
    const ownerId = scopeUserId ?? user.id;
    const next = [...new Set([...readHiddenMids(ownerId), row.mid])];
    localStorage.setItem(hiddenStorageKey(ownerId), JSON.stringify(next));
    setHiddenMids(next);
    message.success('已取消领取');
  }, [user, scopeUserId]);

  const setLocalStatus = useCallback(async (localId: number, status: 'ENABLED' | 'PAUSED') => {
    try {
      const res = await api.patch<ApiResult<unknown>>(`/ad-campaigns/${localId}/status`, { status });
      if (!res.data.success) {
        message.error(res.data.message || '更新系列状态失败');
        return;
      }
      message.success(status === 'PAUSED' ? '已记为待暂停' : '已记为待启用');
      await load();
    } catch (err) {
      const apiMessage = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(apiMessage || '更新系列状态失败');
    }
  }, [load]);

  const launchAdvertised = useCallback((row: AdvertisedMerchant) => {
    const account = accounts.find((item) => item.id === row.channelAccountId);
    openLaunch({
      channelAccountId: row.channelAccountId,
      platformCode: row.platformCode,
      platformName: row.platformCode,
      accountName: account?.displayName || row.platformCode,
      mid: row.mid,
      name: row.name,
      merchantUrl: row.merchantUrl,
      commRate: '',
      categories: '',
      countryCode: row.countryCode,
      supportRegion: row.countryCode,
      tags: '',
      logo: '',
      relationshipLabel: '',
      claimed: false,
    });
  }, [accounts, openLaunch]);

  const enabledCount = visibleAdvertised.filter((item) => item.enabled).length;
  const platformCounts = useMemo(() => {
    const counts = new Map<string, number>();
    visibleAdvertised.forEach((item) => {
      const code = item.platformCode || '';
      counts.set(code, (counts.get(code) ?? 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [visibleAdvertised]);
  const rejectionByKey = useMemo(() => {
    const map = new Map<string, number>();
    chargebacks.forEach((item) => {
      const key = `${item.platformCode}:${item.merchantId}`;
      const current = map.get(key);
      if (current == null || item.rejectionRate > current) map.set(key, item.rejectionRate);
    });
    return map;
  }, [chargebacks]);
  /**
   * 有结算拒付率就显示百分比，没有就留横线。
   */
  const rejectionCell = (platformCode: string, mid: string) => {
    const rate = rejectionByKey.get(`${platformCode}:${mid}`);
    if (rate == null) return blank();
    return <span className={rate > 0 ? 'merchant-rate merchant-rate--bad' : 'merchant-rate'}>{rate.toFixed(2)}%</span>;
  };

  const persistEngines = (next: EnginePrefs) => {
    setEngines(next);
    if (scopeUserId != null) saveEngines(scopeUserId, next);
  };

  return (
    <div className="merchant-page">
      <div className="merchant-page__head">
        <div className="merchant-page__title">
          <ShopOutlined />
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>我的商家</Typography.Title>
            <div className="merchant-page__sub">{viewName ? `${viewName} 的商家。` : '已经投放过的商家，以及可以领取的商家。'}</div>
          </div>
        </div>
      </div>

      <div className="merchant-dash">
        <section className="merchant-panel">
          <div className="merchant-panel__title"><ShopOutlined /> 我的商家</div>
          <div className="merchant-stat__num">{visibleAdvertised.length.toLocaleString('en-US')}</div>
          <div className="merchant-stat__label">可投放</div>
          <div className="merchant-chips">
            {platformCounts.length === 0 ? <span className="merchant-blank">还没有商家</span> : platformCounts.map(([code, count]) => (
              <span key={code || 'unknown'} className="merchant-chip">
                {platformTag(code)}
                <b>{count}</b>
              </span>
            ))}
          </div>
          <div className="merchant-stat__foot">已启用 {enabledCount} · 已暂停 {visibleAdvertised.length - enabledCount}</div>
        </section>

        <section className="merchant-panel merchant-panel--settings">
          <div className="merchant-panel__bar">
            <div className="merchant-panel__title"><SettingOutlined /> 广告投放设置</div>
            <Button
              type="primary"
              size="small"
              icon={<SaveOutlined />}
              className="merchant-save"
              onClick={() => void settingsForm.validateFields().then((values) => {
                if (scopeUserId == null) return;
                saveAdSettings(scopeUserId, values);
                setSettings(values);
                message.success('投放设置已保存');
              })}
            >
              保存
            </Button>
          </div>
          <Form form={settingsForm} component="div" className="merchant-settings">
            <div className="merchant-setting-line">
              <span>出价策略</span>
              <Form.Item name="bidding" noStyle>
                <Select size="small" options={[
                  { value: 'MAXIMIZE_CLICKS', label: '尽可能多的点击' },
                  { value: 'MANUAL_CPC', label: '手动 CPC' },
                ]} />
              </Form.Item>
              <span className="merchant-ecpc">eCPC <Switch size="small" checked={engines.ecpc} onChange={(checked) => persistEngines({ ...engines, ecpc: checked })} /></span>
              <span>CPC($)</span>
              <Form.Item name="cpcBidCeilingUsd" noStyle rules={[{ required: true, message: '填写最高 CPC' }]}>
                <Input size="small" />
              </Form.Item>
            </div>
            <div className="merchant-setting-line">
              <span>日预算($)</span>
              <Form.Item name="dailyBudgetUsd" noStyle rules={[{ required: true, message: '填写日预算' }]}>
                <Input size="small" />
              </Form.Item>
              <span>投放网络</span>
              <span className="merchant-nets">
                <Checkbox checked disabled>搜索</Checkbox>
                <Checkbox disabled>合作伙伴</Checkbox>
                <Checkbox disabled>展示</Checkbox>
              </span>
            </div>
            <div className="merchant-setting-line">
              <span>竞价规则</span>
              <span className="merchant-blank">—</span>
              <span>欧盟政治广告</span>
              <Tag className="merchant-eu">不含</Tag>
            </div>
            <div className="merchant-setting-line">
              <span>国家</span>
              <Form.Item name="targetCountry" noStyle rules={[{ required: true, message: '填写国家' }]}>
                <Input size="small" />
              </Form.Item>
              <span>语言</span>
              <Form.Item name="languageCode" noStyle>
                <Input size="small" />
              </Form.Item>
              <span>金额</span>
              <span className="merchant-blank">—</span>
            </div>
          </Form>
        </section>

        <section className="merchant-panel">
          <div className="merchant-panel__title"><ThunderboltOutlined /> 上广告引擎</div>
          <div className="merchant-engine">
            <div>
              <div className="merchant-engine__name"><SearchOutlined /> 落地页证明引导</div>
              <div className="merchant-engine__text">只记在这台电脑。新建广告时还不会读取。</div>
            </div>
            <Switch size="small" checked={engines.landingProof} onChange={(checked) => persistEngines({ ...engines, landingProof: checked })} />
          </div>
          <div className="merchant-engine">
            <div>
              <div className="merchant-engine__name"><ThunderboltOutlined className="merchant-engine__bolt" /> 单品同投引擎</div>
              <div className="merchant-engine__text">只记在这台电脑。新建广告时还不会读取。</div>
            </div>
            <Switch size="small" checked={engines.singleProduct} onChange={(checked) => persistEngines({ ...engines, singleProduct: checked })} />
          </div>
        </section>

        <section className="merchant-panel merchant-panel--ai">
          <div className="merchant-panel__title"><UserOutlined /> AI 人设库</div>
          <div className="merchant-ai__empty">还没有人设</div>
          <div className="merchant-ai__counts">
            <div><b>0</b><span>人设库</span></div>
            <div><b>0</b><span>使用过</span></div>
          </div>
          <Button size="small" className="merchant-ai__btn" icon={<UserOutlined />} onClick={() => message.info('还没有人设')}>管理人设</Button>
        </section>
      </div>

      <Card className="merchant-board">
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'mine',
              label: tabLabel(<ShopOutlined />, `我的商家 (${visibleAdvertised.length})`, 'shop'),
              children: (
                <>
                  <div className="merchant-toolbar">
                    <Select
                      allowClear
                      placeholder="平台"
                      style={{ width: 120 }}
                      value={minePlatform || undefined}
                      onChange={(value) => setMinePlatform(value || '')}
                      options={minePlatforms.map((code) => ({ value: code, label: PLATFORM_SHORT[code] || code }))}
                    />
                    <Input
                      allowClear
                      prefix={<SearchOutlined />}
                      style={{ width: 240 }}
                      placeholder="搜索商家名/MID"
                      value={mineQuery}
                      onChange={(event) => setMineQuery(event.target.value)}
                    />
                    <Button type="primary">查询</Button>
                    <Button onClick={() => { setMinePlatform(''); setMineQuery(''); }}>重置</Button>
                    <Button className="merchant-toolbar__sync" onClick={() => void load()}>同步商家库</Button>
                  </div>
                  <Table
                    className="merchant-table"
                    rowKey={(row) => `${row.channelAccountId}:${row.mid}`}
                    size="middle"
                    scroll={{ x: 1180 }}
                    pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '20', '50'], showTotal: (total) => `共 ${total} 条` }}
                    dataSource={visibleAdvertised}
                    expandable={{
                      expandedRowRender: (row) => <CampaignList row={row} onStatus={setLocalStatus} />,
                    }}
                    columns={[
                      { title: '商家名称', dataIndex: 'name', width: 220, render: (value: string, row: AdvertisedMerchant) => <MerchantMark name={value} logo={row.logo} merchantUrl={row.merchantUrl} /> },
                      { title: '平台', dataIndex: 'platformCode', width: 72, render: (value: string) => platformTag(value) },
                      { title: 'MID', dataIndex: 'mid', width: 100 },
                      { title: '主营业务', width: 110, render: () => blank() },
                      { title: '佣金率', width: 80, render: () => blank() },
                      { title: '拒付率', width: 90, render: (_: unknown, row: AdvertisedMerchant) => rejectionCell(row.platformCode, row.mid) },
                      { title: '结算率', width: 80, render: () => blank() },
                      { title: '协商佣金率', width: 100, render: () => blank() },
                      { title: '支持地区', dataIndex: 'countryCode', width: 100, render: (value: string) => regionTags(value) },
                      {
                        title: '状态',
                        dataIndex: 'enabled',
                        width: 90,
                        render: (value: boolean) => <span className={value ? 'merchant-state merchant-state--on' : 'merchant-state merchant-state--off'}>{value ? '已启用' : '已暂停'}</span>,
                      },
                      { title: 'ATC备单率', width: 90, render: () => blank() },
                      { title: '在投人数', width: 80, render: () => blank() },
                      { title: '标签', width: 70, render: () => blank() },
                      {
                        title: '操作',
                        width: 150,
                        render: (_: unknown, row: AdvertisedMerchant) => (
                          <span className="merchant-actions">
                            <Button type="link" size="small" disabled={!row.merchantUrl || !row.channelAccountId} onClick={() => launchAdvertised(row)}>新增广告</Button>
                            <Button type="link" size="small" danger onClick={() => hideAdvertised(row)}>取消领取</Button>
                          </span>
                        ),
                      },
                    ]}
                  />
                </>
              ),
            },
            {
              key: 'pick',
              label: tabLabel(<StarOutlined />, discover ? `选取商家 (${discover.total})` : '选取商家', 'star'),
              children: (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <div className="merchant-toolbar">
                    <Select
                      placeholder="平台"
                      style={{ width: 140 }}
                      value={discoverAccountId}
                      onChange={(value) => { setPickTag(''); setDiscoverAccountId(value); }}
                      options={accounts.map((item) => ({ value: item.id, label: PLATFORM_SHORT[item.platformCode] || item.platformCode }))}
                    />
                    <Select
                      allowClear
                      placeholder="标签筛选"
                      style={{ width: 140 }}
                      value={pickTag || undefined}
                      onChange={(value) => setPickTag(value || '')}
                      options={pickTags.map((item) => ({ value: item, label: item }))}
                    />
                    <Input
                      allowClear
                      style={{ width: 220 }}
                      placeholder="搜索商家名/MID"
                      value={discoverQuery}
                      onChange={(event) => setDiscoverQuery(event.target.value)}
                      onPressEnter={() => void searchDiscover(1)}
                    />
                    <Button type="primary" loading={discoverLoading} onClick={() => void searchDiscover(1)}>查询</Button>
                    <Button onClick={() => { setDiscoverQuery(''); setPickTag(''); void searchDiscover(1, ''); }}>重置</Button>
                    <Button style={{ marginLeft: 'auto' }} loading={discoverLoading} onClick={() => { void searchDiscover(discover?.page ?? 1); void load(); }}>同步商家库</Button>
                  </div>
                  {discover?.hint ? <Alert type="info" showIcon message={discover.hint} /> : null}
                  {discover?.errors?.length ? (
                    <Alert type="warning" showIcon message={discover.errors.map((item) => item.message).join('；')} />
                  ) : null}
                  <Table
                    className="merchant-table"
                    rowKey={(row) => `${row.channelAccountId}:${row.mid}`}
                    size="middle"
                    scroll={{ x: 1200 }}
                    loading={discoverLoading}
                    dataSource={pickRows}
                    pagination={discoverAccountId ? {
                      current: discover?.page ?? 1,
                      pageSize: discover?.pageSize ?? 20,
                      total: discover?.total ?? 0,
                      showSizeChanger: false,
                      onChange: (page) => void searchDiscover(page),
                    } : false}
                    columns={[
                      {
                        title: '商家名称',
                        dataIndex: 'name',
                        width: 240,
                        render: (value: string, row: DiscoverRow) => <MerchantMark name={value} logo={row.logo} merchantUrl={row.merchantUrl} />,
                      },
                      { title: '平台', dataIndex: 'platformCode', width: 72, render: (value: string) => platformTag(value) },
                      { title: 'MID', dataIndex: 'mid', width: 100 },
                      { title: '主营业务', dataIndex: 'categories', width: 140, ellipsis: true, render: (value: string) => blank(value) },
                      { title: '佣金率', dataIndex: 'commRate', width: 90, render: (value: string) => blank(value) },
                      { title: '拒付率', width: 90, render: (_: unknown, row: DiscoverRow) => rejectionCell(row.platformCode, row.mid) },
                      { title: '结算率', width: 80, render: () => blank() },
                      { title: '协商佣金率', width: 110, render: () => blank() },
                      { title: '支持地区', dataIndex: 'supportRegion', width: 140, render: (value: string, row: DiscoverRow) => regionTags(value || row.countryCode) },
                      { title: 'ATC备单率', width: 100, render: () => blank() },
                      { title: '在投人数', width: 90, render: () => '—' },
                      { title: '标签', dataIndex: 'tags', ellipsis: true, render: (value: string) => blank(value) },
                      {
                        title: '操作',
                        width: 90,
                        render: (_: unknown, row: DiscoverRow) => (
                          <Button type="primary" size="small" disabled={!row.merchantUrl} onClick={() => openLaunch(row)}>领取</Button>
                        ),
                      },
                    ]}
                  />
                </Space>
              ),
            },
            {
              key: 'blocked',
              label: tabLabel(<WarningOutlined />, `违规商家 (${blocked.length})`, 'warn'),
              children: blocked.length === 0 ? <EmptyList name="违规商家" /> : (
                <Table
                  className="merchant-table"
                  rowKey={(row) => String(row.id)}
                  size="middle"
                  pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 条` }}
                  dataSource={blocked}
                  columns={[
                    { title: '商家名称', dataIndex: 'name', render: (value: string, row: CatalogMerchant) => <MerchantMark name={value} merchantUrl={row.merchantUrl} /> },
                    { title: '平台', dataIndex: 'platformCode', width: 72, render: (value: string) => platformTag(value) },
                    { title: 'MID', dataIndex: 'mid', width: 120 },
                    { title: '原因', dataIndex: 'blockReason', width: 100, render: (value: string) => BLOCK_LABEL[value] || value },
                    { title: '支持地区', dataIndex: 'countryCode', width: 120, render: (value: string) => regionTags(value) },
                  ]}
                />
              ),
            },
            { key: 'hot', label: tabLabel(<FireOutlined />, '热销商家', 'hot'), children: <EmptyList name="热销商家" /> },
            { key: 'recommend', label: tabLabel(<StarOutlined />, '推荐商家', 'star'), children: <EmptyList name="推荐商家" /> },
            { key: 'nodes', label: tabLabel(<CalendarOutlined />, '节点推荐', 'node'), children: <EmptyList name="节点推荐" /> },
            { key: 'running', label: tabLabel(<FundOutlined />, '经营商家', 'run'), children: <EmptyList name="经营商家" /> },
            {
              key: 'chargeback',
              label: tabLabel(<AlertOutlined />, '拒付商家', 'back'),
              children: tab === 'chargeback' ? <ChargebackMerchantsPage /> : null,
            },
          ]}
        />
      </Card>

      <Modal
        title={launchMerchant ? `领取商家: ${launchMerchant.name}` : '领取商家'}
        open={launchMerchant != null}
        onCancel={() => setLaunchMerchant(null)}
        footer={null}
        destroyOnClose
      >
        {!launchMerchant ? null : sources.length === 0 ? (
          <Alert type="warning" showIcon message="还没有广告数据源，请先在广告数据源里添加 MCC。" />
        ) : (
          <Form form={claimForm} layout="vertical" onFinish={async (values) => {
            if (!launchMerchant || !settings) return;
            const key = `${launchMerchant.channelAccountId}:${launchMerchant.mid}`;
            setClaimingKey(key);
            try {
              const created = await api.post<ApiResult<CatalogMerchant>>('/catalog-merchants', {
                channelAccountId: launchMerchant.channelAccountId,
                mid: launchMerchant.mid,
                name: launchMerchant.name,
                merchantUrl: launchMerchant.merchantUrl,
                countryCode: values.targetCountry,
              });
              if (!created.data.success) {
                message.error(created.data.message || '领取失败');
                return;
              }
              const res = await api.post<ApiResult<AdJob>>('/ad-jobs', {
                catalogMerchantId: created.data.data.id,
                mccCustomerId: values.mccCustomerId,
                targetCountry: values.targetCountry,
                languageCode: values.languageCode,
                bidding: settings.bidding,
                dailyBudgetUsd: settings.dailyBudgetUsd,
                cpcBidCeilingUsd: settings.cpcBidCeilingUsd,
              });
              if (!res.data.success) {
                message.error(res.data.message || '生成广告失败');
                return;
              }
              setJob(res.data.data);
              message.success('已开始制作广告');
              if (user) {
                if (scopeUserId != null) {
                  const next = readHiddenMids(scopeUserId).filter((mid) => mid !== launchMerchant.mid);
                  localStorage.setItem(hiddenStorageKey(scopeUserId), JSON.stringify(next));
                }
                setHiddenMids(next);
              }
              await load();
            } catch (err) {
              const apiMessage = (err as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
              message.error(Array.isArray(apiMessage) ? apiMessage.join('；') : apiMessage || '领取失败');
            } finally {
              setClaimingKey('');
            }
          }}>
            <Form.Item name="mccCustomerId" label="MCC 账户" rules={[{ required: true, message: '选择 MCC 账户' }]}>
              <Select options={sources.map((item) => ({ value: `s${item.id}`, label: item.name }))} />
            </Form.Item>
            <Form.Item name="targetCountry" label="目标国家" rules={[{ required: true, message: '填写目标国家' }]}>
              <Input placeholder="US" />
            </Form.Item>
            {launchMerchant.supportRegion ? (
              <Form.Item label="支持地区">
                <Space size={4} wrap>
                  {launchMerchant.supportRegion.split(/[,，/\s]+/).filter(Boolean).map((region) => (
                    <Tag
                      key={region}
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        const code = region.trim().toUpperCase();
                        if (/^[A-Z]{2}$/.test(code)) claimForm.setFieldValue('targetCountry', code);
                      }}
                    >
                      {region}
                    </Tag>
                  ))}
                </Space>
              </Form.Item>
            ) : null}
            <Form.Item name="languageCode" label="广告语言（可选）">
              <Input placeholder="en" />
            </Form.Item>
            <Form.Item label="使用账号">
              <Input value={`${launchMerchant.accountName} / ${launchMerchant.platformCode}`} disabled />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={claimingKey === `${launchMerchant.channelAccountId}:${launchMerchant.mid}`}>确定</Button>
          </Form>
        )}
        {job && (
          <Alert
            style={{ marginTop: 12 }}
            type={job.status === 'FAILED' ? 'error' : 'success'}
            message={`${job.progressMessage}（${job.progress}%）`}
            description={
              <Space direction="vertical">
                {job.errorMessage && <span>{job.errorMessage}</span>}
                {job.draft?.headlines && <span>标题：{job.draft.headlines.join(' / ')}</span>}
                {job.draft?.merchantUrl && <span>广告最终到达网址：{job.draft.merchantUrl}</span>}
                {job.draft?.dailyBudgetUsd && <span>日预算 ${job.draft.dailyBudgetUsd} · 最高 CPC ${job.draft.cpcBidCeilingUsd}</span>}
                {job.status === 'READY_FOR_REVIEW' && (
                  <Button type="primary" onClick={() => void api.post<ApiResult<AdJob>>(`/ad-jobs/${job.id}/publish`, {}).then(async (res) => {
                    if (!res.data.success) return message.error(res.data.message || '发布失败');
                    setJob(res.data.data);
                    message.success('已写入待提交，文章到文章管理里查看');
                    await load();
                  })}>确认发布</Button>
                )}
              </Space>
            }
          />
        )}
      </Modal>
    </div>
  );
}
