import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Progress,
  Steps,
  Switch,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  CloudDownloadOutlined,
  CopyOutlined,
  DeleteOutlined,
  InboxOutlined,
  PictureOutlined,
  ReloadOutlined,
  RocketOutlined,
  SaveOutlined,
  SendOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { api, type ApiResult } from '../../api/client';
import { AD_LANGUAGE_OPTIONS, formatCustomerId, isGoogleMccId } from './ad-launch-settings';
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

interface AdCopyTranslations {
  headlines?: string[];
  descriptions?: string[];
  callouts?: string[];
  sitelinks?: string[];
  keywords?: string[];
  structuredSnippets?: string[];
  promotion?: string;
}

interface AdPromotionAsset {
  enabled: boolean;
  promotionTarget: string;
  discountType: 'PERCENT' | 'MONETARY';
  percentOff?: number;
  moneyAmountOff?: string;
  currencyCode?: string;
  languageCode?: string;
  occasion?: string;
  finalUrl?: string;
  promotionCode?: string;
  ordersOverAmount?: string;
  startDate?: string;
  endDate?: string;
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
  promotionAsset?: AdPromotionAsset | null;
  translations?: AdCopyTranslations;
  merchantUrl: string;
  finalUrlSuffix: string;
  bidding: 'MAXIMIZE_CLICKS' | 'MANUAL_CPC';
  dailyBudgetUsd: string;
  cpcBidCeilingUsd: string;
  languageCode: string;
  geoTargetId: string;
  /** Google Ads 商家名称；可空，最长 25 */
  businessName?: string;
  imageUrls?: string[];
  logoUrls?: string[];
}

interface AdImageCandidate {
  url: string;
  alt: string;
  width: number;
  height: number;
  square: boolean;
}

function isNearSquare(width: number, height: number): boolean {
  if (width < 300 || height < 300) return false;
  const ratio = width / height;
  return ratio >= 0.9 && ratio <= 1.11;
}

function measureImage(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('load failed'));
    image.referrerPolicy = 'no-referrer';
    image.src = url;
  });
}

function cropFromImageSrc(src: string, target = 1200): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      if (side < 300) {
        reject(new Error('too small'));
        return;
      }
      const sx = Math.floor((image.naturalWidth - side) / 2);
      const sy = Math.floor((image.naturalHeight - side) / 2);
      const canvas = document.createElement('canvas');
      const out = Math.min(target, side);
      canvas.width = out;
      canvas.height = out;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('no canvas'));
        return;
      }
      ctx.drawImage(image, sx, sy, side, side, 0, 0, out, out);
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    image.onerror = () => reject(new Error('load failed'));
    image.referrerPolicy = 'no-referrer';
    image.src = src;
  });
}

/**
 * 从横/竖图中心裁成正方形 JPEG。跨域失败时走后端代理再裁。
 */
