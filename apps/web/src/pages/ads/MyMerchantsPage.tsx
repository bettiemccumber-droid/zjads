import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Form, Input, Modal, Row, Select, Space, Statistic, Table, Tabs, Tag, Typography, message } from 'antd';
import { api, type ApiResult } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { formatCustomerId, loadAdSettings, saveAdSettings, type AdLaunchSettings } from './ad-launch-settings';

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

interface AdvertisedMerchant {
  name: string;
  mid: string;
  platformCode: string;
  merchantUrl: string;
  countryCode: string;
  channelAccountId: number;
  enabled: boolean;
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

interface LocalCampaign {
  id: number;
  campaignName: string;
  status: string;
  customerId: string;
  merchantUrl: string;
  dailyBudgetMicros: string;
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
const PLATFORM_COLOR: Record<string, string> = {
  partnermatic: 'geekblue',
  rewardoo: 'purple',
  linkhaitao: 'cyan',
  linkbux: 'gold',
  ultrainfluence: 'green',
  collabglow: 'blue',
  famesta: 'magenta',
};

/**
 * 平台代码显示成参考页上的短标签。
 */
function platformTag(code: string) {
  const short = PLATFORM_SHORT[code] || (code ? code.slice(0, 2).toUpperCase() : '—');
  return <Tag color={PLATFORM_COLOR[code] || 'default'}>{short}</Tag>;
}

/**
 * 空字段用横线，避免编造拒付率、结算率这些日报里没有的数。
 */
function blank(value?: string) {
  const text = value?.trim();
  return text || '—';
}

/**
 * 商家名称前的商标。有联盟 logo 用图片，没有就用名称首字。
 */
function MerchantMark({ name, logo }: { name: string; logo?: string }) {
  const [broken, setBroken] = useState(false);
  const letter = name.trim().slice(0, 1).toUpperCase() || '?';
  const showImage = Boolean(logo) && !broken;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      {showImage ? (
        <img
          src={logo}
          alt=""
          width={28}
          height={28}
          style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'contain', background: '#f5f5f5', flex: 'none' }}
          onError={() => setBroken(true)}
        />
      ) : (
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            background: '#e6f4ff',
            color: '#1677ff',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 600,
            flex: 'none',
          }}
        >
          {letter}
        </span>
      )}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
    </span>
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

