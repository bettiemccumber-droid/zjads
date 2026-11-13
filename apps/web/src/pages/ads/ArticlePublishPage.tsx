import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Divider, Form, Input, Result, Select, Space, Spin, Steps, Tag, Typography, message } from 'antd';
import { FileTextOutlined, LinkOutlined, WarningOutlined } from '@ant-design/icons';
import { api, type ApiResult } from '../../api/client';

interface ChannelAccount {
  id: number;
  displayName: string;
  platformCode: string;
  siteId?: number | null;
  siteName?: string | null;
  siteDomain?: string | null;
}

interface MerchantOption {
  key: string;
  catalogMerchantId: number | null;
  channelAccountId: number;
  name: string;
  mid: string;
  merchantUrl: string;
  countryCode: string;
  platformCode: string;
  siteId: number | null;
  siteName: string | null;
  siteDomain: string | null;
  label: string;
}

interface ArticleSection {
  heading: string;
  text: string;
}

interface ArticlePreview {
  title: string;
  sections: ArticleSection[];
  merchantUrl: string;
  trackUrl: string;
  articleUrl?: string;
  siteName?: string;
  siteDomain?: string;
  accepted?: boolean;
}

interface PublishForm {
  channelAccountId?: number;
  merchantUrl?: string;
  name?: string;
  mid?: string;
  countryCode?: string;
}

const STEPS = ['选择商家', '确认国家', '爬取数据', '确认图片', '预览文章', '发布'];

const COUNTRIES = [
  { value: 'US', label: 'US - 美国' },
  { value: 'GB', label: 'GB - 英国' },
  { value: 'CA', label: 'CA - 加拿大' },
  { value: 'AU', label: 'AU - 澳大利亚' },
  { value: 'DE', label: 'DE - 德国' },
  { value: 'FR', label: 'FR - 法国' },
  { value: 'JP', label: 'JP - 日本' },
  { value: 'HK', label: 'HK - 香港' },
  { value: 'SG', label: 'SG - 新加坡' },
  { value: 'CN', label: 'CN - 中国' },
];

interface CrawledImage {
  url: string;
  alt: string;
}

/**
 * 把本地图片压成 jpeg，方便放进文章正文。
 */
function readUploadedImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      const longest = Math.max(image.width, image.height);
      const scale = longest > 1280 ? 1280 / longest : 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d');
      if (!context) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('无法读取图片'));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('无法读取图片'));
    };
    image.src = objectUrl;
  });
}

/**
 * 国家代码对应的文章语言。未列出的国家先按英文处理。
 */
function languageOf(countryCode: string): { code: string; label: string } {
  const country = countryCode.toUpperCase();
  if (country === 'HK' || country === 'CN' || country === 'TW') return { code: 'zh', label: '中文' };
  if (country === 'JP') return { code: 'ja', label: '日本語' };
  if (country === 'DE') return { code: 'de', label: 'Deutsch' };
  if (country === 'FR') return { code: 'fr', label: 'Français' };
  if (country === 'VN') return { code: 'vi', label: 'Tiếng Việt' };
  if (country === 'MX') return { code: 'es', label: 'Español (México)' };
  if (country === 'ES') return { code: 'es', label: 'Español (España)' };
  return { code: 'en', label: 'English' };
}

/**
 * 取出接口错误里的提示。
 */
function errorText(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error && 'response' in error) {
    const messageText = (error as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
    if (Array.isArray(messageText)) return messageText.join('；');
    if (messageText) return messageText;
  }
  return fallback;
}

/**
 * 快速发布文章。配图从商家页面抓取，正文仍是示例，三个网址分开保存。
 */
