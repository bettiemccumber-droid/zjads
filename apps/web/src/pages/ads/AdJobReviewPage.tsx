import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Steps,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  CloudDownloadOutlined,
  CopyOutlined,
  DeleteOutlined,
  ReloadOutlined,
  RocketOutlined,
  SaveOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { api, type ApiResult } from '../../api/client';
import { AD_LANGUAGE_OPTIONS, formatCustomerId } from './ad-launch-settings';
import './AdJobReviewPage.css';

interface AdKeyword {
  text: string;
  matchType: 'BROAD' | 'PHRASE' | 'EXACT';
}

interface AdSitelink {
  linkText: string;
  description1: string;
  description2: string;
  finalUrl: string;
  verified: boolean;
}

interface AdStructuredSnippet {
  header: string;
  values: string[];
}

interface AdDraft {
  headlines: string[];
  descriptions: string[];
  keywords: AdKeyword[];
  negativeKeywords: AdKeyword[];
  sitelinks: AdSitelink[];
  callouts: string[];
  structuredSnippets: AdStructuredSnippet[];
  promotion: string;
  merchantUrl: string;
  finalUrlSuffix: string;
  bidding: 'MAXIMIZE_CLICKS' | 'MANUAL_CPC';
  dailyBudgetUsd: string;
  cpcBidCeilingUsd: string;
  languageCode: string;
  geoTargetId: string;
}

interface AdJob {
  id: string;
  status: string;
  step: string;
  progress: number;
  progressMessage: string;
  errorMessage: string | null;
  mccCustomerId: string;
  targetCountry: string;
  languageCode: string;
  draft: AdDraft | null;
  nextSequence?: number;
  suggestedCampaignName?: string;
  affiliateAlias?: string;
  input?: {
    merchantName?: string;
    merchantUrl?: string;
    mid?: string;
    platformCode?: string;
    affiliateAlias?: string;
  } | null;
  campaign?: { status: string; customerId?: string } | null;
}

interface AdsCustomer {
  id: number;
  customerId: string;
  googleStatus: string;
  availability: string;
  currencyCode: string;
  timeZone: string;
  activeCampaignCount: number;
  verificationStatus?: string;
}

interface SemrushSuggestion {
  keyword: string;
  position: number | null;
  searchVolume: number | null;
  cpc: number | null;
  traffic: number | null;
}

const MATCH_OPTIONS = [
  { value: 'BROAD', label: '广泛匹配' },
  { value: 'PHRASE', label: '词组匹配' },
  { value: 'EXACT', label: '完全匹配' },
];

const SNIPPET_HEADERS = [
  'AMENITIES', 'BRANDS', 'COURSES', 'DEGREE_PROGRAMS', 'DESTINATIONS',
  'FEATURED_HOTELS', 'INSURANCE_COVERAGE', 'MODELS', 'NEIGHBORHOODS',
  'SERVICES', 'SHOWS', 'STYLES', 'TYPES',
];

const HEADLINE_MAX = 30;
const DESC_MAX = 70;
const SITELINK_TEXT_MAX = 20;
const SITELINK_DESC_MAX = 25;

function emptyDraft(): AdDraft {
  return {
    headlines: [],
    descriptions: [],
    keywords: [],
    negativeKeywords: [],
    sitelinks: [],
    callouts: [],
    structuredSnippets: [],
    promotion: '',
    merchantUrl: '',
    finalUrlSuffix: '',
    bidding: 'MAXIMIZE_CLICKS',
    dailyBudgetUsd: '3.00',
    cpcBidCeilingUsd: '0.50',
    languageCode: 'en',
    geoTargetId: '',
  };
}

function isEligible(row: AdsCustomer) {
  const verification = row.verificationStatus ?? 'UNKNOWN';
  return (
    row.availability === 'available'
    && row.googleStatus === 'ENABLED'
    && row.currencyCode === 'USD'
    && verification !== 'PENDING_USER_ACTION'
    && verification !== 'FAILURE'
  );
}

function charCount(text: string, max: number) {
  const len = [...text].length;
  return (
    <span className={len > max ? 'ad-review__count ad-review__count--over' : 'ad-review__count'}>
      {len}/{max}
    </span>
  );
}

function copyText(value: string) {
  void navigator.clipboard.writeText(value).then(
    () => message.success('已复制'),
    () => message.error('复制失败'),
  );
}

