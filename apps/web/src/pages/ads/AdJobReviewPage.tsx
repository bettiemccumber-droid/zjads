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
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { ArrowLeftOutlined, CloudDownloadOutlined, SaveOutlined, SendOutlined } from '@ant-design/icons';
import { api, type ApiResult } from '../../api/client';
import { formatCustomerId } from './ad-launch-settings';
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
  input?: {
    merchantName?: string;
    merchantUrl?: string;
    mid?: string;
    platformCode?: string;
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
  'AMENITIES',
  'BRANDS',
  'COURSES',
  'DEGREE_PROGRAMS',
  'DESTINATIONS',
  'FEATURED_HOTELS',
  'INSURANCE_COVERAGE',
  'MODELS',
  'NEIGHBORHOODS',
  'SERVICES',
  'SHOWS',
  'STYLES',
  'TYPES',
];

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

/**
 * 广告任务预览编辑页：生成中轮询；待确认时可改草稿、拉 Semrush 词、选 CID 后确认发布。
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
  const [suggestions, setSuggestions] = useState<SemrushSuggestion[]>([]);

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
      title: '确认发布到 Google Ads？',
      content: `将使用 CID ${formatCustomerId(customerId)} 创建搜索广告。发布后不可在此页撤回。`,
      okText: '确认发布',
      cancelText: '再看看',
      onOk: async () => {
        setPublishing(true);
        try {
          const saved = await api.patch<ApiResult<AdJob>>(`/ad-jobs/${id}/draft`, draft);
          if (!saved.data.success) {
            message.error(saved.data.message || '保存草稿失败');
            throw new Error('save failed');
          }
          const res = await api.post<ApiResult<AdJob>>(`/ad-jobs/${id}/publish`, { customerId });
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

  return (
    <div className="ad-review">
      <div className="ad-review__head">
        <Space align="start">
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/ads/merchants')}>返回</Button>
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>{merchantName}</Typography.Title>
            <Typography.Text type="secondary">
              {job.input?.platformCode ? `${job.input.platformCode} · ` : ''}
              {job.input?.mid ? `MID ${job.input.mid} · ` : ''}
              MCC {formatCustomerId(job.mccCustomerId)} · {job.targetCountry}
            </Typography.Text>
          </div>
        </Space>
        <Space>
          {editable ? (
            <>
              <Button icon={<SaveOutlined />} loading={saving} onClick={() => void saveDraft()}>保存草稿</Button>
              <Button type="primary" icon={<SendOutlined />} loading={publishing} onClick={confirmPublish}>
                确认发布
              </Button>
            </>
          ) : null}
        </Space>
      </div>

      {job.status !== 'READY_FOR_REVIEW' && job.status !== 'COMPLETED' ? (
        <Alert
          style={{ marginBottom: 16 }}
          type={job.status === 'FAILED' ? 'error' : 'info'}
          showIcon
          message={`${job.progressMessage}（${job.progress}%）`}
          description={job.errorMessage || (job.status === 'FAILED' ? null : '生成完成后可在此编辑并确认发布。')}
        />
      ) : null}

      {job.status === 'COMPLETED' ? (
        <Alert
          style={{ marginBottom: 16 }}
          type="success"
          showIcon
          message="已处理完成"
          description={
            <Space>
              <span>系列状态：{job.campaign?.status || '—'}</span>
              <Link to="/ads/articles">去文章管理</Link>
            </Space>
          }
        />
      ) : null}

      {!editable ? null : (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={14}>
              <Card title="标题（最多 15 条，每条 ≤30）" size="small">
                <Space direction="vertical" style={{ width: '100%' }} size={8}>
                  {draft.headlines.map((text, index) => (
                    <Space.Compact key={`h-${index}`} style={{ width: '100%' }}>
                      <Input
                        value={text}
                        maxLength={40}
                        onChange={(event) => {
                          const headlines = [...draft.headlines];
                          headlines[index] = event.target.value;
                          setDraft({ ...draft, headlines });
                        }}
                        addonAfter={charCount(text, 30)}
                      />
                      <Button
                        onClick={() => setDraft({
                          ...draft,
                          headlines: draft.headlines.filter((_, i) => i !== index),
                        })}
                      >
                        删
                      </Button>
                    </Space.Compact>
                  ))}
                  {draft.headlines.length < 15 ? (
                    <Button
                      type="dashed"
                      block
                      onClick={() => setDraft({ ...draft, headlines: [...draft.headlines, ''] })}
                    >
                      添加标题
                    </Button>
                  ) : null}
                </Space>
              </Card>

              <Card title="描述（2–4 条，每条 ≤70）" size="small" style={{ marginTop: 16 }}>
                <Space direction="vertical" style={{ width: '100%' }} size={8}>
                  {draft.descriptions.map((text, index) => (
                    <Space.Compact key={`d-${index}`} style={{ width: '100%' }}>
                      <Input.TextArea
                        value={text}
                        autoSize={{ minRows: 1, maxRows: 3 }}
                        onChange={(event) => {
                          const descriptions = [...draft.descriptions];
                          descriptions[index] = event.target.value;
                          setDraft({ ...draft, descriptions });
                        }}
                      />
                      <div className="ad-review__side">
                        {charCount(text, 70)}
                        <Button
                          size="small"
                          onClick={() => setDraft({
                            ...draft,
                            descriptions: draft.descriptions.filter((_, i) => i !== index),
                          })}
                        >
                          删
                        </Button>
                      </div>
                    </Space.Compact>
                  ))}
                  {draft.descriptions.length < 4 ? (
                    <Button
                      type="dashed"
                      block
                      onClick={() => setDraft({ ...draft, descriptions: [...draft.descriptions, ''] })}
                    >
                      添加描述
                    </Button>
                  ) : null}
                </Space>
              </Card>
            </Col>

            <Col xs={24} lg={10}>
              <Card
                title="关键词"
                size="small"
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
                        onClick={() => setDraft({
                          ...draft,
                          keywords: draft.keywords.filter((_, i) => i !== index),
                        })}
                      >
                        删
                      </Button>
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
                    添加关键词
                  </Button>
                </Space>
                {suggestions.length ? (
                  <Table
                    style={{ marginTop: 12 }}
                    size="small"
                    pagination={false}
                    rowKey={(row) => row.keyword}
                    dataSource={suggestions.slice(0, 12)}
                    columns={[
                      { title: '建议词', dataIndex: 'keyword', ellipsis: true },
                      { title: '量', dataIndex: 'searchVolume', width: 72 },
                      { title: '流量', dataIndex: 'traffic', width: 64 },
                    ]}
                  />
                ) : null}
              </Card>

              <Card title="否定关键词" size="small" style={{ marginTop: 16 }}>
                <Space direction="vertical" style={{ width: '100%' }} size={8}>
                  {draft.negativeKeywords.map((keyword, index) => (
                    <Space.Compact key={`n-${index}`} style={{ width: '100%' }}>
                      <Input
                        value={keyword.text}
                        onChange={(event) => {
                          const negativeKeywords = [...draft.negativeKeywords];
                          negativeKeywords[index] = { ...keyword, text: event.target.value };
                          setDraft({ ...draft, negativeKeywords });
                        }}
                      />
                      <Select
                        style={{ width: 112 }}
                        value={keyword.matchType}
                        options={MATCH_OPTIONS}
                        onChange={(matchType) => {
                          const negativeKeywords = [...draft.negativeKeywords];
                          negativeKeywords[index] = { ...keyword, matchType };
                          setDraft({ ...draft, negativeKeywords });
                        }}
                      />
                      <Button
                        onClick={() => setDraft({
                          ...draft,
                          negativeKeywords: draft.negativeKeywords.filter((_, i) => i !== index),
                        })}
                      >
                        删
                      </Button>
                    </Space.Compact>
                  ))}
                  <Button
                    type="dashed"
                    block
                    onClick={() => setDraft({
                      ...draft,
                      negativeKeywords: [...draft.negativeKeywords, { text: '', matchType: 'PHRASE' }],
                    })}
                  >
                    添加否定词
                  </Button>
                </Space>
              </Card>

              <Card title="预算与落地页" size="small" style={{ marginTop: 16 }}>
                <Form layout="vertical">
                  <Form.Item label="日预算 (USD)">
                    <Input
                      value={draft.dailyBudgetUsd}
                      onChange={(event) => setDraft({ ...draft, dailyBudgetUsd: event.target.value })}
                    />
                  </Form.Item>
                  <Form.Item label="最高 CPC (USD)">
                    <Input
                      value={draft.cpcBidCeilingUsd}
                      onChange={(event) => setDraft({ ...draft, cpcBidCeilingUsd: event.target.value })}
                    />
                  </Form.Item>
                  <Form.Item label="最终到达网址">
                    <Input
                      value={draft.merchantUrl}
                      onChange={(event) => setDraft({ ...draft, merchantUrl: event.target.value })}
                    />
                  </Form.Item>
                  <Form.Item label="URL 后缀">
                    <Input
                      value={draft.finalUrlSuffix}
                      onChange={(event) => setDraft({ ...draft, finalUrlSuffix: event.target.value })}
                    />
                  </Form.Item>
                  <Form.Item label="发布 CID" required>
                    <Select
                      showSearch
                      optionFilterProp="label"
                      value={customerId}
                      placeholder={eligibleCustomers.length ? '选择空闲子账号' : '没有可用 CID，请先同步账户'}
                      options={eligibleCustomers.map((row) => ({
                        value: row.customerId,
                        label: `${formatCustomerId(row.customerId)} · 在投 ${row.activeCampaignCount}`,
                      }))}
                      onChange={setCustomerId}
                    />
                  </Form.Item>
                  {!eligibleCustomers.length ? (
                    <Alert
                      type="warning"
                      showIcon
                      message="当前 MCC 下没有可投放的美元空闲 CID（已排除待验证/禁用）。"
                      action={<Link to="/ads/accounts">去账户状态</Link>}
                    />
                  ) : null}
                </Form>
              </Card>
            </Col>
          </Row>

          <Card title="扩展：宣传信息 / 促销 / 站内链接 / 结构化摘要" size="small" style={{ marginTop: 16 }}>
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form layout="vertical">
                  <Form.Item label="宣传信息（每行一条，≤25）">
                    <Input.TextArea
                      rows={4}
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
                </Form>
              </Col>
              <Col xs={24} md={12}>
                <Typography.Text type="secondary">结构化摘要（最多 2 类，每类至少 4 个值）</Typography.Text>
                <Space direction="vertical" style={{ width: '100%', marginTop: 8 }} size={8}>
                  {(draft.structuredSnippets.length ? draft.structuredSnippets : [{ header: 'BRANDS', values: [] }]).map((snippet, index) => (
                    <Card key={`s-${index}`} size="small" type="inner">
                      <Select
                        style={{ width: '100%', marginBottom: 8 }}
                        value={snippet.header}
                        options={SNIPPET_HEADERS.map((header) => ({ value: header, label: header }))}
                        onChange={(header) => {
                          const structuredSnippets = [...(draft.structuredSnippets.length ? draft.structuredSnippets : [{ header: 'BRANDS', values: [] }])];
                          structuredSnippets[index] = { ...structuredSnippets[index], header };
                          setDraft({ ...draft, structuredSnippets });
                        }}
                      />
                      <Input.TextArea
                        rows={2}
                        placeholder="逗号或换行分隔"
                        value={snippet.values.join(', ')}
                        onChange={(event) => {
                          const values = event.target.value
                            .split(/[,\n]/)
                            .map((item) => item.trim())
                            .filter(Boolean)
                            .slice(0, 10);
                          const structuredSnippets = [...(draft.structuredSnippets.length ? draft.structuredSnippets : [{ header: 'BRANDS', values: [] }])];
                          structuredSnippets[index] = { ...structuredSnippets[index], values };
                          setDraft({ ...draft, structuredSnippets });
                        }}
                      />
                    </Card>
                  ))}
                  {(draft.structuredSnippets.length || 1) < 2 ? (
                    <Button
                      type="dashed"
                      block
                      onClick={() => setDraft({
                        ...draft,
                        structuredSnippets: [
                          ...(draft.structuredSnippets.length ? draft.structuredSnippets : [{ header: 'BRANDS', values: [] }]),
                          { header: 'TYPES', values: [] },
                        ],
                      })}
                    >
                      添加摘要类别
                    </Button>
                  ) : null}
                </Space>
              </Col>
            </Row>

            <Typography.Paragraph style={{ marginTop: 16 }} type="secondary">站内链接</Typography.Paragraph>
            <Space direction="vertical" style={{ width: '100%' }} size={8}>
              {draft.sitelinks.map((link, index) => (
                <Card
                  key={`sl-${index}`}
                  size="small"
                  type="inner"
                  title={`站内链接 ${index + 1}`}
                  extra={(
                    <Space>
                      {link.verified ? <Tag color="success">已校验</Tag> : <Tag>未校验</Tag>}
                      <Button
                        size="small"
                        onClick={() => setDraft({
                          ...draft,
                          sitelinks: draft.sitelinks.filter((_, i) => i !== index),
                        })}
                      >
                        删
                      </Button>
                    </Space>
                  )}
                >
                  <Row gutter={8}>
                    <Col span={8}>
                      <Input
                        placeholder="链接文字 ≤20"
                        value={link.linkText}
                        onChange={(event) => {
                          const sitelinks = [...draft.sitelinks];
                          sitelinks[index] = { ...link, linkText: event.target.value };
                          setDraft({ ...draft, sitelinks });
                        }}
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
                      />
                    </Col>
                    <Col span={24} style={{ marginTop: 8 }}>
                      <Input
                        placeholder="最终网址"
                        value={link.finalUrl}
                        onChange={(event) => {
                          const sitelinks = [...draft.sitelinks];
                          sitelinks[index] = { ...link, finalUrl: event.target.value };
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
            </Space>
          </Card>
        </>
      )}
    </div>
  );
}
