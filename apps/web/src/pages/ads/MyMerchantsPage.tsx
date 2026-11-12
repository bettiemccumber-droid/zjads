import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table, Tabs, Tag, Typography, message } from 'antd';
import { api, type ApiResult } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { formatCustomerId, loadAdSettings, saveAdSettings, type AdLaunchSettings } from './ad-launch-settings';
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
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<ChannelAccount[]>([]);
  const [advertised, setAdvertised] = useState<AdvertisedMerchant[]>([]);
  const [hiddenMids, setHiddenMids] = useState<string[]>([]);
  const [minePlatform, setMinePlatform] = useState('');
  const [mineQuery, setMineQuery] = useState('');
  const [pickTag, setPickTag] = useState('');
  const [sources, setSources] = useState<AdSource[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
    const [accountRes, advertisedRes, sourceRes] = await Promise.all([
      api.get<ApiResult<Array<{ platformCode: string; accounts: ChannelAccount[] }>>>('/channel-accounts/by-platform'),
      api.get<ApiResult<AdvertisedMerchant[]>>('/catalog-merchants/advertised'),
      api.get<ApiResult<AdSource[]>>('/ad-sources'),
    ]);
    if (accountRes.data.success) {
      setAccounts(accountRes.data.data.flatMap((group) => group.accounts.map((account) => ({ ...account, platformCode: group.platformCode }))));
    }
    if (advertisedRes.data.success) setAdvertised(advertisedRes.data.data);
    if (sourceRes.data.success) setSources(sourceRes.data.data.map((item) => ({ id: item.id, name: item.name })));
  }, []);

  const searchDiscover = useCallback(async (page = 1, query = discoverQuery) => {
    setDiscoverLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (discoverAccountId) params.set('channelAccountId', String(discoverAccountId));
      if (query.trim()) params.set('q', query.trim());
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
  }, [discoverAccountId, discoverQuery]);

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
    if (!user) return;
    const saved = loadAdSettings(user.id);
    setSettings(saved);
    settingsForm.setFieldsValue(saved);
    setHiddenMids(readHiddenMids(user.id));
    void load().catch(() => message.error('加载商家失败'));
  }, [user, load, settingsForm]);

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
    const next = [...new Set([...readHiddenMids(user.id), row.mid])];
    localStorage.setItem(hiddenStorageKey(user.id), JSON.stringify(next));
    setHiddenMids(next);
    message.success('已取消领取');
  }, [user]);

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

  return (
    <div className="merchant-page">
      <div className="merchant-page__head">
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>我的商家</Typography.Title>
          <div className="merchant-page__stats">
            <span><b>{visibleAdvertised.length}</b> 个商家</span>
            <span className="merchant-state merchant-state--on">已启用 {enabledCount}</span>
            <span className="merchant-state merchant-state--off">已暂停 {visibleAdvertised.length - enabledCount}</span>
          </div>
        </div>
        <Button onClick={() => setSettingsOpen(true)}>投放设置</Button>
      </div>

      <Card className="merchant-board">
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'mine',
              label: `我的商家 (${visibleAdvertised.length})`,
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
                      style={{ width: 240 }}
                      placeholder="搜索商家名/MID"
                      value={mineQuery}
                      onChange={(event) => setMineQuery(event.target.value)}
                    />
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
                      {
                        title: '状态',
                        dataIndex: 'enabled',
                        width: 90,
                        render: (value: boolean) => <span className={value ? 'merchant-state merchant-state--on' : 'merchant-state merchant-state--off'}>{value ? '已启用' : '已暂停'}</span>,
                      },
                      { title: '支持地区', dataIndex: 'countryCode', width: 100, render: (value: string) => regionTags(value) },
                      { title: '主营业务', width: 100, render: () => blank() },
                      { title: '佣金率', width: 80, render: () => blank() },
                      { title: '拒付率', width: 80, render: () => blank() },
                      { title: '结算率', width: 80, render: () => blank() },
                      { title: '待审核佣金', width: 100, render: () => blank() },
                      { title: 'ATC合规度', width: 90, render: () => blank() },
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
              label: discover ? `选取商家 (${discover.total})` : '选取商家',
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
                      { title: '拒付率', width: 80, render: () => blank() },
                      { title: '结算率', width: 80, render: () => blank() },
                      { title: '待审核佣金', width: 110, render: () => blank() },
                      { title: '支持地区', dataIndex: 'supportRegion', width: 140, render: (value: string, row: DiscoverRow) => regionTags(value || row.countryCode) },
                      { title: 'ATC合规度', width: 100, render: () => '—' },
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
          ]}
        />
      </Card>

      <Modal
        title="广告投放设置"
        open={settingsOpen}
        onCancel={() => setSettingsOpen(false)}
        onOk={() => void settingsForm.validateFields().then((values) => {
          if (!user) return;
          saveAdSettings(user.id, values);
          setSettings(values);
          setSettingsOpen(false);
          message.success('投放设置已保存');
        })}
        okText="保存"
      >
        <Form form={settingsForm} layout="vertical">
          <Form.Item name="bidding" label="出价策略">
            <Select options={[
              { value: 'MAXIMIZE_CLICKS', label: '尽可能多的点击' },
              { value: 'MANUAL_CPC', label: '手动 CPC' },
            ]} />
          </Form.Item>
          <Form.Item name="cpcBidCeilingUsd" label="最高 CPC ($)" rules={[{ required: true, message: '填写最高 CPC' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="dailyBudgetUsd" label="日预算 ($)" rules={[{ required: true, message: '填写日预算' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="targetCountry" label="国家" rules={[{ required: true, message: '填写国家' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="languageCode" label="语言">
            <Input />
          </Form.Item>
          <div style={{ color: '#98a2b3' }}>仅限搜索网络 · 不含欧盟政治广告 · 结算货币 USD</div>
        </Form>
      </Modal>

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
                const next = readHiddenMids(user.id).filter((mid) => mid !== launchMerchant.mid);
                localStorage.setItem(hiddenStorageKey(user.id), JSON.stringify(next));
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