/**
 * 广告任务预览编辑页。左栏文案扩展，右栏发布账户与设置，对齐参考发布流程。
 */
export default function AdJobReviewPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState<AdJob | null>(null);
  const [draft, setDraft] = useState<AdDraft>(emptyDraft());
  const [customers, setCustomers] = useState<AdsCustomer[]>([]);
  const [customerId, setCustomerId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [pullingKeywords, setPullingKeywords] = useState(false);
  const [syncingCid, setSyncingCid] = useState(false);
  const [suggestions, setSuggestions] = useState<SemrushSuggestion[]>([]);
  const [negInput, setNegInput] = useState('');
  const [campaignName, setCampaignName] = useState('');

  const loadJob = useCallback(async () => {
    if (!id) return;
    const res = await api.get<ApiResult<AdJob>>(`/ad-jobs/${id}`);
    if (!res.data.success) {
      message.error(res.data.message || '加载任务失败');
      return;
    }
    const next = res.data.data;
    setJob(next);
    if (next.draft) setDraft({ ...emptyDraft(), ...next.draft });
    if (next.suggestedCampaignName) {
      setCampaignName((prev) => (prev.trim() ? prev : next.suggestedCampaignName || ''));
    }
  }, [id]);

  const loadCustomers = useCallback(async (mccCustomerId: string) => {
    if (!mccCustomerId || /^[A-Za-z]/.test(mccCustomerId)) {
      setCustomers([]);
      return;
    }
    try {
      const res = await api.get<ApiResult<AdsCustomer[]>>('/google-ads/customers', {
        params: { mccCustomerId },
      });
      if (!res.data.success) return;
      const rows = res.data.data ?? [];
      setCustomers(rows);
      const eligible = rows.filter(isEligible);
      setCustomerId((prev) => {
        if (prev && eligible.some((row) => row.customerId === prev)) return prev;
        return eligible[0]?.customerId;
      });
    } catch {
      setCustomers([]);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void loadJob()
      .catch(() => message.error('加载任务失败'))
      .finally(() => setLoading(false));
  }, [loadJob]);

  useEffect(() => {
    if (!job?.mccCustomerId) return;
    void loadCustomers(job.mccCustomerId);
  }, [job?.mccCustomerId, loadCustomers]);

  useEffect(() => {
    if (!job) return;
    if (job.status === 'READY_FOR_REVIEW' || job.status === 'COMPLETED' || job.status === 'FAILED') return;
    const timer = window.setInterval(() => {
      void loadJob().catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [job, loadJob]);

  const eligibleCustomers = useMemo(() => customers.filter(isEligible), [customers]);
  const merchantName = job?.input?.merchantName || draft.merchantUrl || '广告任务';
  const editable = job?.status === 'READY_FOR_REVIEW';
  const generating = Boolean(job && !['READY_FOR_REVIEW', 'COMPLETED', 'FAILED'].includes(job.status));

  const saveDraft = async () => {
    if (!id || !editable) return;
    setSaving(true);
    try {
      const res = await api.patch<ApiResult<AdJob>>(`/ad-jobs/${id}/draft`, draft);
      if (!res.data.success) {
        message.error(res.data.message || '保存失败');
        return;
      }
      setJob(res.data.data);
      if (res.data.data.draft) setDraft({ ...emptyDraft(), ...res.data.data.draft });
      message.success('草稿已保存');
    } catch (err) {
      const apiMessage = (err as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      message.error(Array.isArray(apiMessage) ? apiMessage.join('；') : apiMessage || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const syncCidList = async () => {
    if (!job?.mccCustomerId) return;
    setSyncingCid(true);
    try {
      await api.post('/google-ads/sync', { mccCustomerId: job.mccCustomerId });
      await loadCustomers(job.mccCustomerId);
      message.success('已同步 CID 列表');
    } catch (err) {
      const apiMessage = (err as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      message.error(Array.isArray(apiMessage) ? apiMessage.join('；') : apiMessage || '同步失败');
    } finally {
      setSyncingCid(false);
    }
  };

  const importSemrush = async () => {
    if (!id || !editable) return;
    setPullingKeywords(true);
    try {
      const res = await api.post<ApiResult<{
        job: AdJob;
        imported: number;
        domain: string;
        suggestions: SemrushSuggestion[];
      }>>(`/ad-jobs/${id}/keywords/semrush`, { limit: 30 });
      if (!res.data.success) {
        message.error(res.data.message || '拉词失败');
        return;
      }
      const payload = res.data.data;
      setJob(payload.job);
      if (payload.job.draft) setDraft({ ...emptyDraft(), ...payload.job.draft });
      setSuggestions(payload.suggestions ?? []);
      message.success(`已导入 ${payload.imported} 个关键词（${payload.domain}）`);
    } catch (err) {
      const apiMessage = (err as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      message.error(Array.isArray(apiMessage) ? apiMessage.join('；') : apiMessage || '拉词失败');
    } finally {
      setPullingKeywords(false);
    }
  };

  const confirmPublish = () => {
    if (!id || !editable) return;
    if (!customerId) {
      message.warning('请先选择可投放的 CID');
      return;
    }
    Modal.confirm({
      title: '确认提交到 Google Ads？',
      content: `将发布到 CID ${formatCustomerId(customerId)}。发布后不可在此页撤回。`,
      okText: '提交到 Google Ads',
      cancelText: '再看看',
      onOk: async () => {
        setPublishing(true);
        try {
          const saved = await api.patch<ApiResult<AdJob>>(`/ad-jobs/${id}/draft`, draft);
          if (!saved.data.success) {
            message.error(saved.data.message || '保存草稿失败');
            throw new Error('save failed');
          }
          const res = await api.post<ApiResult<AdJob>>(`/ad-jobs/${id}/publish`, {
            customerId,
            campaignName: campaignName.trim() || undefined,
          });
          if (!res.data.success) {
            message.error(res.data.message || '发布失败');
            throw new Error('publish failed');
          }
          setJob(res.data.data);
          if (res.data.data.draft) setDraft({ ...emptyDraft(), ...res.data.data.draft });
          const submitted = res.data.data.campaign?.status === 'ENABLED';
          message.success(submitted ? '已提交到 Google Ads' : '已写入待提交队列');
        } catch (err) {
          if (err instanceof Error && (err.message === 'save failed' || err.message === 'publish failed')) {
            await loadJob().catch(() => undefined);
            throw err;
          }
          const apiMessage = (err as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
          message.error(Array.isArray(apiMessage) ? apiMessage.join('；') : apiMessage || '发布失败');
          await loadJob().catch(() => undefined);
          throw err;
        } finally {
          setPublishing(false);
        }
      },
    });
  };

  if (loading && !job) {
    return (
      <div className="ad-review ad-review--center">
        <Spin size="large" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="ad-review">
        <Alert type="error" showIcon message="任务不存在" action={<Button onClick={() => navigate('/ads/merchants')}>返回商家</Button>} />
      </div>
    );
  }

  const stepCurrent = job.status === 'COMPLETED' ? 2 : editable || job.status === 'FAILED' ? 1 : 0;

  return (
    <div className="ad-review">
      <div className="ad-review__head">
        <Space align="start" size={12}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/ads/merchants')}>返回商家管理</Button>
          <div>
            <Typography.Title level={4} className="ad-review__title">广告预览 — {merchantName}</Typography.Title>
            <div className="ad-review__meta">
              {job.input?.platformCode ? <Tag>{job.input.platformCode}</Tag> : null}
              <Tag color="blue">{job.targetCountry}</Tag>
              <Tag color="orange">{draft.languageCode || job.languageCode || 'en'}</Tag>
              <Tag>MCC {formatCustomerId(job.mccCustomerId)}</Tag>
            </div>
          </div>
        </Space>
        {editable ? (
          <Space>
            <Button icon={<SaveOutlined />} loading={saving} onClick={() => void saveDraft()}>保存草稿</Button>
            <Button type="primary" icon={<SendOutlined />} loading={publishing} disabled={!customerId} onClick={confirmPublish}>
              提交到 Google Ads
            </Button>
          </Space>
        ) : null}
      </div>

      <Steps
        size="small"
        current={stepCurrent}
        items={[
          { title: '领取与生成', description: generating ? job.progressMessage : '已完成' },
          { title: '文案与扩展', description: '编辑标题、描述、扩展' },
          { title: '确认发布', description: '选择 CID 后提交' },
        ]}
      />

      {generating ? (
        <Alert
          type="info"
          showIcon
          message={`${job.progressMessage}（${job.progress}%）`}
          description="正在分析商家网站并生成文案。生成完成后可在此编辑并确认发布。"
        />
      ) : null}

      {job.status === 'FAILED' ? (
        <Alert type="error" showIcon message="生成失败" description={job.errorMessage || '请返回商家页重新领取'} />
      ) : null}

      {job.status === 'COMPLETED' ? (
        <Alert
          type="success"
          showIcon
          message="已处理完成"
          description={(
            <Space>
              <span>系列状态：{job.campaign?.status || '—'}</span>
              <Link to="/ads/articles">去文章管理</Link>
            </Space>
          )}
        />
      ) : null}

      {!editable ? null : (
        <Row gutter={[16, 16]} className="ad-review__layout">
          <Col xs={24} lg={14} xl={15}>
            <Card size="small">
              <div className="ad-review__section-title">
                <h4>广告标题（{draft.headlines.length}/15）</h4>
              </div>
              {draft.headlines.map((text, index) => (
                <div className="ad-review__row" key={`h-${index}`}>
                  <div className="ad-review__row-index">{index + 1}</div>
                  <div className="ad-review__row-main">
                    <Input
                      value={text}
                      maxLength={40}
                      onChange={(event) => {
                        const headlines = [...draft.headlines];
                        headlines[index] = event.target.value;
                        setDraft({ ...draft, headlines });
                      }}
                    />
                  </div>
                  <div className="ad-review__row-actions">
                    {charCount(text, HEADLINE_MAX)}
                    <Space size={4}>
                      <Button type="text" size="small" icon={<CopyOutlined />} onClick={() => copyText(text)} />
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => setDraft({
                          ...draft,
                          headlines: draft.headlines.filter((_, i) => i !== index),
                        })}
                      />
                    </Space>
                  </div>
                </div>
              ))}
              {draft.headlines.length < 15 ? (
                <Button type="dashed" block onClick={() => setDraft({ ...draft, headlines: [...draft.headlines, ''] })}>
                  添加标题
                </Button>
              ) : null}
            </Card>

            <Card size="small" style={{ marginTop: 16 }}>
              <div className="ad-review__section-title">
                <h4>广告描述（{draft.descriptions.length}/4）</h4>
              </div>
              {draft.descriptions.map((text, index) => (
                <div className="ad-review__row" key={`d-${index}`}>
                  <div className="ad-review__row-index">{index + 1}</div>
                  <div className="ad-review__row-main">
                    <Input.TextArea
                      value={text}
                      autoSize={{ minRows: 1, maxRows: 3 }}
                      onChange={(event) => {
                        const descriptions = [...draft.descriptions];
                        descriptions[index] = event.target.value;
                        setDraft({ ...draft, descriptions });
                      }}
                    />
                  </div>
                  <div className="ad-review__row-actions">
                    {charCount(text, DESC_MAX)}
                    <Space size={4}>
                      <Button type="text" size="small" icon={<CopyOutlined />} onClick={() => copyText(text)} />
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => setDraft({
                          ...draft,
                          descriptions: draft.descriptions.filter((_, i) => i !== index),
                        })}
                      />
                    </Space>
                  </div>
                </div>
              ))}
              {draft.descriptions.length < 4 ? (
                <Button type="dashed" block onClick={() => setDraft({ ...draft, descriptions: [...draft.descriptions, ''] })}>
                  添加描述
                </Button>
              ) : null}
              <div className="ad-review__hint">内部规范描述 ≤70 字（严于 Google 90）。</div>
            </Card>

            <Card
              size="small"
              style={{ marginTop: 16 }}
              title="关键词"
              extra={(
                <Button
                  size="small"
                  icon={<CloudDownloadOutlined />}
                  loading={pullingKeywords}
                  onClick={() => void importSemrush()}
                >
                  Semrush 拉词
                </Button>
              )}
            >
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                {draft.keywords.map((keyword, index) => (
                  <Space.Compact key={`k-${index}`} style={{ width: '100%' }}>
                    <Input
                      value={keyword.text}
                      onChange={(event) => {
                        const keywords = [...draft.keywords];
                        keywords[index] = { ...keyword, text: event.target.value };
                        setDraft({ ...draft, keywords });
                      }}
                    />
                    <Select
                      style={{ width: 112 }}
                      value={keyword.matchType}
                      options={MATCH_OPTIONS}
                      onChange={(matchType) => {
                        const keywords = [...draft.keywords];
                        keywords[index] = { ...keyword, matchType };
                        setDraft({ ...draft, keywords });
                      }}
                    />
                    <Button
                      icon={<DeleteOutlined />}
                      onClick={() => setDraft({
                        ...draft,
                        keywords: draft.keywords.filter((_, i) => i !== index),
                      })}
                    />
                  </Space.Compact>
                ))}
                <Button
                  type="dashed"
                  block
                  onClick={() => setDraft({
                    ...draft,
                    keywords: [...draft.keywords, { text: '', matchType: 'PHRASE' }],
                  })}
                >
                  + 添加关键词
                </Button>
                {suggestions.length ? (
                  <div className="ad-review__hint">
                    Semrush 建议：{suggestions.slice(0, 8).map((row) => row.keyword).join(' · ')}
                  </div>
                ) : null}
              </Space>
            </Card>

            <Card size="small" style={{ marginTop: 16 }} title={`否定关键词（${draft.negativeKeywords.length} 条）`}>
              <div className="ad-review__negatives">
                {draft.negativeKeywords.map((keyword, index) => (
                  <Tag
                    key={`n-${index}`}
                    className="ad-review__negative-tag"
                    closable
                    color="orange"
                    onClose={(event) => {
                      event.preventDefault();
                      setDraft({
                        ...draft,
                        negativeKeywords: draft.negativeKeywords.filter((_, i) => i !== index),
                      });
                    }}
                  >
                    -{keyword.text}
                  </Tag>
                ))}
              </div>
              <Space.Compact style={{ width: '100%', marginTop: 12 }}>
                <Input
                  value={negInput}
                  placeholder="输入否定词后回车添加"
                  onChange={(event) => setNegInput(event.target.value)}
                  onPressEnter={() => {
                    const text = negInput.trim();
                    if (!text) return;
                    setDraft({
                      ...draft,
                      negativeKeywords: [...draft.negativeKeywords, { text, matchType: 'BROAD' }],
                    });
                    setNegInput('');
                  }}
                />
                <Button
                  type="primary"
                  onClick={() => {
                    const text = negInput.trim();
                    if (!text) return;
                    setDraft({
                      ...draft,
                      negativeKeywords: [...draft.negativeKeywords, { text, matchType: 'BROAD' }],
                    });
                    setNegInput('');
                  }}
                >
                  添加
                </Button>
              </Space.Compact>
              <div className="ad-review__hint">否定词默认广泛匹配，提交时一并写入系列，过滤非购买意图流量。</div>
            </Card>

            <Card size="small" style={{ marginTop: 16 }} title={`站内链接（${draft.sitelinks.length}/8）`}>
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message="建议至少 6 条站内链接，每条使用不同落地页。"
              />
              {draft.sitelinks.map((link, index) => (
                <Card
                  key={`sl-${index}`}
                  size="small"
                  type="inner"
                  className="ad-review__sitelink"
                  title={`站内链接 ${index + 1}`}
                  extra={(
                    <Space>
                      {link.verified ? <Tag color="success">已验证</Tag> : <Tag>未验证</Tag>}
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => setDraft({
                          ...draft,
                          sitelinks: draft.sitelinks.filter((_, i) => i !== index),
                        })}
                      />
                    </Space>
                  )}
                >
                  <Row gutter={[8, 8]}>
                    <Col span={8}>
                      <Input
                        placeholder="链接文字"
                        value={link.linkText}
                        onChange={(event) => {
                          const sitelinks = [...draft.sitelinks];
                          sitelinks[index] = { ...link, linkText: event.target.value };
                          setDraft({ ...draft, sitelinks });
                        }}
                        suffix={charCount(link.linkText, SITELINK_TEXT_MAX)}
                      />
                    </Col>
                    <Col span={8}>
                      <Input
                        placeholder="描述 1"
                        value={link.description1}
                        onChange={(event) => {
                          const sitelinks = [...draft.sitelinks];
                          sitelinks[index] = { ...link, description1: event.target.value };
                          setDraft({ ...draft, sitelinks });
                        }}
                        suffix={charCount(link.description1, SITELINK_DESC_MAX)}
                      />
                    </Col>
                    <Col span={8}>
                      <Input
                        placeholder="描述 2"
                        value={link.description2}
                        onChange={(event) => {
                          const sitelinks = [...draft.sitelinks];
                          sitelinks[index] = { ...link, description2: event.target.value };
                          setDraft({ ...draft, sitelinks });
                        }}
                        suffix={charCount(link.description2, SITELINK_DESC_MAX)}
                      />
                    </Col>
                    <Col span={24}>
                      <Input
                        placeholder="落地页 URL（需与其它站内链接不同）"
                        value={link.finalUrl}
                        onChange={(event) => {
                          const sitelinks = [...draft.sitelinks];
                          sitelinks[index] = { ...link, finalUrl: event.target.value, verified: false };
                          setDraft({ ...draft, sitelinks });
                        }}
                      />
                    </Col>
                  </Row>
                </Card>
              ))}
              {draft.sitelinks.length < 8 ? (
                <Button
                  type="dashed"
                  block
                  onClick={() => setDraft({
                    ...draft,
                    sitelinks: [
                      ...draft.sitelinks,
                      {
                        linkText: '',
                        description1: '',
                        description2: '',
                        finalUrl: draft.merchantUrl,
                        verified: false,
                      },
                    ],
                  })}
                >
                  添加站内链接
                </Button>
              ) : null}
            </Card>

            <Card size="small" style={{ marginTop: 16 }} title="宣传信息 / 促销 / 结构化摘要">
              <Form layout="vertical">
                <Form.Item label="宣传信息（每行一条，≤25）">
                  <Input.TextArea
                    rows={3}
                    value={draft.callouts.join('\n')}
                    onChange={(event) => setDraft({
                      ...draft,
                      callouts: event.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).slice(0, 8),
                    })}
                  />
                </Form.Item>
                <Form.Item label="促销（只写这里，不要写进宣传信息）">
                  <Input
                    value={draft.promotion}
                    onChange={(event) => setDraft({ ...draft, promotion: event.target.value })}
                  />
                </Form.Item>
                <Form.Item label="结构化摘要">
                  <Space direction="vertical" style={{ width: '100%' }} size={8}>
                    {(draft.structuredSnippets.length ? draft.structuredSnippets : [{ header: 'TYPES', values: [] }]).map((snippet, index) => (
                      <Card key={`s-${index}`} size="small" type="inner">
                        <Select
                          style={{ width: '100%', marginBottom: 8 }}
                          value={snippet.header}
                          options={SNIPPET_HEADERS.map((header) => ({ value: header, label: header }))}
                          onChange={(header) => {
                            const structuredSnippets = [...(draft.structuredSnippets.length ? draft.structuredSnippets : [{ header: 'TYPES', values: [] }])];
                            structuredSnippets[index] = { ...structuredSnippets[index], header };
                            setDraft({ ...draft, structuredSnippets });
                          }}
                        />
                        <Input.TextArea
                          rows={2}
                          placeholder="逗号或换行分隔，至少 4 个值"
                          value={snippet.values.join(', ')}
                          onChange={(event) => {
                            const values = event.target.value
                              .split(/[,\n]/)
                              .map((item) => item.trim())
                              .filter(Boolean)
                              .slice(0, 10);
                            const structuredSnippets = [...(draft.structuredSnippets.length ? draft.structuredSnippets : [{ header: 'TYPES', values: [] }])];
                            structuredSnippets[index] = { ...structuredSnippets[index], values };
                            setDraft({ ...draft, structuredSnippets });
                          }}
                        />
                      </Card>
                    ))}
                  </Space>
                </Form.Item>
              </Form>
            </Card>
          </Col>

          <Col xs={24} lg={10} xl={9}>
            <div className="ad-review__aside">
              <Card size="small" title="发布账户 (CID)">
                <Form layout="vertical">
                  <Form.Item label="MCC 账户">
                    <Input value={formatCustomerId(job.mccCustomerId)} disabled />
                  </Form.Item>
                  <Form.Item
                    label={(
                      <Space>
                        <span>CID 客户账户</span>
                        <Button type="link" size="small" icon={<ReloadOutlined />} loading={syncingCid} onClick={() => void syncCidList()}>
                          同步 CID 列表
                        </Button>
                      </Space>
                    )}
                    required
                  >
                    <Select
                      showSearch
                      optionFilterProp="label"
                      value={customerId}
                      placeholder={eligibleCustomers.length ? '选择空闲子账号' : '没有可用 CID'}
                      options={eligibleCustomers.map((row) => ({
                        value: row.customerId,
                        label: `${formatCustomerId(row.customerId)} - ${row.activeCampaignCount}`,
                      }))}
                      onChange={setCustomerId}
                    />
                    <div className="ad-review__hint">右侧数字为在投系列数；已排除待验证 / 禁用账户。</div>
                  </Form.Item>
                  {customerId ? (
                    <div className="ad-review__cid-banner">
                      将发布到 CID: {formatCustomerId(customerId)}
                    </div>
                  ) : (
                    <Alert type="warning" showIcon message="请选择可投放的 CID" style={{ marginTop: 8 }} />
                  )}
                  <Form.Item label="广告系列名（可修改）" style={{ marginTop: 12 }}>
                    <Input
                      value={campaignName}
                      maxLength={120}
                      onChange={(event) => setCampaignName(event.target.value)}
                      suffix={<span className="ad-review__count">{campaignName.length}/120</span>}
                    />
                    <div className="ad-review__hint">
                      格式：序号-联盟序号-商家-国家-日期-MID。国家段需与草稿一致（{job.targetCountry}）。
                      {job.affiliateAlias ? ` 当前联盟序号：${job.affiliateAlias}` : ''}
                    </div>
                  </Form.Item>
                </Form>
              </Card>

              <Card size="small" title="广告设置" style={{ marginTop: 16 }}>
                <Form layout="vertical">
                  <Form.Item label="每日预算 (USD)">
                    <Input
                      prefix="$"
                      value={draft.dailyBudgetUsd}
                      onChange={(event) => setDraft({ ...draft, dailyBudgetUsd: event.target.value })}
                    />
                  </Form.Item>
                  <Form.Item label="出价策略">
                    <Select
                      value={draft.bidding}
                      options={[
                        { value: 'MAXIMIZE_CLICKS', label: '尽可能多的点击' },
                        { value: 'MANUAL_CPC', label: '手动 CPC' },
                      ]}
                      onChange={(bidding) => setDraft({ ...draft, bidding })}
                    />
                  </Form.Item>
                  <Form.Item label="最高 CPC (USD)">
                    <Input
                      prefix="$"
                      value={draft.cpcBidCeilingUsd}
                      onChange={(event) => setDraft({ ...draft, cpcBidCeilingUsd: event.target.value })}
                    />
                  </Form.Item>
                  <Form.Item label="广告语言">
                    <Select
                      value={draft.languageCode || undefined}
                      options={AD_LANGUAGE_OPTIONS}
                      onChange={(languageCode) => setDraft({ ...draft, languageCode })}
                    />
                    <div className="ad-review__hint">Google Ads 系列语言定向，决定向哪些语言用户展示。</div>
                  </Form.Item>
                </Form>
              </Card>

              <Card size="small" title="商家信息" style={{ marginTop: 16 }}>
                <div className="ad-review__meta" style={{ marginBottom: 12 }}>
                  <Tag>{merchantName}</Tag>
                  {job.input?.platformCode ? <Tag>{job.input.platformCode}</Tag> : null}
                  <Tag color="blue">{job.targetCountry}</Tag>
                  <Tag color="orange">{draft.languageCode || 'en'}</Tag>
                </div>
                <Form layout="vertical">
                  <Form.Item label="落地页 URL">
                    <Space.Compact style={{ width: '100%' }}>
                      <Input
                        value={draft.merchantUrl}
                        onChange={(event) => setDraft({ ...draft, merchantUrl: event.target.value })}
                      />
                      <Button icon={<CopyOutlined />} onClick={() => copyText(draft.merchantUrl)} />
                    </Space.Compact>
                  </Form.Item>
                  <Form.Item label="最终到达网址后缀">
                    <Input
                      value={draft.finalUrlSuffix}
                      placeholder="utm_source=... 不要以 ? 或 & 开头"
                      onChange={(event) => setDraft({ ...draft, finalUrlSuffix: event.target.value })}
                    />
                    <div className="ad-review__hint">提交 Google Ads 后会自动附加到落地页 URL 末尾。</div>
                  </Form.Item>
                </Form>
                <Button
                  type="primary"
                  className="ad-review__publish"
                  icon={<RocketOutlined />}
                  size="large"
                  loading={publishing}
                  disabled={!customerId}
                  onClick={confirmPublish}
                >
                  提交到 Google Ads
                </Button>
              </Card>
            </div>
          </Col>
        </Row>
      )}
    </div>
  );
}