const CAMPAIGN_LABEL: Record<string, string> = {
  WAITING_SUBMIT: '待提交',
  WAITING_PAUSE: '待暂停',
  WAITING_ENABLE: '待启用',
};

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
  const [campaigns, setCampaigns] = useState<LocalCampaign[]>([]);
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
    const [accountRes, advertisedRes, sourceRes, campaignRes] = await Promise.all([
      api.get<ApiResult<Array<{ platformCode: string; accounts: ChannelAccount[] }>>>('/channel-accounts/by-platform'),
      api.get<ApiResult<AdvertisedMerchant[]>>('/catalog-merchants/advertised'),
      api.get<ApiResult<AdSource[]>>('/ad-sources'),
      api.get<ApiResult<LocalCampaign[]>>('/ad-campaigns'),
    ]);
    if (accountRes.data.success) {
      setAccounts(accountRes.data.data.flatMap((group) => group.accounts.map((account) => ({ ...account, platformCode: group.platformCode }))));
    }
    if (advertisedRes.data.success) setAdvertised(advertisedRes.data.data);
    if (sourceRes.data.success) setSources(sourceRes.data.data.map((item) => ({ id: item.id, name: item.name })));
    if (campaignRes.data.success) setCampaigns(campaignRes.data.data);
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
  const platformCounts = useMemo(() => {
    const map = new Map<string, number>();
    advertised.filter((item) => !hiddenSet.has(item.mid)).forEach((item) => {
      const code = item.platformCode || '未知';
      map.set(code, (map.get(code) ?? 0) + 1);
    });
    return [...map.entries()];
  }, [advertised, hiddenSet]);
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

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>我的商家</Typography.Title>
      <Row gutter={16}>
        <Col span={8}>
          <Card>
            <Statistic title="我的商家" value={visibleAdvertised.length} />
            <div style={{ marginTop: 12, color: '#666' }}>
              {platformCounts.length === 0 ? '还没有上过广告的商家' : platformCounts.map(([code, count]) => `${code} ${count}`).join(' · ')}
            </div>
          </Card>
        </Col>
        <Col span={16}>
          <Card
            title="广告投放设置"
            extra={<Button type="primary" onClick={() => void settingsForm.validateFields().then((values) => {
              if (!user) return;
              saveAdSettings(user.id, values);
              setSettings(values);
              message.success('投放设置已保存');
            })}>保存</Button>}
          >
            <Form form={settingsForm} layout="inline">
              <Form.Item name="bidding" label="出价策略">
                <Select style={{ width: 160 }} options={[
                  { value: 'MAXIMIZE_CLICKS', label: '尽可能多的点击' },
                  { value: 'MANUAL_CPC', label: '手动 CPC' },
                ]} />
              </Form.Item>
              <Form.Item name="cpcBidCeilingUsd" label="最高 CPC ($)" rules={[{ required: true }]}>
                <Input style={{ width: 90 }} />
              </Form.Item>
              <Form.Item name="dailyBudgetUsd" label="日预算 ($)" rules={[{ required: true }]}>
                <Input style={{ width: 90 }} />
              </Form.Item>
              <Form.Item name="targetCountry" label="国家" rules={[{ required: true }]}>
                <Input style={{ width: 70 }} />
              </Form.Item>
              <Form.Item name="languageCode" label="语言">
                <Input style={{ width: 70 }} />
              </Form.Item>
            </Form>
            <div style={{ marginTop: 8, color: '#888' }}>仅限搜索网络 · 不含欧盟政治广告 · 结算货币 USD</div>
          </Card>
        </Col>
      </Row>

      <Card>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'mine',
              label: `我的商家 (${visibleAdvertised.length})`,
              children: (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
                      style={{ width: 220 }}
                      placeholder="搜索商家名/MID"
                      value={mineQuery}
                      onChange={(event) => setMineQuery(event.target.value)}
                    />
                    <Button onClick={() => { setMinePlatform(''); setMineQuery(''); }}>重置</Button>
                  </div>
                  <Table
                    rowKey={(row) => `${row.channelAccountId}:${row.mid}`}
                    size="small"
                    pagination={{ pageSize: 20, showSizeChanger: false }}
                    dataSource={visibleAdvertised}
                    columns={[
                      { title: '商家名称', dataIndex: 'name', ellipsis: true, render: (value: string) => <MerchantMark name={value} /> },
                      { title: '平台', dataIndex: 'platformCode', width: 80, render: (value: string) => platformTag(value) },
                      { title: 'MID', dataIndex: 'mid', width: 110 },
                      { title: '主营业务', render: () => '—' },
                      { title: '佣金率', render: () => '—' },
                      { title: '拒付率', render: () => '—' },
                      { title: '结算率', render: () => '—' },
                      { title: '待审核佣金', render: () => '—' },
                      { title: '支持地区', dataIndex: 'countryCode', ellipsis: true, render: (value: string) => blank(value) },
                      { title: '状态', dataIndex: 'enabled', width: 90, render: (value: boolean) => <Tag color={value ? 'success' : 'warning'}>{value ? '已启用' : '已暂停'}</Tag> },
                      { title: 'ATC合规度', render: () => '—' },
                      { title: '在投人数', render: () => '—' },
                      { title: '标签', render: () => '—' },
                      {
                        title: '操作',
                        width: 160,
                        render: (_: unknown, row: AdvertisedMerchant) => (
                          <Space size={0}>
                            <Button type="link" disabled={!row.merchantUrl || !row.channelAccountId} onClick={() => launchAdvertised(row)}>新增广告</Button>
                            <Button type="link" danger onClick={() => hideAdvertised(row)}>取消领取</Button>
                          </Space>
                        ),
                      },
                    ]}
                  />
                </Space>
              ),
            },
            {
              key: 'pick',
              label: discover ? `选取商家 (${discover.total})` : '选取商家',
              children: (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
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
                    rowKey={(row) => `${row.channelAccountId}:${row.mid}`}
                    size="small"
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
                        ellipsis: true,
                        render: (value: string, row: DiscoverRow) => <MerchantMark name={value} logo={row.logo} />,
                      },
                      { title: '平台', dataIndex: 'platformCode', width: 80, render: (value: string) => platformTag(value) },
                      { title: 'MID', dataIndex: 'mid', width: 110 },
                      { title: '主营业务', dataIndex: 'categories', ellipsis: true, render: (value: string) => blank(value) },
                      { title: '佣金率', dataIndex: 'commRate', ellipsis: true, render: (value: string) => blank(value) },
                      { title: '拒付率', width: 80, render: () => '—' },
                      { title: '结算率', width: 80, render: () => '—' },
                      { title: '待审核佣金', width: 110, render: () => '—' },
                      { title: '支持地区', dataIndex: 'supportRegion', ellipsis: true, render: (value: string, row: DiscoverRow) => blank(value || row.countryCode) },
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

      <Card title="本地系列">
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={campaigns}
          columns={[
            { title: '系列名', dataIndex: 'campaignName' },
            { title: '状态', dataIndex: 'status', render: (value: string) => <Tag>{CAMPAIGN_LABEL[value] ?? value}</Tag> },
            { title: 'CID', dataIndex: 'customerId', render: (value: string) => formatCustomerId(value) },
            { title: '商家网址', dataIndex: 'merchantUrl', ellipsis: true },
            { title: '日预算 micros', dataIndex: 'dailyBudgetMicros' },
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
    </Space>
  );
}
