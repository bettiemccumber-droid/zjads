import { GEO_TARGET_BY_COUNTRY, LANGUAGE_CONSTANT_BY_CODE } from './geo-language.constants';

/** RSA / 附加信息字数上限（空格标点均计 1）。描述按 Google Ads 90。 */
export const AD_COPY_LIMITS = {
  headline: 30,
  description: 90,
  callout: 25,
  sitelinkText: 20,
  sitelinkDescription: 25,
  structuredValue: 20,
  headlineCount: { min: 3, max: 15, prefer: 15 },
  descriptionCount: { min: 2, max: 4, prefer: 4 },
  calloutCount: { min: 0, max: 8, prefer: 8 },
  sitelinkCount: { min: 0, max: 8, prefer: 6 },
  structuredCategories: 2,
  structuredValuesMin: 4,
} as const;

/**
 * Google 结构化摘要 header。mutate 必须用英文原文，不能用 TYPES 这类枚举名。
 * @see https://developers.google.com/google-ads/api/reference/data/structured-snippet-headers
 */
export const STRUCTURED_SNIPPET_HEADERS = [
  'Amenities',
  'Brands',
  'Courses',
  'Degree programs',
  'Destinations',
  'Featured hotels',
  'Insurance coverage',
  'Models',
  'Neighborhoods',
  'Service catalog',
  'Shows',
  'Styles',
  'Types',
] as const;

/** 旧草稿 / 模型偶发返回的枚举名 → 官方英文 header。 */
const STRUCTURED_SNIPPET_HEADER_ALIASES: Record<string, (typeof STRUCTURED_SNIPPET_HEADERS)[number]> = {
  AMENITIES: 'Amenities',
  BRANDS: 'Brands',
  COURSES: 'Courses',
  DEGREE_PROGRAMS: 'Degree programs',
  DESTINATIONS: 'Destinations',
  FEATURED_HOTELS: 'Featured hotels',
  INSURANCE_COVERAGE: 'Insurance coverage',
  MODELS: 'Models',
  NEIGHBORHOODS: 'Neighborhoods',
  SERVICES: 'Service catalog',
  SERVICE_CATALOG: 'Service catalog',
  SHOWS: 'Shows',
  STYLES: 'Styles',
  TYPES: 'Types',
};

/**
 * 把结构化摘要 header 归一成 Google 接受的英文原文；无法识别则返回空。
 */
export function normalizeStructuredSnippetHeader(raw: string): string {
  const text = raw.trim();
  if (!text) return '';
  const exact = STRUCTURED_SNIPPET_HEADERS.find((item) => item === text);
  if (exact) return exact;
  const caseFold = STRUCTURED_SNIPPET_HEADERS.find((item) => item.toLowerCase() === text.toLowerCase());
  if (caseFold) return caseFold;
  const alias = STRUCTURED_SNIPPET_HEADER_ALIASES[text.toUpperCase().replace(/\s+/g, '_')];
  return alias ?? '';
}

/** 人工核对用的中文译文（不提交 Google）。 */
export interface AdCopyTranslations {
  headlines?: string[];
  descriptions?: string[];
  callouts?: string[];
  sitelinks?: string[];
  promotion?: string;
}

/**
 * Google Ads 促销附加信息（可选）。对应 promotionAsset。
 * percentOff 用百分点，如 20 表示 20%；发布时再换成 micros。
 */