export default function ArticlePublishPage() {
  const navigate = useNavigate();
  const [form] = Form.useForm<PublishForm>();
  const [step, setStep] = useState(0);
  const [accounts, setAccounts] = useState<ChannelAccount[]>([]);
  const [merchants, setMerchants] = useState<MerchantOption[]>([]);
  const [picked, setPicked] = useState<MerchantOption | null>(null);
  const [draft, setDraft] = useState<PublishForm>({ countryCode: 'US' });
  const [query, setQuery] = useState('');
  const [images, setImages] = useState<CrawledImage[]>([]);
  const [selectedImageUrls, setSelectedImageUrls] = useState<string[]>([]);
  const [imageError, setImageError] = useState('');
  const [crawling, setCrawling] = useState(false);
  const [imageAttempt, setImageAttempt] = useState(0);
  const [retryUrl, setRetryUrl] = useState('');
  const uploadRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ArticlePreview | null>(null);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileNote, setProfileNote] = useState('');
  const countryCode = Form.useWatch('countryCode', form) || 'US';
  const channelAccountId = Form.useWatch('channelAccountId', form);
  const language = languageOf(countryCode);
  const account = accounts.find((item) => item.id === (draft.channelAccountId ?? channelAccountId)) ?? null;

  /**
   * 表单卸掉后字段会被清掉，所以离开每一步时把值记在 draft 里。
   */
  /**
   * 用员工填的产品页重新抓一次。
   */
  const retryWithUrl = () => {
    const next = retryUrl.trim();
    if (!/^https?:\/\//i.test(next)) {
      message.warning('请填写以 http 或 https 开头的产品页网址');
      return;
    }
    setDraft((current) => ({ ...current, merchantUrl: next }));
    setImageAttempt((current) => current + 1);
  };

  /**
   * 读取电脑上的图片，放进配图列表。
   */
  const addUploadedImages = async (list: FileList | null) => {
    const files = [...(list ?? [])].filter((file) => /^image\/(jpeg|png|webp)$/.test(file.type));
    if (!files.length) {
      message.warning('请选择 jpg、png 或 webp 图片');
      return;
    }
    try {
      const urls = (await Promise.all(files.map(readUploadedImage))).filter((url) => url.length <= 1_500_000);
      if (!urls.length) {
        message.warning('图片太大，请换一张小一些的');
        return;
      }
      setImages((current) => [...current, ...urls.map((url) => ({ url, alt: '上传的图片' }))].slice(0, 8));
      setSelectedImageUrls((current) => [...current, ...urls].filter((url, index, all) => all.indexOf(url) === index).slice(0, 8));
    } catch {
      message.error('这张图片读不出来');
    }
  };

  const currentPayload = () => ({
    channelAccountId: draft.channelAccountId,
    siteId: account?.siteId ?? undefined,
    catalogMerchantId: picked?.catalogMerchantId ?? undefined,
    name: draft.name?.trim(),
    mid: draft.mid?.trim(),
    merchantUrl: draft.merchantUrl?.trim(),
    countryCode: draft.countryCode,
    languageCode: languageOf(draft.countryCode || 'US').code,
    imageUrls: selectedImageUrls,
  });

  useEffect(() => {
    if (step === 0 || step === 1) form.setFieldsValue(draft);
  }, [step, draft, form]);

  useEffect(() => {
    void api.get<ApiResult<Array<{ platformCode: string; accounts: ChannelAccount[] }>>>('/channel-accounts/by-platform')
      .then((res) => {
        if (!res.data.success) return;
        setAccounts(res.data.data.flatMap((group) => group.accounts.map((item) => ({ ...item, platformCode: group.platformCode }))));
      })
      .catch(() => message.error('加载联盟账号失败'));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void api.get<ApiResult<MerchantOption[]>>('/article-publish/merchants', { params: { q: query } })
        .then((res) => {
          if (res.data.success) setMerchants(res.data.data);
        })
        .catch(() => message.error('加载商家失败'));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (step !== 2) return;
    const merchantUrl = draft.merchantUrl?.trim();
    if (!merchantUrl) {
      setImageError('没有商家网址，无法抓取图片');
      setCrawling(false);
      return;
    }
    let cancelled = false;
    setCrawling(true);
    setImageError('');
    setImages([]);
    void api.get<ApiResult<{ pageUrl: string; images: CrawledImage[] }>>('/article-publish/images', { params: { merchantUrl } })
      .then((res) => {
        if (cancelled) return;
        if (!res.data.success) {
          setImageError(res.data.message || '抓取商家图片失败');
          return;
        }
        const found = res.data.data.images ?? [];
        setImages(found);
        setSelectedImageUrls(found.map((item) => item.url));
        if (!found.length) {
          setImageError('这个商家页面上没有找到可用图片');
          return;
        }
        setStep(3);
      })
      .catch((error: unknown) => {
        if (!cancelled) setImageError(errorText(error, '抓取商家图片失败'));
      })
      .finally(() => {
        if (!cancelled) setCrawling(false);
      });
    return () => {
      cancelled = true;
    };
  }, [step, draft.merchantUrl, imageAttempt]);

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      <Space style={{ marginBottom: 8 }}>
        <FileTextOutlined />
        <Typography.Title level={4} style={{ margin: 0 }}>快速发布文章</Typography.Title>
      </Space>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        配图从商家页面抓取。正文仍是示例。文章地址、商家网址、跟踪链接分开保存。
      </Typography.Paragraph>
      <Steps current={step} size="small" items={STEPS.map((title) => ({ title }))} style={{ marginBottom: 20 }} />
      <Card>
        {step === 0 && (
          <Form
            form={form}
            layout="vertical"
            initialValues={{ countryCode: 'US' }}
            onFinish={(values) => {
              const next = {
                channelAccountId: picked?.channelAccountId || values.channelAccountId,
                merchantUrl: picked?.merchantUrl || values.merchantUrl,
                name: picked?.name || values.name,
                mid: picked?.mid || values.mid,
                countryCode: values.countryCode || picked?.countryCode || 'US',
              };
              if (profileLoading) {
                message.info('正在从联盟平台获取商家网址');
                return;
              }
              if (!next.channelAccountId) {
                message.warning('请选择联盟账号');
                return;
              }
              if (!next.name?.trim() && next.merchantUrl) {
                try {
                  next.name = new URL(next.merchantUrl).hostname.replace(/^www\./, '');
                } catch {
                  next.name = '';
                }
              }
              if (!next.name?.trim()) {
                message.warning('请填写商家名称');
                return;
              }
              if (!next.merchantUrl || !/^https?:\/\//i.test(next.merchantUrl)) {
                message.warning(picked ? '平台没有返回商家网址，请清空商家后按 URL 创建' : '请填写商家网址');
                return;
              }
              setDraft(next);
              setStep(1);
            }}
          >
            <Form.Item label="选择推广商家" required>
              <Select
                showSearch
                allowClear
                filterOption={false}
                value={picked?.key}
                placeholder="从在投广告里选，输入名称或 MID"
                options={merchants.map((item) => ({ value: item.key, label: item.label }))}
                onSearch={setQuery}
                onChange={(key) => {
                  const row = merchants.find((item) => item.key === key) ?? null;
                  setPicked(row);
                  setProfileNote('');
                  if (!row) {
                    form.setFieldsValue({ merchantUrl: undefined, name: undefined, mid: undefined });
                    return;
                  }
                  form.setFieldsValue({
                    ...(row.channelAccountId ? { channelAccountId: row.channelAccountId } : {}),
                    name: row.name,
                    mid: row.mid,
                    countryCode: row.countryCode || 'US',
                    merchantUrl: undefined,
                  });
                  if (!row.channelAccountId || !row.mid) return;
                  setProfileLoading(true);
                  setProfileNote('');
                  void api.get<ApiResult<{ siteUrl: string; merchantName: string | null; error: string | null }>>('/article-publish/merchant-profile', {
                    params: { channelAccountId: row.channelAccountId, mid: row.mid },
                  })
                    .then((res) => {
                      if (!res.data.success) return;
                      const siteUrl = res.data.data.siteUrl;
                      const name = res.data.data.merchantName || row.name;
                      setPicked((current) => current?.key === row.key ? { ...current, merchantUrl: siteUrl, name } : current);
                      form.setFieldsValue({ merchantUrl: siteUrl || undefined, name });
                      setProfileNote(siteUrl ? '' : '联盟平台没有返回这个商家的网址');
                    })
                    .catch(() => {
                      setProfileNote('联盟平台没有返回这个商家的网址');
                      message.error('获取商家网址失败');
                    })
                    .finally(() => setProfileLoading(false));
                }}
              />
            </Form.Item>
            {picked && (
              <Card size="small" style={{ marginBottom: 16, background: '#fafafa' }}>
                <Typography.Text strong>{picked.name}</Typography.Text>
                <div style={{ marginTop: 6 }}>
                  <Tag>{picked.platformCode}</Tag>
                  <Typography.Text type="secondary">MID: {picked.mid || '未填写'}</Typography.Text>
                </div>
                <div style={{ marginTop: 6 }}>
                  {profileLoading ? '正在从联盟平台获取网址...' : (picked.merchantUrl || profileNote || '联盟平台没有返回这个商家的网址')}
                </div>
              </Card>
            )}
            <Divider plain>或</Divider>
            <Typography.Text strong>按 URL 创建</Typography.Text>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
              平台查不到这个商家时，再在这里手填。已经选了上面的商家，这一块就不能改。
            </Typography.Paragraph>
            <div style={picked ? { opacity: 0.55, pointerEvents: 'none' } : undefined}>
            <Form.Item
              name="merchantUrl"
              label="商家 URL"
              rules={picked ? [] : [{ required: true, message: '请填写商家网址' }, { pattern: /^https?:\/\//i, message: '需要以 http 或 https 开头' }]}
            >
              <Input placeholder="https://shop.example.com/" disabled={Boolean(picked)} />
            </Form.Item>
            <Form.Item name="channelAccountId" label="平台账号" rules={picked ? [] : [{ required: true, message: '请选择联盟账号' }]}>
              <Select
                disabled={Boolean(picked)}
                placeholder="选择用于跟踪链接的联盟账号"
                options={accounts.map((item) => ({ value: item.id, label: `${item.displayName} / ${item.platformCode}` }))}
              />
            </Form.Item>
            <Form.Item name="countryCode" label="目标国家" rules={[{ required: true, message: '请选择国家' }]}>
              <Select showSearch optionFilterProp="label" options={COUNTRIES} disabled={Boolean(picked)} />
            </Form.Item>
            <Form.Item label="发布站点">
              <Select
                disabled
                value={account?.siteId ?? undefined}
                placeholder={account ? '这个账号还没有绑定内容站' : '先选择平台账号'}
                options={account?.siteId ? [{ value: account.siteId, label: `${account.siteName} (${account.siteDomain})` }] : []}
              />
            </Form.Item>
            <Form.Item name="name" label="商家名称（选填）">
              <Input placeholder="留空则用网址域名" disabled={Boolean(picked)} />
            </Form.Item>
            <Form.Item name="mid" label="商家 MID（选填）">
              <Input placeholder="平台有就填，没有留空" disabled={Boolean(picked)} />
            </Form.Item>
            </div>
            <Button type="primary" htmlType="submit" loading={profileLoading}>下一步</Button>
          </Form>
        )}

        {step === 1 && (
          <Form
            form={form}
            layout="vertical"
            onFinish={(values) => {
              setDraft((current) => ({ ...current, countryCode: values.countryCode }));
              setRetryUrl(draft.merchantUrl || '');
              setStep(2);
            }}
          >
            <Form.Item name="countryCode" label="目标国家" rules={[{ required: true, message: '请选择国家' }]}>
              <Select showSearch optionFilterProp="label" options={COUNTRIES} />
            </Form.Item>
            <Form.Item label="文章语言">
              <Input value={language.label} disabled />
            </Form.Item>
            <Space>
              <Button onClick={() => setStep(0)}>上一步</Button>
              <Button type="primary" htmlType="submit">开始爬取</Button>
            </Space>
          </Form>
        )}

        {step === 2 && (
          <div style={{ textAlign: 'center', padding: 48 }}>
            {crawling ? (
              <>
                <Spin />
                <div style={{ marginTop: 12 }}>正在打开商家页面并抓取图片...</div>
              </>
            ) : (
              <>
                <WarningOutlined style={{ fontSize: 48, color: '#faad14' }} />
                <Typography.Title level={4} style={{ marginTop: 16, marginBottom: 8 }}>爬取未获取到图片</Typography.Title>
                <Typography.Paragraph type="secondary" style={{ marginBottom: imageError ? 8 : 24 }}>
                  商家站可能有企业级反爬保护，您可以手动输入产品页 URL 重试，或跳过爬取直接上传图片
                </Typography.Paragraph>
                {imageError ? (
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 24 }}>{imageError}</Typography.Paragraph>
                ) : null}
                <Space.Compact style={{ width: '100%', maxWidth: 640 }}>
                  <Input
                    prefix={<LinkOutlined />}
                    placeholder="输入商家产品页 URL，如 https://www..."
                    value={retryUrl}
                    onChange={(event) => setRetryUrl(event.target.value)}
                    onPressEnter={retryWithUrl}
                  />
                  <Button type="primary" onClick={retryWithUrl}>用此 URL 重试爬取</Button>
                </Space.Compact>
                <div style={{ marginTop: 20 }}>
                  <Space>
                    <Button onClick={() => setStep(1)}>上一步</Button>
                    <Button type="primary" onClick={() => setStep(3)}>跳过爬取，直接上传图片</Button>
                  </Space>
                </div>
              </>
            )}
          </div>
        )}

        {step === 3 && (
          <Spin spinning={generating} tip="正在按投放国家生成文章，请稍候...">
            <Typography.Text strong>选择文章配图（已选 {selectedImageUrls.length} 条）</Typography.Text>
            <Typography.Paragraph type="secondary">勾选要留在文章里的图片。没有抓到的话，可以从电脑上传。</Typography.Paragraph>
            <input
              ref={uploadRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              hidden
              onChange={(event) => {
                void addUploadedImages(event.target.files);
                event.target.value = '';
              }}
            />
            <Button style={{ marginBottom: 12 }} onClick={() => uploadRef.current?.click()}>上传图片</Button>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              {images.map((image) => {
                const selected = selectedImageUrls.includes(image.url);
                return (
                  <button
                    key={image.url}
                    type="button"
                    title={image.alt || image.url}
                    onClick={() => setSelectedImageUrls((current) => (
                      current.includes(image.url) ? current.filter((item) => item !== image.url) : [...current, image.url]
                    ))}
                    style={{
                      height: 110,
                      padding: 0,
                      borderRadius: 8,
                      overflow: 'hidden',
                      border: selected ? '2px solid #1677ff' : '1px solid #f0f0f0',
                      background: '#f5f5f5',
                      cursor: 'pointer',
                    }}
                  >
                    <img
                      src={image.url}
                      alt={image.alt || '商家配图'}
                      referrerPolicy="no-referrer"
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  </button>
                );
              })}
            </div>
            <Space style={{ marginTop: 16 }}>
              <Button onClick={() => setStep(1)}>上一步</Button>
              <Button
                type="primary"
                disabled={selectedImageUrls.length === 0}
                onClick={() => {
                  setGenerating(true);
                  void api.post<ApiResult<ArticlePreview>>('/article-publish/preview', currentPayload())
                    .then((res) => {
                      if (!res.data.success) {
                        message.error(res.data.message || '生成失败');
                        return;
                      }
                      setPreview(res.data.data);
                      setStep(4);
                    })
                    .catch((error: unknown) => message.error(errorText(error, '生成失败')))
                    .finally(() => setGenerating(false));
                }}
              >
                生成文章
              </Button>
            </Space>
          </Spin>
        )}

        {step === 4 && preview && (
          <div>
            <Typography.Title level={3}>{preview.title}</Typography.Title>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 16 }}>
              {selectedImageUrls.map((url) => (
                <img
                  key={url}
                  src={url}
                  alt=""
                  referrerPolicy="no-referrer"
                  style={{ width: '100%', height: 180, objectFit: 'cover', borderRadius: 8, background: '#f5f5f5' }}
                />
              ))}
            </div>
            {preview.sections.map((section) => (
              <div key={section.heading} style={{ marginBottom: 16 }}>
                <Typography.Title level={5}>{section.heading}</Typography.Title>
                <Typography.Paragraph>{section.text}</Typography.Paragraph>
              </div>
            ))}
            <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8, padding: 12, marginBottom: 8 }}>
              <div>跟踪链接</div>
              <a href={preview.trackUrl} target="_blank" rel="noreferrer">{preview.trackUrl}</a>
              {preview.trackUrl === preview.merchantUrl && (
                <div style={{ marginTop: 4 }}>这个联盟账号还没有跟踪链接前缀，正文链接暂时和商家网址相同。</div>
              )}
            </div>
            <Typography.Text type="secondary">商家网址 {preview.merchantUrl}</Typography.Text>
            <div style={{ marginTop: 16 }}>
              <Space>
                <Button onClick={() => setStep(3)}>上一步</Button>
                <Button
                  type="primary"
                  loading={publishing}
                  onClick={() => {
                    if (!account?.siteId) {
                      message.warning('请先在我的平台账号里绑定内容站');
                      return;
                    }
                    setPublishing(true);
                    void api.post<ApiResult<ArticlePreview>>('/article-publish/publish', currentPayload())
                      .then((res) => {
                        if (!res.data.success) {
                          message.error(res.data.message || '保存失败');
                          return;
                        }
                        setPreview(res.data.data);
                        message.success(res.data.data.accepted ? '内容站已回写文章地址' : '文章已保存，等待内容站回写');
                        setStep(5);
                      })
                      .catch((error: unknown) => message.error(errorText(error, '保存失败')))
                      .finally(() => setPublishing(false));
                  }}
                >
                  发布文章
                </Button>
              </Space>
            </div>
          </div>
        )}

        {step === 5 && preview && (
          <Result
            status="success"
            title="文章已保存"
            subTitle={preview.articleUrl ? `文章地址：${preview.articleUrl}` : `内容站还没有回写文章地址。${preview.siteDomain ? `绑定站点 ${preview.siteDomain}。` : ''}`}
            extra={[
              <Button key="view" type="primary" onClick={() => setStep(4)}>查看文章</Button>,
              <Button key="list" onClick={() => navigate('/ads/articles')}>文章列表</Button>,
              <Button
                key="again"
                onClick={() => {
                  setStep(0);
                  setPicked(null);
                  setPreview(null);
                  setImages([]);
                  setSelectedImageUrls([]);
                  setImageError('');
                  setRetryUrl('');
                  setDraft({ countryCode: 'US' });
                  form.resetFields();
                  form.setFieldsValue({ countryCode: 'US' });
                }}
              >
                继续发布
              </Button>,
            ]}
          />
        )}
      </Card>
    </div>
  );
}