async function cropSquareDataUrl(url: string, target = 1200): Promise<string> {
  try {
    return await cropFromImageSrc(url, target);
  } catch {
    const res = await api.get(`/article-publish/image-proxy`, {
      params: { url },
      responseType: 'blob',
    });
    const objectUrl = URL.createObjectURL(res.data as Blob);
    try {
      return await cropFromImageSrc(objectUrl, target);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png)$/i.test(file.type)) {
      reject(new Error('仅支持 JPG、PNG'));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      reject(new Error('单张最大 5MB'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取失败'));
    reader.readAsDataURL(file);
  });
}

interface AdJob {
  id: string;
  status: string;
  step: string;
  progress: number;
  progressMessage: string;
  errorMessage: string | null;
  mccCustomerId: string;
  channelAccountId?: number;
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

function buildArticlePublishPath(job: AdJob, draft: AdDraft): string {
  const params = new URLSearchParams();
  params.set('fromAd', '1');
  if (job.id) params.set('jobId', job.id);
  if (job.channelAccountId) params.set('channelAccountId', String(job.channelAccountId));
  const merchantUrl = (draft.merchantUrl || job.input?.merchantUrl || '').trim();
  if (merchantUrl) params.set('merchantUrl', merchantUrl);
  const name = (job.input?.merchantName || '').trim();
  if (name) params.set('name', name);
  const mid = (job.input?.mid || '').trim();
  if (mid) params.set('mid', mid);
  const country = (job.targetCountry || 'US').trim();
  if (country) params.set('countryCode', country);
  return `/ads/articles/publish?${params.toString()}`;
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

interface AdsConnection {
  id: number;
  mccCustomerId: string;
  loginCustomerId: string;
  hasRefreshToken: boolean;
  customerCount: number;
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
  'Amenities', 'Brands', 'Courses', 'Degree programs', 'Destinations',
  'Featured hotels', 'Insurance coverage', 'Models', 'Neighborhoods',
  'Service catalog', 'Shows', 'Styles', 'Types',
];

const HEADLINE_MAX = 30;
const DESC_MAX = 90;
const CALLOUT_MAX = 25;
const SITELINK_TEXT_MAX = 20;
const SITELINK_DESC_MAX = 25;
const SNIPPET_VALUE_MAX = 20;
const BUSINESS_NAME_MAX = 25;

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
    promotionAsset: null,
    translations: {},
    merchantUrl: '',
    businessName: '',
    finalUrlSuffix: '',
    bidding: 'MAXIMIZE_CLICKS',
    dailyBudgetUsd: '3.00',
    cpcBidCeilingUsd: '',
    languageCode: 'en',
    geoTargetId: '',
    imageUrls: [],
    logoUrls: [],
  };
}

function acceptedMediaUrl(url: string) {
  return /^https?:\/\//i.test(url) || /^data:image\/(?:jpeg|png);base64,/i.test(url);
}

/** 尽可能多点击时清掉最高 CPC，避免旧草稿残留 0.50。 */
function hydrateDraft(raw?: Partial<AdDraft> | null): AdDraft {
  const draft = { ...emptyDraft(), ...(raw || {}) };
  if (draft.bidding !== 'MANUAL_CPC') draft.cpcBidCeilingUsd = '';
  draft.imageUrls = Array.isArray(draft.imageUrls) ? draft.imageUrls.filter(acceptedMediaUrl) : [];
  draft.logoUrls = Array.isArray(draft.logoUrls) ? draft.logoUrls.filter(acceptedMediaUrl) : [];
  return draft;
}

function emptyPromotion(): AdPromotionAsset {
  return {
    enabled: false,
    promotionTarget: '',
    discountType: 'PERCENT',
    percentOff: 10,
    moneyAmountOff: '',
    currencyCode: 'USD',
    languageCode: 'en',
    occasion: '',
    finalUrl: '',
    promotionCode: '',
    ordersOverAmount: '',
    startDate: '',
    endDate: '',
  };
}

function zhHint(translations: AdCopyTranslations | undefined, key: keyof AdCopyTranslations, index: number) {
  const list = translations?.[key];
  if (!Array.isArray(list)) return '';
  return list[index]?.trim() || '';
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

function textLen(text: string) {
  return [...text].length;
}

function isOverLimit(text: string, max: number) {
  return textLen(text) > max;
}

function charCount(text: string, max: number) {
  const len = textLen(text);
  const over = len > max;
  return (
    <span className={over ? 'ad-review__count ad-review__count--over' : 'ad-review__count'}>
      {over ? (
        <>
          <span className="ad-review__count-badge">超限 +{len - max}</span>
          {len}/{max}
        </>
      ) : (
        <>{len}/{max}</>
      )}
    </span>
  );
}

/** 通篇扫描超字数，供顶部醒目提示。 */
function collectLengthIssues(draft: AdDraft): string[] {
  const issues: string[] = [];
  draft.headlines.forEach((text, index) => {
    if (isOverLimit(text, HEADLINE_MAX)) {
      issues.push(`标题 ${index + 1}（${textLen(text)}/${HEADLINE_MAX}）`);
    }
  });
  draft.descriptions.forEach((text, index) => {
    if (isOverLimit(text, DESC_MAX)) {
      issues.push(`描述 ${index + 1}（${textLen(text)}/${DESC_MAX}）`);
    }
  });
  draft.callouts.forEach((text, index) => {
    if (isOverLimit(text, CALLOUT_MAX)) {
      issues.push(`宣传信息 ${index + 1}（${textLen(text)}/${CALLOUT_MAX}）`);
    }
  });
  draft.sitelinks.forEach((link, index) => {
    const n = index + 1;
    if (isOverLimit(link.linkText, SITELINK_TEXT_MAX)) {
      issues.push(`站内链接 ${n} 文案（${textLen(link.linkText)}/${SITELINK_TEXT_MAX}）`);
    }
    if (isOverLimit(link.description1, SITELINK_DESC_MAX)) {
      issues.push(`站内链接 ${n} 描述1（${textLen(link.description1)}/${SITELINK_DESC_MAX}）`);
    }
    if (isOverLimit(link.description2, SITELINK_DESC_MAX)) {
      issues.push(`站内链接 ${n} 描述2（${textLen(link.description2)}/${SITELINK_DESC_MAX}）`);
    }
  });
  draft.structuredSnippets.forEach((snippet, index) => {
    snippet.values.forEach((value, valueIndex) => {
      if (isOverLimit(value, SNIPPET_VALUE_MAX)) {
        issues.push(`结构化摘要 ${index + 1} 第 ${valueIndex + 1} 值（${textLen(value)}/${SNIPPET_VALUE_MAX}）`);
      }
    });
  });
  if (isOverLimit(draft.businessName ?? '', BUSINESS_NAME_MAX)) {
    issues.push(`商家名称（${textLen(draft.businessName ?? '')}/${BUSINESS_NAME_MAX}）`);
  }
  return issues;
}

function sitelinkOver(link: AdSitelink) {
  return (
    isOverLimit(link.linkText, SITELINK_TEXT_MAX)
    || isOverLimit(link.description1, SITELINK_DESC_MAX)
    || isOverLimit(link.description2, SITELINK_DESC_MAX)
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
  const [mccConnections, setMccConnections] = useState<AdsConnection[]>([]);
  const [selectedMcc, setSelectedMcc] = useState<string>();
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
  const [campaignNameDirty, setCampaignNameDirty] = useState(false);
  const [adImages, setAdImages] = useState<AdImageCandidate[]>([]);
  const [logoImages, setLogoImages] = useState<AdImageCandidate[]>([]);
  const [loadingAdImages, setLoadingAdImages] = useState(false);
  const [pasteImageUrl, setPasteImageUrl] = useState('');
  const [pasteLogoUrl, setPasteLogoUrl] = useState('');
  const [verifyingSitelinkIndex, setVerifyingSitelinkIndex] = useState<number | null>(null);
  const [verifyingAllSitelinks, setVerifyingAllSitelinks] = useState(false);
  const [regeneratingKey, setRegeneratingKey] = useState<string | null>(null);
  // 用 ref 读脏标记，避免改系列名时重建 loadJob → 重新拉任务盖掉未保存的广告草稿
  const campaignNameDirtyRef = useRef(false);
  campaignNameDirtyRef.current = campaignNameDirty;
  const imagesAutoFetchedRef = useRef(false);

  const selectedImageUrls = draft.imageUrls ?? [];
  const selectedLogoUrls = draft.logoUrls ?? [];
  const selectedSquareCount = adImages.filter((item) => selectedImageUrls.includes(item.url) && item.square).length;

  useEffect(() => {
    const urls = [...selectedImageUrls];
    if (!urls.length) return;
    let cancelled = false;
    void (async () => {
      const measured: AdImageCandidate[] = [];
      for (const url of urls) {
        try {
          const size = await measureImage(url);
          measured.push({
            url,
            alt: '',
            width: size.width,
            height: size.height,
            square: isNearSquare(size.width, size.height),
          });
        } catch {
          // ignore
        }
      }
      if (cancelled || !measured.length) return;
      setAdImages((current) => {
        const map = new Map(current.map((item) => [item.url, item]));
        measured.forEach((item) => map.set(item.url, item));
        return [...map.values()];
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedImageUrls.join('|')]);

  const loadAdImages = async (options: { silent?: boolean } = {}) => {
    const merchantUrl = (draft.merchantUrl || job?.input?.merchantUrl || '').trim();
    if (!/^https?:\/\//i.test(merchantUrl || '')) {
      if (!options.silent) message.warning('请先填写商家网址再拉图');
      return;
    }
    setLoadingAdImages(true);
    try {
      const res = await api.get<ApiResult<{
        pageUrl: string;
        images: Array<{ url: string; alt: string }>;
        sources?: Array<{ kind: string; url: string; imageCount: number }>;
      }>>('/article-publish/images', { params: { merchantUrl } });
      if (!res.data.success) {
        if (!options.silent) message.error(res.data.message || '抓取图片失败');
        return;
      }
      const rows = res.data.data.images ?? [];
      const measured: AdImageCandidate[] = [];
      for (const row of rows) {
        try {
          const size = await measureImage(row.url);
          if (size.width < 300 || size.height < 300) continue;
          measured.push({
            url: row.url,
            alt: row.alt || '',
            width: size.width,
            height: size.height,
            square: isNearSquare(size.width, size.height),
          });
        } catch {
          // 浏览器打不开的图丢掉
        }
      }
      if (measured.length && !measured.some((item) => item.square)) {
        const source = [...measured].sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
        try {
          const squareUrl = await cropSquareDataUrl(source.url);
          measured.unshift({
            url: squareUrl,
            alt: '裁成正方形',
            width: 1200,
            height: 1200,
            square: true,
          });
        } catch {
          // 代理裁切也失败时仍展示原图
        }
      }
      setAdImages(measured);
      const logoPool = measured
        .filter((item) => item.square || Math.abs(item.width / item.height - 1) < 0.35)
        .slice(0, 15);
      setLogoImages(logoPool.length ? logoPool : measured.filter((item) => item.square).slice(0, 15));
      const sources = res.data.data.sources ?? [];
      const site = sources.filter((item) => item.kind === 'site').reduce((sum, item) => sum + item.imageCount, 0);
      const social = sources.filter((item) => item.kind === 'social').reduce((sum, item) => sum + item.imageCount, 0);
      const search = sources.filter((item) => item.kind === 'search').reduce((sum, item) => sum + item.imageCount, 0);
      const squareCount = measured.filter((item) => item.square).length;
      if (!options.silent) {
        if (!measured.length) message.warning('没有抓到可用图片，可拖入本地图或粘贴 URL');
        else {
          const parts = [`官网 ${site || measured.length}`];
          if (social) parts.push(`社媒 ${social}`);
          if (search) parts.push(`搜索 ${search}`);
          message.success(`已加载 ${measured.length} 张可选（${parts.join(' / ')}，正方形 ${squareCount}）`);
        }
      }
    } catch (err) {
      if (!options.silent) {
        const apiMessage = (err as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
        message.error(Array.isArray(apiMessage) ? apiMessage.join('；') : apiMessage || '抓取图片失败');
      }
    } finally {
      setLoadingAdImages(false);
    }
  };

  useEffect(() => {
    if (!job) return;
    const url = (draft.merchantUrl || job.input?.merchantUrl || '').trim();
    if (!/^https?:\/\//i.test(url)) return;
    if (imagesAutoFetchedRef.current || adImages.length) return;
    imagesAutoFetchedRef.current = true;
    void loadAdImages({ silent: true });
    // 仅在任务/网址就绪时自动拉一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, draft.merchantUrl, job?.input?.merchantUrl]);

  const addMediaUrl = async (kind: 'image' | 'logo', raw: string) => {
    const url = raw.trim();
    if (!acceptedMediaUrl(url)) {
      message.warning('请粘贴 http(s) 或已上传的图片地址');
      return;
    }
    try {
      const size = await measureImage(url);
      if (size.width < 300 || size.height < 300) {
        message.warning('图片至少 300×300');
        return;
      }
      const candidate: AdImageCandidate = {
        url,
        alt: '',
        width: size.width,
        height: size.height,
        square: isNearSquare(size.width, size.height),
      };
      if (kind === 'image') {
        setAdImages((prev) => (prev.some((item) => item.url === url) ? prev : [candidate, ...prev]));
        setDraft((current) => ({
          ...current,
          imageUrls: [...new Set([...(current.imageUrls ?? []), url])].slice(0, 20),
        }));
        setPasteImageUrl('');
      } else {
        setLogoImages((prev) => (prev.some((item) => item.url === url) ? prev : [candidate, ...prev]));
        setDraft((current) => ({
          ...current,
          logoUrls: [...new Set([...(current.logoUrls ?? []), url])].slice(0, 5),
        }));
        setPasteLogoUrl('');
      }
      message.success('已添加');
    } catch {
      message.error('无法打开该图片地址');
    }
  };

  const addLocalFiles = async (kind: 'image' | 'logo', files: File[]) => {
    for (const file of files) {
      try {
        const dataUrl = await readFileAsDataUrl(file);
        await addMediaUrl(kind, dataUrl);
      } catch (err) {
        message.error(err instanceof Error ? err.message : '上传失败');
      }
    }
  };

  const loadJob = useCallback(async () => {
    if (!id) return;
    const res = await api.get<ApiResult<AdJob>>(`/ad-jobs/${id}`);
    if (!res.data.success) {
      message.error(res.data.message || '加载任务失败');
      return;
    }
    const next = res.data.data;
    setJob(next);
    if (next.draft) {
      setDraft(hydrateDraft(next.draft));
    } else if (next.input?.merchantUrl) {
      // 生成中尚无完整草稿时，先带上商家网址，方便预览骨架与拉图
      setDraft((prev) => ({
        ...prev,
        merchantUrl: prev.merchantUrl || next.input?.merchantUrl || '',
        languageCode: prev.languageCode || next.languageCode || 'en',
      }));
    }
    if (next.suggestedCampaignName && !campaignNameDirtyRef.current) {
      setCampaignName(next.suggestedCampaignName);
    }
  }, [id]);

  const loadCustomers = useCallback(async (mccCustomerId: string) => {
    if (!mccCustomerId || !isGoogleMccId(mccCustomerId)) {
      setCustomers([]);
      setCustomerId(undefined);
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
      setCustomerId(undefined);
    }
  }, []);

  const loadMccConnections = useCallback(async () => {
    try {
      const res = await api.get<ApiResult<{ connections: AdsConnection[] }>>('/google-ads/setup');
      if (!res.data.success) return;
      const rows = (res.data.data.connections ?? []).filter((row) => isGoogleMccId(row.mccCustomerId));
      setMccConnections(rows);
    } catch {
      setMccConnections([]);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void Promise.all([loadJob(), loadMccConnections()])
      .catch(() => message.error('加载任务失败'))
      .finally(() => setLoading(false));
  }, [loadJob, loadMccConnections]);

  useEffect(() => {
    if (!job) return;
    setSelectedMcc((prev) => {
      if (prev && isGoogleMccId(prev) && mccConnections.some((row) => row.mccCustomerId === prev)) {
        return prev;
      }
      if (isGoogleMccId(job.mccCustomerId) && mccConnections.some((row) => row.mccCustomerId === job.mccCustomerId)) {
        return job.mccCustomerId;
      }
      return mccConnections[0]?.mccCustomerId;
    });
  }, [job, mccConnections]);

  useEffect(() => {
    if (!selectedMcc) {
      setCustomers([]);
      setCustomerId(undefined);
      return;
    }
    void loadCustomers(selectedMcc);
  }, [selectedMcc, loadCustomers]);

  useEffect(() => {
    if (!job) return;
    if (job.status === 'READY_FOR_REVIEW' || job.status === 'COMPLETED' || job.status === 'FAILED') return;
    const timer = window.setInterval(() => {
      void loadJob().catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [job, loadJob]);

  const eligibleCustomers = useMemo(() => customers.filter(isEligible), [customers]);
  const lengthIssues = useMemo(() => collectLengthIssues(draft), [draft]);
  const merchantName = job?.input?.merchantName || draft.merchantUrl || '广告任务';
  const editable = job?.status === 'READY_FOR_REVIEW';
  const generating = Boolean(job && !['READY_FOR_REVIEW', 'COMPLETED', 'FAILED'].includes(job.status));
  // 生成中也展示预览骨架，文案到位后填入对应位置
  const showWorkspace = Boolean(job && (editable || generating || job.status === 'FAILED'));
  const previewHeadlines = draft.headlines.length
    ? draft.headlines
    : (generating ? Array.from({ length: 15 }, () => '') : draft.headlines);
  const previewDescriptions = draft.descriptions.length
    ? draft.descriptions
    : (generating ? Array.from({ length: 4 }, () => '') : draft.descriptions);

  const regenerateField = async (kind: 'headline' | 'description' | 'callout' | 'sitelink', index: number) => {
    if (!id || !editable || regeneratingKey) return;
    const key = `${kind}:${index}`;
    setRegeneratingKey(key);
    try {
      // 先把当前编辑存到服务端，避免单条重写盖掉未保存的其它改动
      await api.patch<ApiResult<AdJob>>(`/ad-jobs/${id}/draft`, draft);
      const res = await api.post<ApiResult<AdJob>>(`/ad-jobs/${id}/regenerate-field`, { kind, index });
      if (!res.data.success) {
        message.error(res.data.message || '重新生成失败');
        return;
      }
      const next = res.data.data;
      setJob(next);
      if (next.draft) setDraft(hydrateDraft(next.draft));
      message.success('已重新生成');
    } catch (err) {
      const apiMessage = (err as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      message.error(Array.isArray(apiMessage) ? apiMessage.join('；') : apiMessage || '重新生成失败');
    } finally {
      setRegeneratingKey(null);
    }
  };

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
      if (res.data.data.draft) setDraft(hydrateDraft(res.data.data.draft));
      message.success('草稿已保存');
    } catch (err) {
      const apiMessage = (err as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      message.error(Array.isArray(apiMessage) ? apiMessage.join('；') : apiMessage || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const syncCidList = async () => {
    if (!selectedMcc || !isGoogleMccId(selectedMcc)) {
      message.warning('请先选择已绑定的 Google MCC');
      return;
    }
    setSyncingCid(true);
    try {
      await api.post('/google-ads/sync', { mccCustomerId: selectedMcc });
      await loadCustomers(selectedMcc);
      message.success('已同步 CID 列表');
    } catch (err) {
      const apiMessage = (err as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      message.error(Array.isArray(apiMessage) ? apiMessage.join('；') : apiMessage || '同步失败');
    } finally {
      setSyncingCid(false);
    }
  };

  const probeSitelinkUrls = async (urls: string[]) => {
    const res = await api.post<ApiResult<{
      results: Array<{ ok: boolean; url: string; finalUrl: string; status: number; message: string }>;
    }>>('/ad-jobs/sitelinks/verify', { urls });
    if (!res.data.success) {
      throw new Error(res.data.message || '验证失败');
    }
    return res.data.data.results;
  };

  const verifySitelinkAt = async (index: number) => {
    const link = draft.sitelinks[index];
    if (!link) return;
    const url = link.finalUrl.trim();
    if (!/^https?:\/\//i.test(url)) {
      message.warning('请先填写有效的落地页 URL');
      return;
    }
    setVerifyingSitelinkIndex(index);
    try {
      const [result] = await probeSitelinkUrls([url]);
      setDraft((prev) => {
        const sitelinks = [...prev.sitelinks];
        const current = sitelinks[index];
        if (!current) return prev;
        sitelinks[index] = {
          ...current,
          finalUrl: result?.ok ? (result.finalUrl || current.finalUrl) : current.finalUrl,
          verified: Boolean(result?.ok),
        };
        return { ...prev, sitelinks };
      });
      if (!result?.ok) {
        message.error(result?.message || `站内链接 ${index + 1} 打不开`);
        return;
      }
      message.success(result.message || `站内链接 ${index + 1} 已验证可打开`);
    } catch (err) {
      const apiMessage = (err as { response?: { data?: { message?: string | string[] } }; message?: string }).response?.data?.message
        || (err as { message?: string }).message;
      message.error(Array.isArray(apiMessage) ? apiMessage.join('；') : apiMessage || '验证失败');
    } finally {
      setVerifyingSitelinkIndex(null);
    }
  };

  const verifyAllSitelinks = async () => {
    const pending = draft.sitelinks
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !item.verified && /^https?:\/\//i.test(item.finalUrl.trim()));
    if (!pending.length) {
      message.warning('没有待验证的落地页');
      return;
    }
    setVerifyingAllSitelinks(true);
    try {
      const results = await probeSitelinkUrls(pending.map(({ item }) => item.finalUrl.trim()));
      const byUrl = new Map(results.map((item) => [item.url, item]));
      let okCount = 0;
      const failMessages: string[] = [];
      setDraft((prev) => {
        const sitelinks = prev.sitelinks.map((link, index) => {
          const pendingItem = pending.find((row) => row.index === index);
          if (!pendingItem) return link;
          const result = byUrl.get(pendingItem.item.finalUrl.trim());
          if (!result?.ok) {
            if (result?.message) failMessages.push(`第 ${index + 1} 条：${result.message}`);
            return link;
          }
          okCount += 1;
          return {
            ...link,
            finalUrl: result.finalUrl || link.finalUrl,
            verified: true,
          };
        });
        return { ...prev, sitelinks };
      });
      if (okCount) message.success(`已验证 ${okCount} 条可打开`);
      if (failMessages.length) message.warning(failMessages.slice(0, 3).join('；'));
      if (!okCount && !failMessages.length) message.error('验证失败');
    } catch (err) {
      const apiMessage = (err as { response?: { data?: { message?: string | string[] } }; message?: string }).response?.data?.message
        || (err as { message?: string }).message;
      message.error(Array.isArray(apiMessage) ? apiMessage.join('；') : apiMessage || '验证失败');
    } finally {
      setVerifyingAllSitelinks(false);
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
      if (payload.job.draft) setDraft(hydrateDraft(payload.job.draft));
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
    if (!selectedMcc || !isGoogleMccId(selectedMcc)) {
      message.warning('请先选择已绑定的 Google MCC');
      return;
    }
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
            mccCustomerId: selectedMcc,
            customerId,
            campaignName: campaignName.trim() || undefined,
          });
          if (!res.data.success) {
            message.error(res.data.message || '发布失败');
            throw new Error('publish failed');
          }
          setJob(res.data.data);
          const nextDraft = res.data.data.draft ? hydrateDraft(res.data.data.draft) : draft;
          if (res.data.data.draft) setDraft(nextDraft);
          const submitted = res.data.data.campaign?.status === 'ENABLED';
          message.success(submitted ? '已提交到 Google Ads，请继续发露出文' : '已写入待提交队列，请继续发露出文');
          navigate(buildArticlePublishPath(res.data.data, nextDraft));
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
              <Tag>MCC {formatCustomerId(selectedMcc || job.mccCustomerId)}</Tag>
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
        <div className="ad-review__progress">
          <Progress
            className="ad-review__progress-bar"
            percent={Math.max(0, Math.min(100, job.progress || 0))}
            size="small"
            status="active"
          />
          <span className="ad-review__progress-text">
            {job.progressMessage || '正在生成'}（{job.progress || 0}%）· 文案与图片到位后会填入下方预览
          </span>
        </div>
      ) : null}

      {job.status === 'FAILED' ? (
        <Alert type="error" showIcon message="生成失败" description={job.errorMessage || '请返回商家页重新领取'} />
      ) : null}

      {editable && lengthIssues.length ? (
        <Alert
          className="ad-review__length-alert"
          type="error"
          showIcon
          message={`有 ${lengthIssues.length} 处超字数，请改短后再提交`}
          description={(
            <div className="ad-review__length-alert-list">
              {lengthIssues.slice(0, 12).join('；')}
              {lengthIssues.length > 12 ? `…等共 ${lengthIssues.length} 处` : ''}
            </div>
          )}
        />
      ) : null}

      {editable && job.errorMessage ? (
        <Alert
          type="warning"
          showIcon
          closable
          message={
            /超字数|需在 1 到|超过 \d+ 个字符/.test(job.errorMessage)
              ? '有文案超字数，请改短后发布'
              : /文案校验未通过|自动进入预览/.test(job.errorMessage)
                ? '生成未完全通过，请核对标红项'
                : '部分文案已自动替换，请核对'
          }
          description={job.errorMessage}
          onClose={() => setJob({ ...job, errorMessage: null })}
        />
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

      {!showWorkspace ? null : (
        <Row gutter={[16, 16]} className="ad-review__layout">
          <Col xs={24} lg={14} xl={15} className={`ad-review__main${generating ? ' is-locked' : ''}`}>
            <Card size="small" className="ad-review__card" title={`广告标题（${draft.headlines.length || previewHeadlines.length}/15）`}>
              {previewHeadlines.map((text, index) => (
                <div className={`ad-review__row${isOverLimit(text, HEADLINE_MAX) ? ' ad-review__row--over' : ''}`} key={`h-${index}`}>
                  <div className="ad-review__row-index">{index + 1}</div>
                  <div className="ad-review__row-main">
                    <Input
                      value={text}
                      className={isOverLimit(text, HEADLINE_MAX) ? 'ad-review__input--over' : undefined}
                      status={isOverLimit(text, HEADLINE_MAX) ? 'error' : undefined}
                      disabled={!editable}
                      placeholder={generating && !text ? '生成中…' : undefined}
                      onChange={(event) => {
                        const headlines = [...(draft.headlines.length ? draft.headlines : previewHeadlines)];
                        headlines[index] = event.target.value;
                        setDraft({ ...draft, headlines });
                      }}
                    />
                    {isOverLimit(text, HEADLINE_MAX) ? (
                      <div className="ad-review__field-over-tip">标题最多 {HEADLINE_MAX} 字，请改短</div>
                    ) : null}
                    {zhHint(draft.translations, 'headlines', index) ? (
                      <div className="ad-review__zh">{zhHint(draft.translations, 'headlines', index)}</div>
                    ) : null}
                  </div>
                  <div className="ad-review__row-actions">
                    {charCount(text, HEADLINE_MAX)}
                    <Space size={4}>
                      <Tooltip title="AI 重新生成这条标题">
                        <Button
                          type="text"
                          size="small"
                          icon={<SyncOutlined />}
                          loading={regeneratingKey === `headline:${index}`}
                          disabled={!editable || (regeneratingKey != null && regeneratingKey !== `headline:${index}`)}
                          onClick={() => void regenerateField('headline', index)}
                          aria-label="重新生成标题"
                        />
                      </Tooltip>
                      <Button type="text" size="small" icon={<CopyOutlined />} disabled={!text} onClick={() => copyText(text)} />
                      <Button
                        type="text"
                        size="small"
                        danger
                        disabled={!editable}
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
              {editable && draft.headlines.length < 15 ? (
                <Button type="dashed" block onClick={() => setDraft({ ...draft, headlines: [...draft.headlines, ''] })}>
                  + 添加标题
                </Button>
              ) : null}
            </Card>

            <Card size="small" className="ad-review__card" title={`广告描述（${draft.descriptions.length || previewDescriptions.length}/4）`}>
              {previewDescriptions.map((text, index) => (
                <div className={`ad-review__row${isOverLimit(text, DESC_MAX) ? ' ad-review__row--over' : ''}`} key={`d-${index}`}>
                  <div className="ad-review__row-index">{index + 1}</div>
                  <div className="ad-review__row-main">
                    <Input.TextArea
                      value={text}
                      className={isOverLimit(text, DESC_MAX) ? 'ad-review__input--over' : undefined}
                      autoSize={{ minRows: 1, maxRows: 3 }}
                      status={isOverLimit(text, DESC_MAX) ? 'error' : undefined}
                      disabled={!editable}
                      placeholder={generating && !text ? '生成中…' : undefined}
                      onChange={(event) => {
                        const descriptions = [...(draft.descriptions.length ? draft.descriptions : previewDescriptions)];
                        descriptions[index] = event.target.value;
                        setDraft({ ...draft, descriptions });
                      }}
                    />
                    {isOverLimit(text, DESC_MAX) ? (
                      <div className="ad-review__field-over-tip">描述最多 {DESC_MAX} 字，请改短</div>
                    ) : null}
                    {zhHint(draft.translations, 'descriptions', index) ? (
                      <div className="ad-review__zh">{zhHint(draft.translations, 'descriptions', index)}</div>
                    ) : null}
                  </div>
                  <div className="ad-review__row-actions">
                    {charCount(text, DESC_MAX)}
                    <Space size={4}>
                      <Tooltip title="AI 重新生成这条描述">
                        <Button
                          type="text"
                          size="small"
                          icon={<SyncOutlined />}
                          loading={regeneratingKey === `description:${index}`}
                          disabled={!editable || (regeneratingKey != null && regeneratingKey !== `description:${index}`)}
                          onClick={() => void regenerateField('description', index)}
                          aria-label="重新生成描述"
                        />
                      </Tooltip>
                      <Button type="text" size="small" icon={<CopyOutlined />} disabled={!text} onClick={() => copyText(text)} />
                      <Button
                        type="text"
                        size="small"
                        danger
                        disabled={!editable}
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
              {editable && draft.descriptions.length < 4 ? (
                <Button type="dashed" block onClick={() => setDraft({ ...draft, descriptions: [...draft.descriptions, ''] })}>
                  添加描述
                </Button>
              ) : null}
              <div className="ad-review__hint">描述 ≤90 字（与 Google Ads 一致）。</div>
            </Card>

            <Card
              size="small"
              className="ad-review__card"
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
                  <div key={`k-${index}`}>
                    <Space.Compact style={{ width: '100%' }}>
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
                    {zhHint(draft.translations, 'keywords', index) ? (
                      <div className="ad-review__zh">{zhHint(draft.translations, 'keywords', index)}</div>
                    ) : null}
                  </div>
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

            <Card size="small" className="ad-review__card" title={`否定关键词（${draft.negativeKeywords.length} 条）`}>
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

            <Card
              size="small"
              className="ad-review__card"
              title={`站内链接（${draft.sitelinks.length}，最多 8；可全部删除后发布）`}
              extra={(
                <Button
                  size="small"
                  type="link"
                  loading={verifyingAllSitelinks}
                  disabled={
                    verifyingSitelinkIndex != null
                    || !draft.sitelinks.length
                    || draft.sitelinks.every((item) => item.verified)
                  }
                  onClick={() => void verifyAllSitelinks()}
                >
                  全部验证
                </Button>
              )}
            >
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message="默认生成 6 条（第 1 条优先官网）。生成后会自动探测落地页；未通过的可再点「验证」。不合适可全部删除后再提交 Google Ads。"
              />
              {draft.sitelinks.map((link, index) => (
                <Card
                  key={`sl-${index}`}
                  size="small"
                  type="inner"
                  className={`ad-review__sitelink${sitelinkOver(link) ? ' ad-review__sitelink--over' : ''}`}
                  title={(
                    <Space size={8} wrap>
                      <span>{`站内链接 ${index + 1}${index === 0 ? '（优先官网）' : ''}`}</span>
                      {sitelinkOver(link) ? <Tag color="error">文案超限</Tag> : null}
                    </Space>
                  )}
                  extra={(
                    <Space>
                      {link.verified ? <Tag color="success">已验证</Tag> : <Tag color="warning">未验证</Tag>}
                      <Tooltip title="AI 重新生成这条站内链接文案">
                        <Button
                          type="text"
                          size="small"
                          icon={<SyncOutlined />}
                          loading={regeneratingKey === `sitelink:${index}`}
                          disabled={!editable || (regeneratingKey != null && regeneratingKey !== `sitelink:${index}`)}
                          onClick={() => void regenerateField('sitelink', index)}
                          aria-label="重新生成站内链接"
                        />
                      </Tooltip>
                      <Button
                        type="link"
                        size="small"
                        loading={verifyingSitelinkIndex === index || verifyingAllSitelinks}
                        disabled={
                          !/^https?:\/\//i.test(link.finalUrl.trim())
                          || (verifyingSitelinkIndex != null && verifyingSitelinkIndex !== index)
                          || verifyingAllSitelinks
                        }
                        onClick={() => void verifySitelinkAt(index)}
                      >
                        {link.verified ? '重新验证' : '验证'}
                      </Button>
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
                  {sitelinkOver(link) ? (
                    <div className="ad-review__field-over-tip">链接文字 ≤{SITELINK_TEXT_MAX}，两条描述各 ≤{SITELINK_DESC_MAX}，请改短</div>
                  ) : null}
                  <Row gutter={[8, 8]}>
                    <Col span={8}>
                      <Input
                        className={isOverLimit(link.linkText, SITELINK_TEXT_MAX) ? 'ad-review__input--over' : undefined}
                        placeholder="链接文字"
                        value={link.linkText}
                        status={isOverLimit(link.linkText, SITELINK_TEXT_MAX) ? 'error' : undefined}
                        onChange={(event) => {
                          const sitelinks = [...draft.sitelinks];
                          sitelinks[index] = { ...link, linkText: event.target.value };
                          setDraft({ ...draft, sitelinks });
                        }}
                        suffix={charCount(link.linkText, SITELINK_TEXT_MAX)}
                      />
                      {zhHint(draft.translations, 'sitelinks', index) ? (
                        <div className="ad-review__zh">{zhHint(draft.translations, 'sitelinks', index)}</div>
                      ) : null}
                    </Col>
                    <Col span={8}>
                      <Input
                        className={isOverLimit(link.description1, SITELINK_DESC_MAX) ? 'ad-review__input--over' : undefined}
                        placeholder="描述 1"
                        value={link.description1}
                        status={isOverLimit(link.description1, SITELINK_DESC_MAX) ? 'error' : undefined}
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
                        className={isOverLimit(link.description2, SITELINK_DESC_MAX) ? 'ad-review__input--over' : undefined}
                        placeholder="描述 2"
                        value={link.description2}
                        status={isOverLimit(link.description2, SITELINK_DESC_MAX) ? 'error' : undefined}
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

            <Card
              size="small"
              className="ad-review__card"
              title={(
                <Space>
                  <PictureOutlined />
                  <span>商家图片（可选）</span>
                  <Tag color="blue">自动生成</Tag>
                </Space>
              )}
              extra={(
                <Button size="small" icon={<ReloadOutlined />} loading={loadingAdImages} onClick={() => void loadAdImages()} disabled={!editable}>
                  重新提取
                </Button>
              )}
            >
              <div className="ad-review__hint" style={{ marginBottom: 8 }}>
                系统从商家官网、社媒与（若已配置）Google 按域名搜图拉取候选；可选。失败时可拖入图片或粘贴 URL。Google Ads 要求最低 300×300。
              </div>
              <div className="ad-review__hint" style={{ marginBottom: 8 }}>
                可选图片 {adImages.length} 张，已选 {selectedImageUrls.length} 张（点击选择/取消）
                {selectedSquareCount ? ` · 正方形 ${selectedSquareCount}` : ''}
              </div>
              {adImages.length ? (
                <div className="ad-review__media-grid">
                  {adImages.map((image) => {
                    const selected = selectedImageUrls.includes(image.url);
                    return (
                      <button
                        key={image.url}
                        type="button"
                        className={`ad-review__media-tile${selected ? ' is-selected' : ''}`}
                        disabled={!editable}
                        title={`${image.width}x${image.height}${image.square ? ' · 正方形' : ''}`}
                        onClick={() => {
                          setDraft((current) => {
                            const urls = current.imageUrls ?? [];
                            const next = selected
                              ? urls.filter((url) => url !== image.url)
                              : [...urls, image.url].slice(0, 20);
                            return { ...current, imageUrls: next };
                          });
                        }}
                      >
                        <img src={image.url} alt={image.alt || '广告图'} referrerPolicy="no-referrer" />
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <Upload.Dragger
                disabled={!editable}
                multiple
                accept="image/jpeg,image/png,.jpg,.jpeg,.png"
                showUploadList={false}
                beforeUpload={(file) => {
                  void addLocalFiles('image', [file]);
                  return false;
                }}
                className="ad-review__media-drop"
              >
                <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                <p className="ant-upload-text">点击或拖入商家产品图片</p>
                <p className="ant-upload-hint">支持 JPG、PNG，最大 5MB（Google Ads 要求最低 300×300 像素）</p>
              </Upload.Dragger>
              <Space.Compact style={{ width: '100%', marginTop: 8 }}>
                <Input
                  disabled={!editable}
                  value={pasteImageUrl}
                  placeholder="或粘贴图片 URL (https://...)"
                  onChange={(event) => setPasteImageUrl(event.target.value)}
                  onPressEnter={() => void addMediaUrl('image', pasteImageUrl)}
                />
                <Button type="primary" disabled={!editable} onClick={() => void addMediaUrl('image', pasteImageUrl)}>
                  + 添加 URL
                </Button>
              </Space.Compact>
            </Card>

            <Card
              size="small"
              className="ad-review__card"
              title={(
                <Space>
                  <PictureOutlined />
                  <span>商家商标（可选）</span>
                </Space>
              )}
              extra={(
                <Button size="small" icon={<ReloadOutlined />} loading={loadingAdImages} onClick={() => void loadAdImages()} disabled={!editable}>
                  重新提取
                </Button>
              )}
            >
              <div className="ad-review__hint" style={{ marginBottom: 8 }}>
                商标建议接近正方形。可选；不选也可提交。已选 {selectedLogoUrls.length}/5。
              </div>
              {logoImages.length ? (
                <div className="ad-review__media-grid">
                  {logoImages.map((image) => {
                    const selected = selectedLogoUrls.includes(image.url);
                    return (
                      <button
                        key={`logo-${image.url}`}
                        type="button"
                        className={`ad-review__media-tile${selected ? ' is-selected' : ''}`}
                        disabled={!editable}
                        onClick={() => {
                          setDraft((current) => {
                            const urls = current.logoUrls ?? [];
                            const next = selected
                              ? urls.filter((url) => url !== image.url)
                              : [...urls, image.url].slice(0, 5);
                            return { ...current, logoUrls: next };
                          });
                        }}
                      >
                        <img src={image.url} alt={image.alt || '商标'} referrerPolicy="no-referrer" />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="ad-review__hint" style={{ marginBottom: 8 }}>点「重新提取」或上传/粘贴商标图。</div>
              )}
              <Upload.Dragger
                disabled={!editable}
                multiple
                accept="image/jpeg,image/png,.jpg,.jpeg,.png"
                showUploadList={false}
                beforeUpload={(file) => {
                  void addLocalFiles('logo', [file]);
                  return false;
                }}
                className="ad-review__media-drop"
              >
                <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                <p className="ant-upload-text">点击或拖入商家商标</p>
                <p className="ant-upload-hint">支持 JPG、PNG，最大 5MB，建议正方形</p>
              </Upload.Dragger>
              <Space.Compact style={{ width: '100%', marginTop: 8 }}>
                <Input
                  disabled={!editable}
                  value={pasteLogoUrl}
                  placeholder="或粘贴商标 URL (https://...)"
                  onChange={(event) => setPasteLogoUrl(event.target.value)}
                  onPressEnter={() => void addMediaUrl('logo', pasteLogoUrl)}
                />
                <Button type="primary" disabled={!editable} onClick={() => void addMediaUrl('logo', pasteLogoUrl)}>
                  + 添加 URL
                </Button>
              </Space.Compact>
            </Card>

            <Card size="small" className="ad-review__card" title={`宣传信息（${draft.callouts.length}，默认 8，最多 20）`}>
              <div className="ad-review__hint" style={{ marginBottom: 8 }}>
                可写折扣、免运费、优惠等促销语；具体百分比优惠码更建议放下方促销栏。
              </div>
              {draft.callouts.map((text, index) => (
                <div className={`ad-review__row${isOverLimit(text, CALLOUT_MAX) ? ' ad-review__row--over' : ''}`} key={`c-${index}`}>
                  <div className="ad-review__row-index">{index + 1}</div>
                  <div className="ad-review__row-main">
                    <Input
                      value={text}
                      className={isOverLimit(text, CALLOUT_MAX) ? 'ad-review__input--over' : undefined}
                      status={isOverLimit(text, CALLOUT_MAX) ? 'error' : undefined}
                      onChange={(event) => {
                        const callouts = [...draft.callouts];
                        callouts[index] = event.target.value;
                        setDraft({ ...draft, callouts });
                      }}
                    />
                    {zhHint(draft.translations, 'callouts', index) ? (
                      <div className="ad-review__zh">{zhHint(draft.translations, 'callouts', index)}</div>
                    ) : null}
                    {isOverLimit(text, CALLOUT_MAX) ? (
                      <div className="ad-review__field-over-tip">宣传信息最多 {CALLOUT_MAX} 字，请改短</div>
                    ) : null}
                  </div>
                  <div className="ad-review__row-actions">
                    {charCount(text, CALLOUT_MAX)}
                    <Space size={4}>
                      <Tooltip title="AI 重新生成这条宣传信息">
                        <Button
                          type="text"
                          size="small"
                          icon={<SyncOutlined />}
                          loading={regeneratingKey === `callout:${index}`}
                          disabled={!editable || (regeneratingKey != null && regeneratingKey !== `callout:${index}`)}
                          onClick={() => void regenerateField('callout', index)}
                          aria-label="重新生成宣传信息"
                        />
                      </Tooltip>
                      <Button
                        type="text"
                        size="small"
                        danger
                        disabled={!editable}
                        icon={<DeleteOutlined />}
                        onClick={() => setDraft({
                          ...draft,
                          callouts: draft.callouts.filter((_, i) => i !== index),
                        })}
                      />
                    </Space>
                  </div>
                </div>
              ))}
              {draft.callouts.length < 20 ? (
                <Button type="dashed" block onClick={() => setDraft({ ...draft, callouts: [...draft.callouts, ''] })}>
                  + 添加宣传信息（最多 20）
                </Button>
              ) : null}
            </Card>

            <Card
              size="small"
              className="ad-review__card"
              title={(
                <Space>
                  <span>促销（可选）</span>
                  <Switch
                    checked={Boolean(draft.promotionAsset?.enabled)}
                    onChange={(enabled) => setDraft({
                      ...draft,
                      promotionAsset: {
                        ...(draft.promotionAsset || emptyPromotion()),
                        enabled,
                        languageCode: draft.promotionAsset?.languageCode || draft.languageCode || 'en',
                        finalUrl: draft.promotionAsset?.finalUrl || draft.merchantUrl,
                      },
                    })}
                  />
                </Space>
              )}
            >
              {draft.promotionAsset?.enabled ? (
                <Space direction="vertical" style={{ width: '100%' }} size={8}>
                  <Input
                    placeholder="商品/对象（≤20）"
                    maxLength={20}
                    value={draft.promotionAsset.promotionTarget}
                    onChange={(event) => setDraft({
                      ...draft,
                      promotionAsset: { ...draft.promotionAsset!, promotionTarget: event.target.value },
                    })}
                    suffix={`${draft.promotionAsset.promotionTarget.length}/20`}
                  />
                  <Space wrap>
                    <Select
                      style={{ width: 140 }}
                      value={draft.promotionAsset.discountType}
                      options={[
                        { value: 'PERCENT', label: '折扣百分比' },
                        { value: 'MONETARY', label: '折扣金额' },
                      ]}
                      onChange={(discountType) => setDraft({
                        ...draft,
                        promotionAsset: { ...draft.promotionAsset!, discountType },
                      })}
                    />
                    {draft.promotionAsset.discountType === 'PERCENT' ? (
                      <Input
                        style={{ width: 140 }}
                        suffix="%"
                        value={draft.promotionAsset.percentOff ?? ''}
                        onChange={(event) => setDraft({
                          ...draft,
                          promotionAsset: {
                            ...draft.promotionAsset!,
                            percentOff: Number(event.target.value) || 0,
                          },
                        })}
                      />
                    ) : (
                      <Space>
                        <Input
                          style={{ width: 90 }}
                          value={draft.promotionAsset.currencyCode || 'USD'}
                          onChange={(event) => setDraft({
                            ...draft,
                            promotionAsset: { ...draft.promotionAsset!, currencyCode: event.target.value },
                          })}
                        />
                        <Input
                          style={{ width: 120 }}
                          value={draft.promotionAsset.moneyAmountOff || ''}
                          onChange={(event) => setDraft({
                            ...draft,
                            promotionAsset: { ...draft.promotionAsset!, moneyAmountOff: event.target.value },
                          })}
                        />
                      </Space>
                    )}
                  </Space>
                  <Input
                    placeholder="最终到达网址"
                    value={draft.promotionAsset.finalUrl || draft.merchantUrl}
                    onChange={(event) => setDraft({
                      ...draft,
                      promotionAsset: { ...draft.promotionAsset!, finalUrl: event.target.value },
                    })}
                  />
                  <Input
                    placeholder="促销代码（可选）"
                    value={draft.promotionAsset.promotionCode || ''}
                    onChange={(event) => setDraft({
                      ...draft,
                      promotionAsset: { ...draft.promotionAsset!, promotionCode: event.target.value },
                    })}
                  />
                  <Space wrap style={{ width: '100%' }}>
                    <Input
                      style={{ width: 160 }}
                      placeholder="开始日期 YYYY-MM-DD"
                      value={draft.promotionAsset.startDate || ''}
                      onChange={(event) => setDraft({
                        ...draft,
                        promotionAsset: { ...draft.promotionAsset!, startDate: event.target.value },
                      })}
                      allowClear
                    />
                    <Input
                      style={{ width: 160 }}
                      placeholder="结束日期 YYYY-MM-DD"
                      value={draft.promotionAsset.endDate || ''}
                      onChange={(event) => setDraft({
                        ...draft,
                        promotionAsset: { ...draft.promotionAsset!, endDate: event.target.value },
                      })}
                      allowClear
                    />
                  </Space>
                  <div className="ad-review__hint">起止时间留空即可；需要限时再按投放情况填写。</div>
                  {draft.translations?.promotion ? (
                    <div className="ad-review__zh">{draft.translations.promotion}</div>
                  ) : null}
                </Space>
              ) : (
                <div className="ad-review__hint">默认关闭。有明确折扣/满减时再打开并填写。</div>
              )}
            </Card>

            <Card size="small" className="ad-review__card" title={`结构化摘要（${draft.structuredSnippets.length}）`}>
              <div className="ad-review__hint" style={{ marginBottom: 8 }}>
                可选附加信息，可全部删除；提交时不强制。
              </div>
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                {draft.structuredSnippets.map((snippet, index) => {
                  const overValues = snippet.values.filter((value) => isOverLimit(value, SNIPPET_VALUE_MAX));
                  return (
                  <Card
                    key={`s-${index}`}
                    size="small"
                    type="inner"
                    className={overValues.length ? 'ad-review__snippet--over' : undefined}
                    title={overValues.length ? <Tag color="error">有值超限</Tag> : undefined}
                    extra={(
                      <Button
                        type="text"
                        size="small"
                        danger
                        disabled={!editable}
                        icon={<DeleteOutlined />}
                        aria-label="删除结构化摘要"
                        onClick={() => {
                          const structuredSnippets = draft.structuredSnippets.filter((_, i) => i !== index);
                          const translations = draft.translations
                            ? {
                                ...draft.translations,
                                structuredSnippets: (draft.translations.structuredSnippets ?? [])
                                  .filter((_, i) => i !== index),
                              }
                            : draft.translations;
                          setDraft({ ...draft, structuredSnippets, translations });
                        }}
                      />
                    )}
                  >
                    <Select
                      style={{ width: '100%', marginBottom: 8 }}
                      value={snippet.header}
                      disabled={!editable}
                      options={SNIPPET_HEADERS.map((header) => ({ value: header, label: header }))}
                      onChange={(header) => {
                        const structuredSnippets = [...draft.structuredSnippets];
                        structuredSnippets[index] = { ...structuredSnippets[index], header };
                        setDraft({ ...draft, structuredSnippets });
                      }}
                    />
                    <Input.TextArea
                      rows={2}
                      disabled={!editable}
                      status={overValues.length ? 'error' : undefined}
                      className={overValues.length ? 'ad-review__input--over' : undefined}
                      placeholder="逗号或换行分隔，至少 3 个值；每个值 ≤20 字"
                      value={snippet.values.join(', ')}
                      onChange={(event) => {
                        const values = event.target.value
                          .split(/[,\n]/)
                          .map((item) => item.trim())
                          .filter(Boolean)
                          .slice(0, 10);
                        const structuredSnippets = [...draft.structuredSnippets];
                        structuredSnippets[index] = { ...structuredSnippets[index], values };
                        setDraft({ ...draft, structuredSnippets });
                      }}
                    />
                    {overValues.length ? (
                      <div className="ad-review__field-over-tip">
                        每个值最多 {SNIPPET_VALUE_MAX} 字，当前有 {overValues.length} 个超限
                      </div>
                    ) : null}
                    {zhHint(draft.translations, 'structuredSnippets', index) ? (
                      <div className="ad-review__zh" style={{ marginTop: 6 }}>
                        {zhHint(draft.translations, 'structuredSnippets', index)}
                      </div>
                    ) : null}
                  </Card>
                  );
                })}
                {editable && draft.structuredSnippets.length < 2 ? (
                  <Button
                    type="dashed"
                    block
                    onClick={() => {
                      const used = new Set(draft.structuredSnippets.map((row) => row.header));
                      const header = SNIPPET_HEADERS.find((item) => !used.has(item)) || 'Types';
                      setDraft({
                        ...draft,
                        structuredSnippets: [...draft.structuredSnippets, { header, values: [] }],
                      });
                    }}
                  >
                    + 添加结构化摘要
                  </Button>
                ) : null}
              </Space>
            </Card>
          </Col>

          <Col xs={24} lg={10} xl={9}>
            <div className="ad-review__aside">
              <Card size="small" className="ad-review__card" title="发布账户 (CID)">
                <Form layout="vertical">
                  <Form.Item
                    label="MCC 账户"
                    required
                    extra={mccConnections.length ? '以账户状态页已绑定的 MCC 为准' : undefined}
                  >
                    <Select
                      showSearch
                      optionFilterProp="label"
                      value={selectedMcc}
                      placeholder={mccConnections.length ? '选择已绑定的 MCC' : '请先在账户状态页绑定 MCC'}
                      options={mccConnections.map((row) => ({
                        value: row.mccCustomerId,
                        label: `${formatCustomerId(row.mccCustomerId)}${row.customerCount ? ` · ${row.customerCount} 个子账号` : ''}`,
                      }))}
                      onChange={(value) => {
                        setSelectedMcc(value);
                        setCustomerId(undefined);
                      }}
                      notFoundContent="没有已绑定的 Google MCC"
                    />
                    {!mccConnections.length ? (
                      <Alert
                        type="warning"
                        showIcon
                        style={{ marginTop: 8 }}
                        message="还没有绑定 Google MCC。请到账户状态页添加 10 位经理账号客户号后再同步。"
                      />
                    ) : null}
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
                      disabled={!selectedMcc}
                      placeholder={
                        !selectedMcc
                          ? '请先选择 MCC'
                          : eligibleCustomers.length
                            ? '选择空闲子账号'
                            : '没有可用 CID'
                      }
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
                  <Form.Item
                    label={(
                      <Space>
                        <span>广告系列名</span>
                        {campaignNameDirty ? <Tag color="processing">已手改</Tag> : <Tag>可编辑</Tag>}
                        {job.suggestedCampaignName && campaignNameDirty ? (
                          <Button
                            type="link"
                            size="small"
                            onClick={() => {
                              setCampaignName(job.suggestedCampaignName || '');
                              setCampaignNameDirty(false);
                            }}
                          >
                            恢复建议名
                          </Button>
                        ) : null}
                      </Space>
                    )}
                    style={{ marginTop: 12 }}
                  >
                    <Input
                      value={campaignName}
                      maxLength={120}
                      placeholder="序号-联盟序号-商家-国家-日期-MID"
                      onChange={(event) => {
                        setCampaignName(event.target.value);
                        setCampaignNameDirty(true);
                      }}
                      suffix={<span className="ad-review__count">{campaignName.length}/120</span>}
                    />
                    <div className="ad-review__hint">
                      可直接改任意段；国家段需含 {job.targetCountry}。留空则发布时用建议名。
                      {job.affiliateAlias ? ` 联盟序号：${job.affiliateAlias}` : ''}
                    </div>
                  </Form.Item>
                </Form>
              </Card>

              <Card size="small" className="ad-review__card" title="广告设置">
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
                      onChange={(bidding) => setDraft({
                        ...draft,
                        bidding,
                        cpcBidCeilingUsd: bidding === 'MANUAL_CPC' ? draft.cpcBidCeilingUsd : '',
                      })}
                    />
                  </Form.Item>
                  {draft.bidding === 'MANUAL_CPC' ? (
                    <Form.Item label="最高 CPC (USD)" required>
                      <Input
                        prefix="$"
                        value={draft.cpcBidCeilingUsd}
                        placeholder="手动 CPC 必填"
                        onChange={(event) => setDraft({ ...draft, cpcBidCeilingUsd: event.target.value })}
                      />
                    </Form.Item>
                  ) : null}
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

              <Card size="small" className="ad-review__card" title="商家信息">
                <div className="ad-review__meta" style={{ marginBottom: 12 }}>
                  <Tag>{merchantName}</Tag>
                  {job.input?.platformCode ? <Tag>{job.input.platformCode}</Tag> : null}
                  <Tag color="blue">{job.targetCountry}</Tag>
                  <Tag color="orange">{draft.languageCode || 'en'}</Tag>
                </div>
                <Form layout="vertical">
                  <Form.Item
                    label="商家名称（选填）"
                    extra="对应 Google Ads「商家名称」资产。可留空提交；有值时最长 25 字，宜与网址或认证广告客户名一致。"
                  >
                    <Input
                      value={draft.businessName ?? ''}
                      className={isOverLimit(draft.businessName ?? '', BUSINESS_NAME_MAX) ? 'ad-review__input--over' : undefined}
                      status={isOverLimit(draft.businessName ?? '', BUSINESS_NAME_MAX) ? 'error' : undefined}
                      suffix={charCount(draft.businessName ?? '', BUSINESS_NAME_MAX)}
                      placeholder="可留空；留空则由 Google 按网址使用占位名称"
                      onChange={(event) => setDraft({ ...draft, businessName: event.target.value })}
                    />
                    {isOverLimit(draft.businessName ?? '', BUSINESS_NAME_MAX) ? (
                      <div className="ad-review__field-over-tip">商家名称最多 {BUSINESS_NAME_MAX} 字</div>
                    ) : null}
                  </Form.Item>
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
                {lengthIssues.length ? (
                  <Alert
                    type="error"
                    showIcon
                    style={{ marginBottom: 10 }}
                    message={`还有 ${lengthIssues.length} 处超字数，改短后才能提交`}
                  />
                ) : null}
                <Button
                  type="primary"
                  className="ad-review__publish"
                  icon={<RocketOutlined />}
                  size="large"
                  loading={publishing}
                  disabled={!customerId || lengthIssues.length > 0}
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