export interface AdPromotionAsset {
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

/** 广告草稿。最终到达网址是商家网址，不是文章 URL。 */
export interface AdDraft {
  headlines: string[];
  descriptions: string[];
  keywords: AdKeyword[];
  negativeKeywords: AdKeyword[];
  sitelinks: AdSitelink[];
  callouts: string[];
  structuredSnippets: AdStructuredSnippet[];
  /** 旧版纯文本促销备注；有 promotionAsset 时优先用结构化字段。 */
  promotion: string;
  promotionAsset?: AdPromotionAsset | null;
  /** 投放语言文案对应的中文翻译，仅预览用。 */
  translations?: AdCopyTranslations;
  merchantUrl: string;
  finalUrlSuffix: string;
  bidding: 'MAXIMIZE_CLICKS' | 'MANUAL_CPC';
  dailyBudgetUsd: string;
  /** 最高 CPC；尽可能多点击时可不填。 */
  cpcBidCeilingUsd: string;
  languageCode: string;
  geoTargetId: string;
}

/** 结构化摘要：从 13 类里按商家特点选 2 类。 */
export interface AdStructuredSnippet {
  header: string;
  values: string[];
}

/** 关键词。匹配类型单独存放，文本里不带引号或方括号。 */
export interface AdKeyword {
  text: string;
  matchType: 'BROAD' | 'PHRASE' | 'EXACT';
}

/** 站内链接。verified 是本系统的 HTTP 校验结果，不会传给 Google。 */
export interface AdSitelink {
  linkText: string;
  description1: string;
  description2: string;
  finalUrl: string;
  verified: boolean;
}

/**
 * 把美元字符串转成 Google Ads micros 字符串。
 */
export function usdToMicros(usd: string): string {
  if (!/^\d+(\.\d{1,6})?$/.test(usd)) {
    throw new Error('预算格式应为最多 6 位小数的金额');
  }
  const [whole, frac = ''] = usd.split('.');
  const frac6 = (frac + '000000').slice(0, 6);
  return (BigInt(whole) * 1_000_000n + BigInt(frac6)).toString();
}

/**
 * 去掉用户从 Google 后台复制来的匹配符号。
 */
export function stripKeywordDecorations(raw: string): string {
  let text = raw.trim();
  if (
    (text.startsWith('[') && text.endsWith(']')) ||
    (text.startsWith('"') && text.endsWith('"'))
  ) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

/**
 * 国家代码对应的地区常量。未知国家返回空字符串。
 */
export function geoTargetForCountry(countryCode: string): string {
  return GEO_TARGET_BY_COUNTRY[countryCode.trim().toUpperCase()] ?? '';
}

/**
 * 语言代码对应的语言常量。支持 en / zh / zh-CN / zh_TW / he 等写法。
 */
export function languageConstant(languageCode: string): string {
  const raw = languageCode.trim();
  if (!raw) return '';
  const normalized = raw.replace(/-/g, '_');
  const candidates = [
    normalized,
    normalized.toLowerCase(),
    raw.toLowerCase(),
    normalized.toLowerCase().slice(0, 2),
  ];
  for (const code of candidates) {
    const id = LANGUAGE_CONSTANT_BY_CODE[code];
    if (id) return id;
  }
  return '';
}

/**
 * 用亚洲/上海时区取出月日，用于系列名。
 */
export function shanghaiMonthDay(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${month}${day}`;
}

/**
 * 系列名中的商家片段，只保留字母和数字。
 */
export function merchantSlug(name: string): string {
  const slug = name.replace(/[^A-Za-z0-9]/g, '');
  return (slug || 'Merchant').slice(0, 24);
}

/**
 * 组装系列名：序号-联盟序号-商家-国家-月日-商家ID。
 * 第二段用渠道 affiliateAlias（如 rw5、pm1、bsh1），不是平台全名。
 */
export function buildCampaignName(input: {
  sequence: number;
  /** 联盟序号，如 rw5 / pm1；兼容旧调用里的 platformCode 字段名。 */
  platformCode: string;
  merchantName: string;
  countryCode: string;
  mid: string;
  now?: Date;
}): string {
  const alias = (input.platformCode || 'ads').trim().toLowerCase() || 'ads';
  return [
    String(input.sequence),
    alias,
    merchantSlug(input.merchantName),
    input.countryCode.toUpperCase(),
    shanghaiMonthDay(input.now),
    input.mid,
  ].join('-');
}

/**
 * 校验手改系列名：必须含目标国家段，且非空。
 */
export function assertCampaignNameCountry(campaignName: string, countryCode: string): string {
  const name = campaignName.trim();
  if (!name) throw new Error('广告系列名不能为空');
  if (name.length > 120) throw new Error('广告系列名不能超过 120 个字符');
  const country = countryCode.trim().toUpperCase();
  const parts = name.split('-').map((part) => part.trim()).filter(Boolean);
  if (!parts.some((part) => part.toUpperCase() === country)) {
    throw new Error(`广告系列名需包含国家 ${country}`);
  }
  return name;
}

/**
 * 正文联盟链接。路径上的跟踪令牌尚未从页面拿到，先接确认过的 url 参数。
 * 有渠道前缀时用前缀，否则 Partnermatic 使用 /track/。
 */
export function buildTrackUrl(platformCode: string, merchantUrl: string, prefix = ''): string {
  const target = encodeURIComponent(merchantUrl);
  const base =
    prefix.trim() ||
    (platformCode === 'partnermatic' ? 'https://app.partnermatic.com/track/' : '');
  if (!base) return merchantUrl;
  const join = base.includes('?') ? '&' : '?';
  return `${base}${join}url=${target}`;
}

/**
 * 生成一份不超过字数限制的样例草稿。抓站和模型接入前使用。
 */
export function buildSampleDraft(input: {
  merchantName: string;
  merchantUrl: string;
  countryCode: string;
  languageCode: string;
  bidding?: 'MAXIMIZE_CLICKS' | 'MANUAL_CPC';
  dailyBudgetUsd?: string;
  cpcBidCeilingUsd?: string;
}): AdDraft {
  const brand = stripKeywordDecorations(input.merchantName).slice(0, 30) || 'Brand';
  const headlines = [
    `${brand} Official`,
    `Shop ${brand}`,
    `Free Shipping Options`,
    `Fast Delivery Available`,
    `${brand} New Arrivals`,
    `Explore ${brand}`,
    `${brand} Collection`,
    `Visit ${brand}`,
    `${brand} Online`,
    `Discover ${brand}`,
    `${brand} Store`,
    `Browse ${brand}`,
    `${brand} Picks`,
    `Get ${brand} Today`,
    `${brand} Home`,
  ].map((text) => text.slice(0, AD_COPY_LIMITS.headline));
  const descriptions = [
    `Browse ${brand} styles and shop what fits you.`.slice(0, AD_COPY_LIMITS.description),
    `See new arrivals from ${brand} and start shopping.`.slice(0, AD_COPY_LIMITS.description),
    `Find everyday essentials and seasonal picks at ${brand}.`.slice(0, AD_COPY_LIMITS.description),
    `Explore ${brand} online with clear shipping options.`.slice(0, AD_COPY_LIMITS.description),
  ];
  return {
    headlines,
    descriptions,
    translations: {
      headlines: [
        `${brand} 官方站`,
        `选购 ${brand}`,
        '可选免运/包邮方案',
        '支持快速配送',
        `${brand} 新品`,
        `探索 ${brand}`,
        `${brand} 系列`,
        `访问 ${brand}`,
        `${brand} 线上店`,
        `发现 ${brand}`,
        `${brand} 店铺`,
        `浏览 ${brand}`,
        `${brand} 精选`,
        `立即选购 ${brand}`,
        `${brand} 首页`,
      ].slice(0, headlines.length),
      descriptions: [
        `浏览 ${brand} 款式，挑选适合你的商品。`,
        `查看 ${brand} 新品并开始下单。`,
        `在 ${brand} 找到日常与季节精选。`,
        `在线逛 ${brand}，物流信息更清晰。`,
      ],
      callouts: [
        '官方网站',
        '在线下单',
        '丰富选择',
        '可信品牌',
        '浏览便捷',
        '结账安全',
        '上新不断',
        '在线购买',
      ],
      sitelinks: ['立即选购', '新品上市', '热销榜', '系列合集', '品牌介绍', '开始购物'],
    },
    keywords: [{ text: brand.toLowerCase().slice(0, 80), matchType: 'PHRASE' }],
    negativeKeywords: ['careers', 'jobs', 'login', 'wiki', 'free', 'pdf', 'manual'].map((text) => ({
      text,
      matchType: 'BROAD' as const,
    })),
    sitelinks: assignUniqueSitelinkUrls(
      [
        {
          linkText: 'Shop now'.slice(0, AD_COPY_LIMITS.sitelinkText),
          description1: 'Current styles'.slice(0, AD_COPY_LIMITS.sitelinkDescription),
          description2: 'View the latest'.slice(0, AD_COPY_LIMITS.sitelinkDescription),
          finalUrl: '',
          verified: false,
        },
        {
          linkText: 'New arrivals'.slice(0, AD_COPY_LIMITS.sitelinkText),
          description1: 'Fresh picks'.slice(0, AD_COPY_LIMITS.sitelinkDescription),
          description2: 'See what is new'.slice(0, AD_COPY_LIMITS.sitelinkDescription),
          finalUrl: '',
          verified: false,
        },
        {
          linkText: 'Best sellers'.slice(0, AD_COPY_LIMITS.sitelinkText),
          description1: 'Popular items'.slice(0, AD_COPY_LIMITS.sitelinkDescription),
          description2: 'Shop top choices'.slice(0, AD_COPY_LIMITS.sitelinkDescription),
          finalUrl: '',
          verified: false,
        },
        {
          linkText: 'Collections'.slice(0, AD_COPY_LIMITS.sitelinkText),
          description1: 'Browse categories'.slice(0, AD_COPY_LIMITS.sitelinkDescription),
          description2: 'Find your style'.slice(0, AD_COPY_LIMITS.sitelinkDescription),
          finalUrl: '',
          verified: false,
        },
        {
          linkText: 'About brand'.slice(0, AD_COPY_LIMITS.sitelinkText),
          description1: 'Learn more'.slice(0, AD_COPY_LIMITS.sitelinkDescription),
          description2: 'Brand story'.slice(0, AD_COPY_LIMITS.sitelinkDescription),
          finalUrl: '',
          verified: false,
        },
        {
          linkText: 'Start shopping'.slice(0, AD_COPY_LIMITS.sitelinkText),
          description1: 'Ready to buy'.slice(0, AD_COPY_LIMITS.sitelinkDescription),
          description2: 'Checkout online'.slice(0, AD_COPY_LIMITS.sitelinkDescription),
          finalUrl: '',
          verified: false,
        },
      ],
      input.merchantUrl,
      [
        { url: joinMerchantPath(input.merchantUrl, '/shop'), label: 'Shop now' },
        { url: joinMerchantPath(input.merchantUrl, '/new-arrivals'), label: 'New arrivals' },
        { url: joinMerchantPath(input.merchantUrl, '/best-sellers'), label: 'Best sellers' },
        { url: joinMerchantPath(input.merchantUrl, '/collections'), label: 'Collections' },
        { url: joinMerchantPath(input.merchantUrl, '/about'), label: 'About brand' },
        { url: joinMerchantPath(input.merchantUrl, '/order'), label: 'Start shopping' },
      ],
    ),
    callouts: [
      'Official Site',
      'Shop Online',
      'Wide Selection',
      'Trusted Brand',
      'Easy Browsing',
      'Secure Checkout',
      'New Arrivals',
      'Order Online',
    ].map((text) => text.slice(0, AD_COPY_LIMITS.callout)),
    structuredSnippets: [
      { header: 'Types', values: ['Apparel', 'Accessories', 'Footwear', 'Essentials'] },
      { header: 'Styles', values: ['Casual', 'Classic', 'Modern', 'Everyday'] },
    ],
    promotion: '',
    promotionAsset: null,
    merchantUrl: input.merchantUrl,
    finalUrlSuffix: '',
    bidding: input.bidding === 'MANUAL_CPC' ? 'MANUAL_CPC' : 'MAXIMIZE_CLICKS',
    dailyBudgetUsd: input.dailyBudgetUsd?.trim() || '3.00',
    cpcBidCeilingUsd: input.cpcBidCeilingUsd?.trim() || '',
    languageCode: input.languageCode || 'en',
    geoTargetId: geoTargetForCountry(input.countryCode),
  };
}

/**
 * 确认发布前的字数、结构和政策词校验。返回中文错误列表，空数组表示可以通过。
 */
export function validateDraft(draft: AdDraft): string[] {
  const errors: string[] = [];
  const limits = AD_COPY_LIMITS;
  if (draft.headlines.length < limits.headlineCount.min || draft.headlines.length > limits.headlineCount.max) {
    errors.push(`标题需要 ${limits.headlineCount.min} 到 ${limits.headlineCount.max} 条`);
  }
  const headlineSet = new Set<string>();
  draft.headlines.forEach((text, index) => {
    if (text.trim().length === 0 || text.length > limits.headline) {
      errors.push(`标题 ${index + 1} 需在 1 到 ${limits.headline} 个字符`);
    }
    const key = text.trim().toLowerCase();
    if (headlineSet.has(key)) errors.push(`标题 ${index + 1} 与其它标题重复`);
    headlineSet.add(key);
    errors.push(...policyHits(text, `标题 ${index + 1}`, { allowPromo: true }));
  });
  if (draft.descriptions.length < limits.descriptionCount.min || draft.descriptions.length > limits.descriptionCount.max) {
    errors.push(`描述需要 ${limits.descriptionCount.min} 到 ${limits.descriptionCount.max} 条`);
  }
  draft.descriptions.forEach((text, index) => {
    if (text.trim().length === 0 || text.length > limits.description) {
      errors.push(`描述 ${index + 1} 需在 1 到 ${limits.description} 个字符`);
    }
    errors.push(...policyHits(text, `描述 ${index + 1}`, { allowPromo: true }));
  });
  if (draft.keywords.length === 0) errors.push('至少需要一个关键词');
  draft.keywords.forEach((keyword) => {
    if (!keyword.text.trim()) errors.push('关键词不能为空');
  });
  if (!draft.negativeKeywords.length) errors.push('至少需要一条否定关键词');
  const sitelinkUrlKeys = new Set<string>();
  draft.sitelinks.forEach((link, index) => {
    if (!link.verified) errors.push(`站内链接 ${index + 1} 尚未验证`);
    if (link.linkText.length > limits.sitelinkText) {
      errors.push(`站内链接 ${index + 1} 文案超过 ${limits.sitelinkText} 个字符`);
    }
    const hasDescription = Boolean(link.description1 || link.description2);
    if (hasDescription && (!link.description1 || !link.description2)) {
      errors.push(`站内链接 ${index + 1} 的两条描述需要同时填写`);
    }
    if (link.description1.length > limits.sitelinkDescription || link.description2.length > limits.sitelinkDescription) {
      errors.push(`站内链接 ${index + 1} 说明行超过 ${limits.sitelinkDescription} 个字符`);
    }
    if (!/^https?:\/\//i.test(link.finalUrl)) {
      errors.push(`站内链接 ${index + 1} 需要有效落地页网址`);
    } else {
      const key = normalizePageKey(link.finalUrl);
      if (key && sitelinkUrlKeys.has(key)) {
        errors.push(`站内链接 ${index + 1} 的落地页与其它站内链接重复，请换成不同页面`);
      } else if (key) {
        sitelinkUrlKeys.add(key);
      }
    }
    errors.push(...policyHits(`${link.linkText} ${link.description1} ${link.description2}`, `站内链接 ${index + 1}`));
  });
  if (draft.callouts.length > limits.calloutCount.max) {
    errors.push(`宣传信息最多 ${limits.calloutCount.max} 条`);
  }
  draft.callouts.forEach((text, index) => {
    if (text.length > limits.callout) errors.push(`宣传信息 ${index + 1} 超过 ${limits.callout} 个字符`);
    errors.push(...policyHits(text, `宣传信息 ${index + 1}`));
    if (calloutHasPromoLeak(text)) {
      errors.push(`宣传信息 ${index + 1} 不要写免运费、满减、折扣等促销语，促销请放促销栏`);
    }
  });
  const snippets = draft.structuredSnippets ?? [];
  if (snippets.length && snippets.length !== limits.structuredCategories) {
    errors.push(`结构化摘要需要正好 ${limits.structuredCategories} 类`);
  }
  snippets.forEach((snippet, index) => {
    if (!normalizeStructuredSnippetHeader(snippet.header)) {
      errors.push(`结构化摘要 ${index + 1} 类别不在允许列表中`);
    }
    if (snippet.values.length < limits.structuredValuesMin) {
      errors.push(`结构化摘要 ${index + 1} 至少 ${limits.structuredValuesMin} 个值`);
    }
    snippet.values.forEach((value, valueIndex) => {
      if (!value.trim() || value.length > limits.structuredValue) {
        errors.push(`结构化摘要 ${index + 1} 第 ${valueIndex + 1} 个值需在 1 到 ${limits.structuredValue} 个字符`);
      }
    });
  });
  if (draft.promotion?.trim()) {
    errors.push(...policyHits(draft.promotion, '促销备注', { allowPromo: true }));
  }
  errors.push(...validatePromotionAsset(draft.promotionAsset, draft.merchantUrl));
  if (!/^https?:\/\//i.test(draft.merchantUrl)) errors.push('商家网址需要以 http 或 https 开头');
  if (draft.finalUrlSuffix.startsWith('?') || draft.finalUrlSuffix.startsWith('&')) {
    errors.push('网址后缀不要以 ? 或 & 开头');
  }
  if (!draft.geoTargetId) errors.push('目标国家还没有对应的地区常量');
  try {
    if (BigInt(usdToMicros(draft.dailyBudgetUsd)) <= 0n) errors.push('日预算必须大于 0');
  } catch (error) {
    errors.push(error instanceof Error ? error.message : '日预算格式不正确');
  }
  const ceiling = draft.cpcBidCeilingUsd?.trim() || '';
  if (draft.bidding === 'MANUAL_CPC') {
    if (!ceiling) {
      errors.push('手动 CPC 需要填写出价');
    } else {
      try {
        if (BigInt(usdToMicros(ceiling)) <= 0n) errors.push('最高 CPC 必须大于 0');
      } catch (error) {
        errors.push(error instanceof Error ? error.message : '最高 CPC 格式不正确');
      }
    }
  } else if (ceiling) {
    try {
      if (BigInt(usdToMicros(ceiling)) <= 0n) errors.push('最高 CPC 必须大于 0');
    } catch (error) {
      errors.push(error instanceof Error ? error.message : '最高 CPC 格式不正确');
    }
  }
  if (draft.bidding !== 'MAXIMIZE_CLICKS' && draft.bidding !== 'MANUAL_CPC') {
    errors.push('出价只支持尽可能争取更多点击次数或手动 CPC');
  }
  return errors;
}

/**
 * Google Ads / 联盟投放常见拒登与禁忌词。命中则返回中文错误。
 * allowPromo：标题/描述可写折扣与物流；宣传信息仍禁止促销语。
 */
export function policyHits(
  text: string,
  label: string,
  options: { allowPromo?: boolean } = {},
): string[] {
  const value = text.toLowerCase();
  const hits: string[] = [];
  const allowPromo = Boolean(options.allowPromo);
  if (/\$x\b|\[\s*链接\s*\]|\[link\]/i.test(text)) {
    hits.push(`${label} 不要写占位符`);
  }
  if (!allowPromo) {
    if (/\$\s*\d|\d+\s*%|¥\s*\d|€\s*\d|£\s*\d/.test(text)) {
      hits.push(`${label} 不要写具体金额、折扣数字或占位符`);
    }
    if (/免费体验|免费获取|free\s+(trial|gift|sample|download|shipping)|免运费|满减|退货|discount|coupon|% off/i.test(text)) {
      hits.push(`${label} 含促销/免费类表述，请调整`);
    }
  } else if (/免费体验|免费获取|free\s+(trial|gift|sample|download)\b/i.test(text)) {
    hits.push(`${label} 含免费体验/赠品类表述，请调整`);
  }
  if (
    /\b(shooting|gun|firearm|ballistic|tactical|combat|military|bulletproof|prescription|\brx\b|glaze|optician|wine|vodka|tequila|bourbon)\b/i.test(
      value,
    )
  ) {
    hits.push(`${label} 含 Google Ads 风险词`);
  }
  if (/免疫提升|治愈|治疗|减肥|降血糖|\bcure\b|\btreatment\b|\btreat\b|weight\s*loss|blood\s*sugar/i.test(text)) {
    hits.push(`${label} 含医疗功效承诺`);
  }
  return hits;
}

function calloutHasPromoLeak(text: string): boolean {
  return /免运费|满减|折扣|退货|free\s+shipping|discount|coupon|% off|sale\b/i.test(text);
}

/**
 * 可选促销附加信息校验。未启用则跳过。
 */
export function validatePromotionAsset(
  asset: AdPromotionAsset | null | undefined,
  merchantUrl: string,
): string[] {
  if (!asset?.enabled) return [];
  const errors: string[] = [];
  const target = asset.promotionTarget?.trim() || '';
  if (!target || target.length > 20) errors.push('促销商品/对象需在 1 到 20 个字符');
  if (asset.discountType === 'PERCENT') {
    const percent = Number(asset.percentOff);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      errors.push('促销折扣百分比需在 1 到 100');
    }
  } else if (asset.discountType === 'MONETARY') {
    try {
      if (BigInt(usdToMicros(String(asset.moneyAmountOff || '').trim())) <= 0n) {
        errors.push('促销减免金额必须大于 0');
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : '促销减免金额格式不正确');
    }
    if (!(asset.currencyCode || '').trim()) errors.push('货币折扣需要填写币种');
  } else {
    errors.push('促销类型只支持百分比或金额');
  }
  const finalUrl = (asset.finalUrl || merchantUrl || '').trim();
  if (!/^https?:\/\//i.test(finalUrl)) errors.push('促销最终到达网址需要以 http 或 https 开头');
  if (asset.ordersOverAmount?.trim()) {
    try {
      if (BigInt(usdToMicros(asset.ordersOverAmount.trim())) <= 0n) {
        errors.push('满减门槛必须大于 0');
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : '满减门槛格式不正确');
    }
  }
  return errors;
}

/**
 * 文案是否触发政策/宣传信息禁忌。生成阶段用它决定是否替换成安全备选。
 */
export function isUnsafeAdText(
  text: string,
  kind: 'headline' | 'description' | 'callout' | 'general' = 'general',
): boolean {
  const value = text.trim();
  if (!value) return true;
  const allowPromo = kind === 'headline' || kind === 'description';
  if (policyHits(value, 't', { allowPromo }).length) return true;
  if (kind === 'callout' && calloutHasPromoLeak(value)) return true;
  return false;
}

/**
 * 生成后把不合规字段替换成示例草稿里的安全文案，保证能进入人工预览，而不是整单失败。
 */
export function sanitizeDraftForReview(draft: AdDraft, fallback: AdDraft): AdDraft {
  const limits = AD_COPY_LIMITS;
  const fillLines = (
    primary: string[],
    reserve: string[],
    min: number,
    max: number,
    kind: 'headline' | 'description' | 'callout',
  ): string[] => {
    const used = new Set<string>();
    const out: string[] = [];
    const maxLen = kind === 'callout' ? limits.callout : kind === 'description' ? limits.description : limits.headline;
    for (const line of [...primary, ...reserve]) {
      if (out.length >= max) break;
      const text = line.trim();
      if (isUnsafeAdText(text, kind)) continue;
      const key = text.toLowerCase();
      if (used.has(key)) continue;
      used.add(key);
      out.push(text);
    }
    const safeFallback = kind === 'callout' ? 'Shop Online' : 'Official Site';
    let guard = 0;
    while (out.length < min && guard < min + 8) {
      guard += 1;
      const text = (reserve[out.length % Math.max(reserve.length, 1)] || safeFallback).trim() || safeFallback;
      const candidate = used.has(text.toLowerCase()) ? `${text} ${out.length + 1}` : text;
      const key = candidate.toLowerCase();
      if (used.has(key)) {
        out.push(`${safeFallback} ${out.length + 1}`.slice(0, maxLen));
        used.add(`${safeFallback} ${out.length}`.toLowerCase());
        continue;
      }
      used.add(key);
      out.push(candidate.slice(0, maxLen));
    }
    return out.slice(0, max);
  };

  const headlines = fillLines(
    draft.headlines,
    fallback.headlines,
    limits.headlineCount.min,
    limits.headlineCount.max,
    'headline',
  ).map((text) => text.slice(0, limits.headline));
  const descriptions = fillLines(
    draft.descriptions,
    fallback.descriptions,
    limits.descriptionCount.min,
    limits.descriptionCount.max,
    'description',
  ).map((text) => text.slice(0, limits.description));
  const callouts = fillLines(
    draft.callouts,
    fallback.callouts,
    Math.min(limits.calloutCount.prefer, fallback.callouts.length || limits.calloutCount.prefer),
    limits.calloutCount.max,
    'callout',
  ).map((text) => text.slice(0, limits.callout));

  const sitelinks = assignUniqueSitelinkUrls(
    (draft.sitelinks.length ? draft.sitelinks : fallback.sitelinks).map((link) => {
      const linkText = isUnsafeAdText(link.linkText, 'general')
        ? (fallback.sitelinks[0]?.linkText || 'Shop now')
        : link.linkText;
      const description1 = isUnsafeAdText(link.description1, 'general') ? '' : link.description1;
      const description2 = isUnsafeAdText(link.description2, 'general') ? '' : link.description2;
      const bothOrNeither = description1 && description2
        ? { description1, description2 }
        : { description1: '', description2: '' };
      return {
        ...link,
        linkText: linkText.slice(0, limits.sitelinkText),
        ...bothOrNeither,
        description1: bothOrNeither.description1.slice(0, limits.sitelinkDescription),
        description2: bothOrNeither.description2.slice(0, limits.sitelinkDescription),
      };
    }),
    draft.merchantUrl || fallback.merchantUrl,
  );

  const structuredSnippets = (draft.structuredSnippets?.length
    ? draft.structuredSnippets
    : fallback.structuredSnippets
  )
    .map((row) => ({
      header: normalizeStructuredSnippetHeader(row.header) || row.header,
      values: row.values
        .map((value) => value.trim())
        .filter((value) => value && !isUnsafeAdText(value, 'general'))
        .slice(0, 10),
    }))
    .filter((row) => normalizeStructuredSnippetHeader(row.header) && row.values.length >= limits.structuredValuesMin)
    .slice(0, limits.structuredCategories);
  const snippets = structuredSnippets.length === limits.structuredCategories
    ? structuredSnippets
    : fallback.structuredSnippets;

  const promotion = draft.promotion?.trim() && !isUnsafeAdText(draft.promotion, 'general')
    ? draft.promotion.trim().slice(0, 120)
    : '';
  const promotionAsset = draft.promotionAsset?.enabled
    ? draft.promotionAsset
    : (fallback.promotionAsset ?? null);

  return {
    ...fallback,
    ...draft,
    headlines,
    descriptions,
    keywords: draft.keywords.length ? draft.keywords : fallback.keywords,
    negativeKeywords: draft.negativeKeywords.length ? draft.negativeKeywords : fallback.negativeKeywords,
    callouts,
    sitelinks: (sitelinks.length ? sitelinks : fallback.sitelinks).slice(0, limits.sitelinkCount.max),
    structuredSnippets: snippets,
    promotion,
    promotionAsset,
    translations: draft.translations ?? fallback.translations,
    merchantUrl: draft.merchantUrl || fallback.merchantUrl,
    geoTargetId: draft.geoTargetId || fallback.geoTargetId,
    languageCode: draft.languageCode || fallback.languageCode,
    bidding: draft.bidding || fallback.bidding,
    dailyBudgetUsd: draft.dailyBudgetUsd || fallback.dailyBudgetUsd,
    cpcBidCeilingUsd: draft.cpcBidCeilingUsd ?? fallback.cpcBidCeilingUsd ?? '',
  };
}

export interface SampleArticle {
  title: string;
  /** 开篇段落，放在第一张图和第一个小标题之前。 */
  intro: string[];
  sections: Array<{ heading: string; paragraphs: string[] }>;
}

/**
 * 发文向导用的示例正文。抓站和模型接上之前使用，不冒充商家原文。
 */
export function buildSampleArticle(input: {
  merchantName: string;
  merchantUrl: string;
  trackUrl: string;
  languageCode: string;
}): SampleArticle {
  const name = input.merchantName.trim() || 'Merchant';
  if (input.languageCode.toLowerCase().startsWith('zh')) {
    return {
      title: `${name}：下单前先看这几件事`,
      intro: [`这是给 [[affiliate:${name}]] 准备的示例文案，不是从商家页面抓下来的。`],
      sections: [
        {
          heading: '两个网址不要混',
          paragraphs: [
            `广告最终到达网址仍是商家网址。正文里的关键词如 [[affiliate:${name} 官网]] 才会换成跟踪链接。`,
          ],
        },
        {
          heading: '发布之后',
          paragraphs: [`文章会先保存在这里。需要下单时再点正文里的 [[affiliate:${name}]]。`],
        },
      ],
    };
  }
  return {
    title: `A closer look at ${name}`,
    intro: [
      `This is sample copy for [[affiliate:${name}]]. It is not crawled from the merchant site.${input.languageCode.toLowerCase().startsWith('en') ? '' : ' The sample stays in English until a model is connected.'}`,
    ],
    sections: [
      {
        heading: 'Keep the URLs apart',
        paragraphs: [
          `The ad final URL stays the merchant site. In-article keywords such as [[affiliate:${name} store]] use the track URL.`,
        ],
      },
      {
        heading: 'After you publish',
        paragraphs: [
          `The article is saved here first. When you are ready, open [[affiliate:${name}]] from the body links.`,
        ],
      },
    ],
  };
}

/** 正文配图张数。一般 3 到 5 张，商家页不够时有几张用几张。 */
const ARTICLE_BODY_IMAGE_MAX = 5;

/**
 * 封面优先用商家页 https 图。正文取 3 到 5 张，插在各小节前，多出来的放文末。
 * 内容站卡片封面只认 https；本地 data:image 只可进正文且最多 1 张。
 */
export function pickArticleImages(imageUrls: string[] = []): { cover: string; body: string[] } {
  const unique = imageUrls
    .map((url) => url.trim())
    .filter((url, index, all) => acceptedArticleImage(url) && all.indexOf(url) === index);
  const remote = unique.filter((url) => /^https?:\/\//i.test(url));
  const uploaded = unique.filter((url) => url.startsWith('data:image/'));
  // 上传的 base64 太大，只留一张兜底；有远程图时正文只用远程图。
  const bodyPool = remote.length ? remote : uploaded.slice(0, 1);
  const body = bodyPool.slice(0, ARTICLE_BODY_IMAGE_MAX);
  // 封面必须是 https，否则内容站列表会丢掉 image，卡片空白
  const cover = remote[0] || '';
  return { cover, body };
}

/**
 * 从正文 HTML 里取出第一张 https 图，给内容站当卡片封面。
 */
export function firstHttpsImageFromHtml(html: string): string {
  const match = html.match(/<img\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["']/i);
  return match?.[1] ?? '';
}

/**
 * 段落里的 [[affiliate:关键词]] 换成跟踪链接。真实 http 链接会被丢掉，只保留锚点文案。
 */
export function renderAffiliateText(text: string, trackUrl: string): string {
  const cleaned = text.replace(/https?:\/\/\S+/gi, '').trim();
  const pattern = /\[\[affiliate:([^\]]+)\]\]/gi;
  let html = '';
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(cleaned)) !== null) {
    html += escapeHtml(cleaned.slice(last, match.index));
    const label = match[1].replace(/\s+/g, ' ').trim().slice(0, 80);
    if (label) {
      html += `<a href="${escapeHtml(trackUrl)}" class="link--affiliate" target="_blank" rel="noopener sponsored">${escapeHtml(label)}</a>`;
    }
    last = match.index + match[0].length;
  }
  html += escapeHtml(cleaned.slice(last));
  return html;
}

/**
 * 模型没标关键词时，至少把商家名嵌进开篇和收尾。
 */
export function ensureAffiliateMarkers(article: SampleArticle, merchantName: string): SampleArticle {
  const brand = merchantName.trim() || 'this store';
  const marker = `[[affiliate:${brand}]]`;
  const countMarkers = (text: string) => (text.match(/\[\[affiliate:[^\]]+\]\]/gi) || []).length;
  let total = [...article.intro, ...article.sections.flatMap((section) => section.paragraphs)].reduce(
    (sum, text) => sum + countMarkers(text),
    0,
  );
  if (total >= 3) return article;

  const inject = (text: string) => {
    if (countMarkers(text) > 0) return text;
    const index = text.toLowerCase().indexOf(brand.toLowerCase());
    if (index >= 0) {
      return `${text.slice(0, index)}${marker}${text.slice(index + brand.length)}`;
    }
    return `${text} ${marker}`.trim();
  };

  const intro = article.intro.length ? article.intro.map((text, index) => (index === 0 ? inject(text) : text)) : [marker];
  const sections = article.sections.map((section, index) => {
    if (index !== article.sections.length - 1) return section;
    const paragraphs = section.paragraphs.length
      ? section.paragraphs.map((text, paragraphIndex) => (
          paragraphIndex === section.paragraphs.length - 1 ? inject(text) : text
        ))
      : [`Learn more at ${marker}.`];
    return { ...section, paragraphs };
  });
  return { ...article, intro, sections };
}

/**
 * 把文章收成博客正文。配图插在段落之间，关键词锚点指向跟踪链接。
 */
export function sampleArticleHtml(
  article: SampleArticle,
  merchantName: string,
  trackUrl: string,
  imageUrls: string[] = [],
): string {
  const prepared = ensureAffiliateMarkers(article, merchantName);
  const { body: figures } = pickArticleImages(imageUrls);
  const intro = (prepared.intro?.length ? prepared.intro : [])
    .map((text) => `<p>${renderAffiliateText(text, trackUrl)}</p>`)
    .join('');
  const sections = prepared.sections ?? [];
  const blocks: string[] = [];
  if (intro) blocks.push(intro);
  sections.forEach((section, index) => {
    if (section.heading) blocks.push(`<h2>${escapeHtml(section.heading)}</h2>`);
    if (figures[index]) {
      blocks.push(
        `<figure><img src="${escapeHtml(figures[index])}" alt="${escapeHtml(section.heading || merchantName)}" loading="lazy"></figure>`,
      );
    }
    (section.paragraphs ?? []).forEach((text) => {
      if (text.trim()) blocks.push(`<p>${renderAffiliateText(text.trim(), trackUrl)}</p>`);
    });
  });
  return blocks.join('');
}

/**
 * 文章配图只接受商家页面上的网址，或员工上传后压出来的图片。
 */
export function acceptedArticleImage(url: string): boolean {
  if (/^https?:\/\//i.test(url)) return url.length <= 2048;
  return /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(url) && url.length <= 1_500_000;
}

/**
 * 转义正文里的 HTML，避免商家名称把标签带进来。
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 拼商家站内路径，保留原协议和主机。
 */
export function joinMerchantPath(merchantUrl: string, path: string): string {
  try {
    const base = new URL(merchantUrl);
    const next = new URL(path.startsWith('/') ? path : `/${path}`, `${base.protocol}//${base.host}`);
    next.hash = '';
    return next.toString();
  } catch {
    return merchantUrl;
  }
}

/**
 * 比较两个网址是否同一页面（忽略尾斜杠、www、hash）。
 */
export function normalizePageKey(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${host}${path.toLowerCase()}`;
  } catch {
    return '';
  }
}

export function sameMerchantPage(left: string, right: string): boolean {
  const a = normalizePageKey(left);
  const b = normalizePageKey(right);
  return Boolean(a && b && a === b);
}

/**
 * 给站内链接分配互不相同的同站落地页：优先模型给的 URL，其次按文案匹配爬到的内链，再轮询剩余内链，最后按文案造路径。
 */
export function assignUniqueSitelinkUrls(
  sitelinks: AdSitelink[],
  merchantUrl: string,
  pageLinks: Array<{ url: string; label?: string }> = [],
): AdSitelink[] {
  const homeKey = normalizePageKey(merchantUrl);
  const used = new Set<string>();
  const pool = pageLinks
    .map((item) => ({
      url: sameHostUrl(item.url, merchantUrl),
      label: (item.label ?? '').trim().toLowerCase(),
    }))
    .filter((item): item is { url: string; label: string } => Boolean(item.url))
    .filter((item) => normalizePageKey(item.url) !== homeKey);

  return sitelinks.map((link) => {
    const fromModel = sameHostUrl(link.finalUrl, merchantUrl);
    let chosen = '';
    if (fromModel) {
      const key = normalizePageKey(fromModel);
      if (key && key !== homeKey && !used.has(key)) chosen = fromModel;
    }
    if (!chosen) {
      const needle = link.linkText.trim().toLowerCase();
      const matched = pool.find((item) => {
        const key = normalizePageKey(item.url);
        if (!key || used.has(key)) return false;
        if (!needle) return false;
        return item.label.includes(needle) || needle.includes(item.label) || slugifyLabel(item.label) === slugifyLabel(needle);
      });
      if (matched) chosen = matched.url;
    }
    if (!chosen) {
      const next = pool.find((item) => {
        const key = normalizePageKey(item.url);
        return key && !used.has(key);
      });
      if (next) chosen = next.url;
    }
    if (!chosen) {
      chosen = inventSitelinkUrl(merchantUrl, link.linkText, used);
    }
    const key = normalizePageKey(chosen) || chosen;
    used.add(key);
    return {
      ...link,
      finalUrl: chosen,
      verified: Boolean(chosen && /^https?:\/\//i.test(chosen)),
    };
  });
}

function sameHostUrl(candidate: string, merchantUrl: string): string {
  const raw = (candidate || '').trim();
  if (!raw) return '';
  try {
    const base = new URL(merchantUrl);
    const absolute = new URL(raw, `${base.protocol}//${base.host}`);
    if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') return '';
    const baseHost = base.hostname.toLowerCase().replace(/^www\./, '');
    const host = absolute.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== baseHost) return '';
    absolute.hash = '';
    return absolute.toString();
  } catch {
    return '';
  }
}

function inventSitelinkUrl(merchantUrl: string, linkText: string, used: Set<string>): string {
  const baseSlug = slugifyLabel(linkText) || 'page';
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
    const url = joinMerchantPath(merchantUrl, `/${slug}`);
    const key = normalizePageKey(url);
    if (key && !used.has(key) && key !== normalizePageKey(merchantUrl)) return url;
  }
  return joinMerchantPath(merchantUrl, `/${baseSlug}-${Date.now().toString(36)}`);
}

function slugifyLabel(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/**
 * 判断子账户能否承接新系列。币种跟日预算的美元一致；时区只记录，不作为门槛。
 */
export function isCustomerEligible(customer: {
  googleStatus: string;
  availability: string;
  currencyCode: string;
  timeZone: string;
  verificationStatus?: string;
}): boolean {
  const verification = customer.verificationStatus ?? 'UNKNOWN';
  const verificationBlocked = verification === 'PENDING_USER_ACTION' || verification === 'FAILURE';
  return (
    customer.availability === 'available' &&
    customer.googleStatus === 'ENABLED' &&
    !verificationBlocked &&
    customer.currencyCode === 'USD'
  );
}
