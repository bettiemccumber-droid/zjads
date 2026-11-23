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
  /** 生成默认 8 条；人工可加到 max。 */
  calloutCount: { min: 0, max: 20, prefer: 8 },
  /** 生成默认 6 条；提交允许 0～8（全删也可发）。 */
  sitelinkCount: { min: 0, max: 8, prefer: 6 },
  /** 生成默认 2 类；提交不强制条数。 */
  structuredCategories: 2,
  structuredValuesMin: 3,
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
  keywords?: string[];
  /** 与 structuredSnippets 对齐：每条摘要 values 的中文，逗号分隔。 */
  structuredSnippets?: string[];
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
  /** 搜索广告图片素材 URL（可选；有则建议含接近正方形）。 */
  imageUrls?: string[];
  /** 商家商标 LOGO URL（可选；接近正方形）。 */
  logoUrls?: string[];
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

/** 样板站内链接文案：优先带品牌，超长则用短备选。 */
function fitBrandSitelink_(preferred: string, shortFallback: string, maxLen: number = AD_COPY_LIMITS.sitelinkText): string {
  const text = preferred.trim();
  if (text && text.length <= maxLen) return text;
  return shortFallback.slice(0, maxLen);
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
      sitelinks: ['立即选购', '新品上市', '热销榜', '系列合集', '优惠专区', '开始购物'],
      keywords: [`${brand} 相关词`],
      structuredSnippets: ['类型一, 类型二, 类型三, 类型四', '风格一, 风格二, 风格三, 风格四'],
    },
    keywords: [{ text: brand.toLowerCase().slice(0, 80), matchType: 'PHRASE' }],
    imageUrls: [],
    logoUrls: [],
    negativeKeywords: ['careers', 'jobs', 'login', 'wiki', 'free', 'pdf', 'manual'].map((text) => ({
      text,
      matchType: 'BROAD' as const,
    })),
    sitelinks: ensureCompleteSitelinks(
      [
        {
          linkText: fitBrandSitelink_(`Visit ${brand}`, 'Brand site'),
          description1: fitBrandSitelink_(`Explore ${brand}`, 'Browse the store', AD_COPY_LIMITS.sitelinkDescription),
          description2: fitBrandSitelink_('See what we offer', 'Start exploring', AD_COPY_LIMITS.sitelinkDescription),
          finalUrl: input.merchantUrl,
          verified: false,
        },
        {
          linkText: fitBrandSitelink_(`Shop ${brand}`, 'Shop catalog'),
          description1: fitBrandSitelink_('Browse products', 'Find your pick', AD_COPY_LIMITS.sitelinkDescription),
          description2: fitBrandSitelink_('Ready to order', 'Add to bag', AD_COPY_LIMITS.sitelinkDescription),
          finalUrl: '',
          verified: false,
        },
        {
          linkText: fitBrandSitelink_(`${brand} new`, 'Just arrived'),
          description1: fitBrandSitelink_('Fresh drops in', 'New this week', AD_COPY_LIMITS.sitelinkDescription),
          description2: fitBrandSitelink_('See latest picks', 'Check what is new', AD_COPY_LIMITS.sitelinkDescription),
          finalUrl: '',
          verified: false,
        },
        {
          linkText: fitBrandSitelink_(`${brand} bestsellers`, 'Top picks'),
          description1: fitBrandSitelink_('Customer favorites', 'Most loved items', AD_COPY_LIMITS.sitelinkDescription),
          description2: fitBrandSitelink_('Shop popular now', 'See top rated', AD_COPY_LIMITS.sitelinkDescription),
          finalUrl: '',
          verified: false,
        },
        {
          linkText: fitBrandSitelink_(`${brand} ranges`, 'Shop by type'),
          description1: fitBrandSitelink_('Browse categories', 'Find your match', AD_COPY_LIMITS.sitelinkDescription),
          description2: fitBrandSitelink_('Filter by style', 'Explore the range', AD_COPY_LIMITS.sitelinkDescription),
          finalUrl: '',
          verified: false,
        },
        {
          linkText: fitBrandSitelink_(`${brand} offers`, 'Deals today'),
          description1: fitBrandSitelink_('Seasonal savings', 'Value picks now', AD_COPY_LIMITS.sitelinkDescription),
          description2: fitBrandSitelink_('Shop the deals', 'Save while stock lasts', AD_COPY_LIMITS.sitelinkDescription),
          finalUrl: '',
          verified: false,
        },
      ],
      input.merchantUrl,
      [],
      [
        { url: joinMerchantPath(input.merchantUrl, '/shop'), label: 'Shop catalog' },
        { url: joinMerchantPath(input.merchantUrl, '/new-arrivals'), label: 'Just arrived' },
        { url: joinMerchantPath(input.merchantUrl, '/best-sellers'), label: 'Top picks' },
        { url: joinMerchantPath(input.merchantUrl, '/collections'), label: 'Shop by type' },
        { url: joinMerchantPath(input.merchantUrl, '/sale'), label: 'Deals today' },
        { url: joinMerchantPath(input.merchantUrl, '/order'), label: 'Ready to order' },
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
  if (draft.sitelinks.length > limits.sitelinkCount.max) {
    errors.push(`站内链接最多 ${limits.sitelinkCount.max} 条（默认生成 ${limits.sitelinkCount.prefer} 条，也可全部删除后发布）`);
  }
  const sitelinkUrlKeys = new Set<string>();
  draft.sitelinks.forEach((link, index) => {
    if (!link.linkText.trim()) errors.push(`站内链接 ${index + 1} 需要填写文案`);
    if (!link.verified) {
      errors.push(`站内链接 ${index + 1} 尚未验证，请点「验证」或等自动验证通过`);
    }
    if (link.linkText.length > limits.sitelinkText) {
      errors.push(`站内链接 ${index + 1} 文案超过 ${limits.sitelinkText} 个字符`);
    }
    if (!link.description1.trim() || !link.description2.trim()) {
      errors.push(`站内链接 ${index + 1} 的两条描述都要填写`);
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
    errors.push(...policyHits(`${link.linkText} ${link.description1} ${link.description2}`, `站内链接 ${index + 1}`, { allowPromo: true }));
  });
  // 至少一条官网：登记 merchantUrl 同页，或同站根路径 /
  if (
    draft.merchantUrl
    && /^https?:\/\//i.test(draft.merchantUrl)
    && draft.sitelinks.length > 0
    && !draft.sitelinks.some((link) => isMerchantHomepageUrl(link.finalUrl, draft.merchantUrl))
  ) {
    errors.push('站内链接至少需要一条指向商家官网（登记网址或同站首页）');
  }
  // 宣传信息最多 8 条；条数可为 0。结构化摘要提交不卡条数。
  if (draft.callouts.length > limits.calloutCount.max) {
    errors.push(`宣传信息最多 ${limits.calloutCount.max} 条`);
  }
  draft.callouts.forEach((text, index) => {
    if (text.length > limits.callout) errors.push(`宣传信息 ${index + 1} 超过 ${limits.callout} 个字符`);
    errors.push(...policyHits(text, `宣传信息 ${index + 1}`, { allowPromo: true }));
  });
  const snippets = draft.structuredSnippets ?? [];
  snippets.forEach((snippet, index) => {
    const values = (snippet.values ?? []).map((item) => item.trim()).filter(Boolean);
    if (!values.length && !String(snippet.header ?? '').trim()) return;
    if (!normalizeStructuredSnippetHeader(snippet.header)) {
      errors.push(`结构化摘要 ${index + 1} 类别不在允许列表中`);
    }
    values.forEach((value, valueIndex) => {
      if (value.length > limits.structuredValue) {
        errors.push(`结构化摘要 ${index + 1} 第 ${valueIndex + 1} 个值超过 ${limits.structuredValue} 个字符`);
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
 * 提交 Google 前校验广告图 / 商标。二者均可选；
 * 有选图时最多 20 张；有选商标时最多 5 张。
 */
export function validateAdImages(draft: AdDraft): string[] {
  const images = (draft.imageUrls ?? []).map((url) => url.trim()).filter((url) => acceptedAdImage(url));
  const logos = (draft.logoUrls ?? []).map((url) => url.trim()).filter((url) => acceptedAdImage(url));
  const errors: string[] = [];
  if (images.length > 20) errors.push('广告图片最多 20 张');
  if (logos.length > 5) errors.push('商家商标最多 5 张');
  return errors;
}

/** Google 拒登风险：连续大写字母最多 4 个。 */
export const MAX_CONSECUTIVE_UPPERCASE = 4;

/**
 * 把超过上限的连续大写压成「首字母大写 + 其余小写」，保留语义。
 * 例：SHOPNOW → Shopnow；BEST DEALS → BEST Deals。
 */
export function softenExcessiveUppercase(
  text: string,
  maxRun = MAX_CONSECUTIVE_UPPERCASE,
): string {
  const pattern = new RegExp(`[A-Z]{${maxRun + 1},}`, 'g');
  return text.replace(pattern, (run) => `${run.charAt(0)}${run.slice(1).toLowerCase()}`);
}

/**
 * Google Ads / 联盟投放常见拒登与禁忌词。命中则返回中文错误。
 * allowPromo：允许折扣、满减、免运费等促销语（标题/描述/宣传信息/站内链接）。
 */
export function policyHits(
  text: string,
  label: string,
  options: { allowPromo?: boolean } = {},
): string[] {
  const value = text.toLowerCase();
  const hits: string[] = [];
  const allowPromo = Boolean(options.allowPromo);
  if (new RegExp(`[A-Z]{${MAX_CONSECUTIVE_UPPERCASE + 1},}`).test(text)) {
    hits.push(`${label} 连续大写不能超过 ${MAX_CONSECUTIVE_UPPERCASE} 个字母`);
  }
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
  kind: 'headline' | 'description' | 'callout' | 'sitelink' | 'general' = 'general',
): boolean {
  const value = text.trim();
  if (!value) return true;
  // 标题 / 描述 / 宣传信息 / 站内链接均可写折扣类促销语；general 仍偏严，只给其它字段兜底
  const allowPromo =
    kind === 'headline'
    || kind === 'description'
    || kind === 'callout'
    || kind === 'sitelink';
  return policyHits(value, 't', { allowPromo }).length > 0;
}

/** 站内链接字段：有安全原文就保留，空或硬违规才用兜底。 */
function keepSitelinkField_(
  primary: string,
  reserve: string | undefined,
  hardFallback: string,
  maxLen: number,
): string {
  const text = primary.trim();
  if (text && !isUnsafeAdText(text, 'sitelink')) return text.slice(0, maxLen);
  const backup = (reserve ?? '').trim();
  if (backup && !isUnsafeAdText(backup, 'sitelink')) return backup.slice(0, maxLen);
  return hardFallback.slice(0, maxLen);
}

/**
 * 生成后清洗不合规字段。
 * padFromFallback=true（默认）：用示例草稿补齐，方便未开 AI 时进预览。
 * padFromFallback=false：只用草稿自身行，不用 Explore/新品 等模板凑数。
 */
export function sanitizeDraftForReview(
  draft: AdDraft,
  fallback: AdDraft,
  options?: { padFromFallback?: boolean },
): AdDraft {
  const padFromFallback = options?.padFromFallback !== false;
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
    const pool = padFromFallback ? [...primary, ...reserve] : [...primary];
    for (const line of pool) {
      if (out.length >= max) break;
      const text = softenExcessiveUppercase(line.trim());
      if (isUnsafeAdText(text, kind)) continue;
      const key = text.toLowerCase();
      if (used.has(key)) continue;
      used.add(key);
      out.push(text);
    }
    if (!padFromFallback) return out.slice(0, max);
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
  const calloutMin = padFromFallback
    ? Math.min(limits.calloutCount.prefer, fallback.callouts.length || limits.calloutCount.prefer)
    : 0;
  const callouts = fillLines(
    draft.callouts,
    fallback.callouts,
    calloutMin,
    limits.calloutCount.prefer,
    'callout',
  ).map((text) => text.slice(0, limits.callout));

  const merchantHome = draft.merchantUrl || fallback.merchantUrl;
  const sitelinkSource = (
    padFromFallback && draft.sitelinks.length < limits.sitelinkCount.prefer
      ? [...draft.sitelinks, ...fallback.sitelinks]
      : draft.sitelinks
  ).slice(0, limits.sitelinkCount.prefer);
  const sitelinks = ensureCompleteSitelinks(
    assignUniqueSitelinkUrls(
      sitelinkSource.map((link, index) => {
        const fallbackLink = padFromFallback
          ? (fallback.sitelinks[index] || fallback.sitelinks[0])
          : undefined;
        const linkText = keepSitelinkField_(
          softenExcessiveUppercase(link.linkText),
          fallbackLink?.linkText,
          'Shop now',
          limits.sitelinkText,
        );
        const description1 = keepSitelinkField_(
          softenExcessiveUppercase(link.description1),
          fallbackLink?.description1,
          'Browse online',
          limits.sitelinkDescription,
        );
        const description2 = keepSitelinkField_(
          softenExcessiveUppercase(link.description2),
          fallbackLink?.description2,
          'See more details',
          limits.sitelinkDescription,
        );
        return {
          ...link,
          linkText,
          description1,
          description2,
        };
      }),
      merchantHome,
    ),
    merchantHome,
    padFromFallback ? fallback.sitelinks : [],
  );

  const structuredSnippets = (draft.structuredSnippets?.length
    ? draft.structuredSnippets
    : (padFromFallback ? fallback.structuredSnippets : [])
  )
    .map((row) => ({
      header: normalizeStructuredSnippetHeader(row.header) || row.header,
      values: row.values
        .map((value) => softenExcessiveUppercase(value.trim()))
        .filter((value) => value && !isUnsafeAdText(value, 'general'))
        .slice(0, 10),
    }))
    .filter((row) => normalizeStructuredSnippetHeader(row.header) && row.values.length >= limits.structuredValuesMin)
    .slice(0, limits.structuredCategories);
  const snippets = structuredSnippets.length === limits.structuredCategories
    ? structuredSnippets
    : (padFromFallback ? fallback.structuredSnippets : structuredSnippets);

  const promotion = draft.promotion?.trim() && !isUnsafeAdText(draft.promotion, 'general')
    ? draft.promotion.trim().slice(0, 120)
    : '';
  const promotionAsset = draft.promotionAsset?.enabled
    ? draft.promotionAsset
    : (padFromFallback ? (fallback.promotionAsset ?? null) : null);

  return {
    ...fallback,
    ...draft,
    headlines,
    descriptions,
    keywords: draft.keywords.length ? draft.keywords : (padFromFallback ? fallback.keywords : draft.keywords),
    negativeKeywords: draft.negativeKeywords.length
      ? draft.negativeKeywords
      : (padFromFallback ? fallback.negativeKeywords : draft.negativeKeywords),
    callouts,
    sitelinks: sitelinks.slice(0, limits.sitelinkCount.max),
    structuredSnippets: snippets,
    promotion,
    promotionAsset,
    translations: draft.translations ?? (padFromFallback ? fallback.translations : undefined),
    merchantUrl: draft.merchantUrl || fallback.merchantUrl,
    geoTargetId: draft.geoTargetId || fallback.geoTargetId,
    languageCode: draft.languageCode || fallback.languageCode,
    bidding: draft.bidding || fallback.bidding,
    dailyBudgetUsd: draft.dailyBudgetUsd || fallback.dailyBudgetUsd,
    cpcBidCeilingUsd: (draft.bidding || fallback.bidding) === 'MANUAL_CPC'
      ? (draft.cpcBidCeilingUsd || fallback.cpcBidCeilingUsd || '')
      : '',
    imageUrls: (draft.imageUrls?.length ? draft.imageUrls : fallback.imageUrls ?? [])
      .map((url) => url.trim())
      .filter((url, index, all) => acceptedAdImage(url) && all.indexOf(url) === index)
      .slice(0, 20),
    logoUrls: (draft.logoUrls?.length ? draft.logoUrls : fallback.logoUrls ?? [])
      .map((url) => url.trim())
      .filter((url, index, all) => acceptedAdImage(url) && all.indexOf(url) === index)
      .slice(0, 5),
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

/** 正文联盟关键词锚文字数 / 正文字数，目标约 8%–10%。 */
export const AFFILIATE_KEYWORD_DENSITY = { min: 0.08, max: 0.1 };

/**
 * 去掉已有标记，便于重新从成稿抽词挂链。
 */
export function stripAffiliateMarkers(text: string): string {
  return text.replace(/\[\[affiliate:([^\]]+)\]\]/gi, '$1');
}

/**
 * 统计锚文字数占比（不含标记符号本身）。
 */
export function affiliateKeywordDensity(article: SampleArticle): { ratio: number; anchorChars: number; plainChars: number; keywords: string[] } {
  const chunks = articlePlainChunks(article);
  const keywords: string[] = [];
  let anchorChars = 0;
  let plainChars = 0;
  const marker = /\[\[affiliate:([^\]]+)\]\]/gi;
  for (const chunk of chunks) {
    let last = 0;
    let match: RegExpExecArray | null;
    const re = new RegExp(marker.source, 'gi');
    while ((match = re.exec(chunk)) !== null) {
      plainChars += stripAffiliateMarkers(chunk.slice(last, match.index)).length;
      const label = match[1].replace(/\s+/g, ' ').trim();
      if (label) {
        keywords.push(label);
        anchorChars += label.length;
        plainChars += label.length;
      }
      last = match.index + match[0].length;
    }
    plainChars += stripAffiliateMarkers(chunk.slice(last)).length;
  }
  return {
    ratio: plainChars > 0 ? anchorChars / plainChars : 0,
    anchorChars,
    plainChars,
    keywords,
  };
}

/**
 * 先写自然文，再从成稿里找品牌/相关短语挂联盟链，密度尽量落在 8%–10%。
 */
export function annotateAffiliateKeywords(article: SampleArticle, merchantName: string): SampleArticle {
  const brand = merchantName.trim() || 'this store';
  const cleared: SampleArticle = {
    title: stripAffiliateMarkers(article.title || ''),
    intro: (article.intro ?? []).map(stripAffiliateMarkers),
    sections: (article.sections ?? []).map((section) => ({
      heading: stripAffiliateMarkers(section.heading || ''),
      paragraphs: (section.paragraphs ?? []).map(stripAffiliateMarkers),
    })),
  };
  const candidates = affiliatePhraseCandidates(cleared, brand);
  let working = cleared;
  let density = affiliateKeywordDensity(working);
  for (const phrase of candidates) {
    density = affiliateKeywordDensity(working);
    if (density.ratio >= AFFILIATE_KEYWORD_DENSITY.min) break;
    working = wrapPhraseOnce(working, phrase, AFFILIATE_KEYWORD_DENSITY.max);
  }
  density = affiliateKeywordDensity(working);
  if (density.ratio < AFFILIATE_KEYWORD_DENSITY.min) {
    working = wrapAllBrandMentions(working, brand, AFFILIATE_KEYWORD_DENSITY.max);
  }
  density = affiliateKeywordDensity(working);
  if (density.keywords.length === 0) {
    const marker = `[[affiliate:${brand}]]`;
    const intro = working.intro.length
      ? working.intro.map((text, index) => (index === 0 ? `${text} ${marker}`.trim() : text))
      : [marker];
    working = { ...working, intro };
  }
  return working;
}

/** @deprecated 使用 annotateAffiliateKeywords */
export function ensureAffiliateMarkers(article: SampleArticle, merchantName: string): SampleArticle {
  return annotateAffiliateKeywords(article, merchantName);
}

function articlePlainChunks(article: SampleArticle): string[] {
  return [
    ...(article.intro ?? []),
    ...(article.sections ?? []).flatMap((section) => section.paragraphs ?? []),
  ];
}

function affiliatePhraseCandidates(article: SampleArticle, brand: string): string[] {
  const plain = articlePlainChunks(article).join(' ');
  const lower = plain.toLowerCase();
  const brandLower = brand.toLowerCase();
  const found = new Set<string>();
  const add = (value: string) => {
    const text = value.replace(/\s+/g, ' ').trim();
    if (text.length >= 2 && text.length <= 48) found.add(text);
  };
  add(brand);
  const first = brand.split(/\s+/)[0];
  if (first && first.length >= 3) add(first);
  const patterns = [
    new RegExp(`${escapeRegExp(brand)}(?:\\s+[A-Za-z\\u00C0-\\u024F]{2,16}){0,3}`, 'gi'),
    new RegExp(`(?:try|shop|visit|buy|check out|official)\\s+${escapeRegExp(brand)}`, 'gi'),
  ];
  for (const pattern of patterns) {
    for (const match of plain.matchAll(pattern)) add(match[0]);
  }
  if (lower.includes(brandLower)) add(brand);
  return [...found].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

function wrapPhraseOnce(article: SampleArticle, phrase: string, maxRatio: number): SampleArticle {
  const needle = phrase.trim();
  if (!needle) return article;
  let done = false;
  const wrapText = (text: string): string => {
    if (done) return text;
    const density = affiliateKeywordDensity({
      title: article.title,
      intro: article.intro,
      sections: article.sections,
    });
    // 用当前全文粗估：若已接近上限则不再包
    if (density.ratio >= maxRatio) {
      done = true;
      return text;
    }
    const index = findUnmarkedIndex(text, needle);
    if (index < 0) return text;
    const nextAnchor = needle.length;
    const nextRatio = (density.anchorChars + nextAnchor) / Math.max(density.plainChars, 1);
    if (nextRatio > maxRatio + 0.005 && density.keywords.length > 0) {
      done = true;
      return text;
    }
    done = true;
    return `${text.slice(0, index)}[[affiliate:${needle}]]${text.slice(index + needle.length)}`;
  };
  return mapArticleParagraphs(article, wrapText);
}

function wrapAllBrandMentions(article: SampleArticle, brand: string, maxRatio: number): SampleArticle {
  let working = article;
  for (let i = 0; i < 24; i += 1) {
    const before = affiliateKeywordDensity(working);
    if (before.ratio >= AFFILIATE_KEYWORD_DENSITY.min) break;
    const next = wrapPhraseOnce(working, brand, maxRatio);
    if (next === working || affiliateKeywordDensity(next).keywords.length === before.keywords.length) break;
    working = next;
  }
  return working;
}

function findUnmarkedIndex(text: string, phrase: string): number {
  const lower = text.toLowerCase();
  const needle = phrase.toLowerCase();
  let from = 0;
  while (from < text.length) {
    const index = lower.indexOf(needle, from);
    if (index < 0) return -1;
    if (!isInsideAffiliateMarker(text, index)) return index;
    from = index + needle.length;
  }
  return -1;
}

function isInsideAffiliateMarker(text: string, index: number): boolean {
  const open = text.lastIndexOf('[[affiliate:', index);
  if (open < 0) return false;
  const close = text.indexOf(']]', open);
  return close >= index;
}

function mapArticleParagraphs(article: SampleArticle, mapText: (text: string) => string): SampleArticle {
  return {
    ...article,
    intro: (article.intro ?? []).map(mapText),
    sections: (article.sections ?? []).map((section) => ({
      ...section,
      paragraphs: (section.paragraphs ?? []).map(mapText),
    })),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  const prepared = annotateAffiliateKeywords(article, merchantName);
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

/** 广告图允许 https 或裁切后的 jpeg/png data URL。 */
export function acceptedAdImage(url: string): boolean {
  if (/^https?:\/\//i.test(url)) return url.length <= 2048;
  return /^data:image\/(?:jpeg|png);base64,[a-z0-9+/=\s]+$/i.test(url) && url.length <= 1_500_000;
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
 * 是否算「官网」落地页：与商家登记网址同页，或同站根路径。
 * 不把商家深链强行改成 / 再比对，避免误判。
 */
export function isMerchantHomepageUrl(candidate: string, merchantUrl: string): boolean {
  if (sameMerchantPage(candidate, merchantUrl)) return true;
  try {
    const page = new URL(candidate);
    const home = new URL(merchantUrl);
    const pageHost = page.hostname.toLowerCase().replace(/^www\./, '');
    const homeHost = home.hostname.toLowerCase().replace(/^www\./, '');
    if (pageHost !== homeHost) return false;
    const path = page.pathname.replace(/\/+$/, '') || '/';
    return path === '/';
  } catch {
    return false;
  }
}

/**
 * 站内链接落地页偏好：购买/商品页优先，联系我们/关于页靠后。
 */
export function sitelinkPageScore(url: string, label = ''): number {
  const text = `${url} ${label}`.toLowerCase();
  if (/(contact|about|careers?|login|account|support|help|faq|privacy|terms|blog|press|investor|warranty|returns?)/i.test(text)) {
    return -3;
  }
  if (/(shop|store|collection|product|catalog|cart|checkout|buy|order|sale|deal|best.?sell|new.?arriv|category|comprar|tienda| mercadoria)/i.test(text)) {
    return 6;
  }
  if (/(bag|gear|outdoor|apparel|accessories|hat|drink|sku|item)/i.test(text)) {
    return 3;
  }
  return 1;
}

/**
 * 给站内链接分配互不相同的同站落地页。
 * 第 1 条固定为商家登记网址（官网）；其余用同站内页，不强行改成站点根路径。
 */
export function assignUniqueSitelinkUrls(
  sitelinks: AdSitelink[],
  merchantUrl: string,
  pageLinks: Array<{ url: string; label?: string }> = [],
): AdSitelink[] {
  const homeUrl = (() => {
    try {
      const url = new URL(merchantUrl);
      url.hash = '';
      url.search = '';
      url.pathname = url.pathname.replace(/\/+$/, '') || '/';
      return url.toString();
    } catch {
      return merchantUrl;
    }
  })();
  const homeKey = normalizePageKey(homeUrl);
  const used = new Set<string>();
  const pool = pageLinks
    .map((item) => ({
      url: sameHostUrl(item.url, merchantUrl),
      label: (item.label ?? '').trim().toLowerCase(),
    }))
    .filter((item): item is { url: string; label: string } => Boolean(item.url))
    .filter((item) => normalizePageKey(item.url) !== homeKey)
    .sort((a, b) => sitelinkPageScore(b.url, b.label) - sitelinkPageScore(a.url, a.label));

  const unused = () => pool.filter((item) => {
    const key = normalizePageKey(item.url);
    return key && !used.has(key);
  });

  return sitelinks.map((link, index) => {
    // 第 1 条优先用商家网址当官网；没有可用网址则按普通内页分配
    if (index === 0 && homeUrl && /^https?:\/\//i.test(homeUrl)) {
      if (homeKey) used.add(homeKey);
      return {
        ...link,
        // 只补空，不覆盖模型已写的标题/描述
        linkText: (link.linkText.trim() || 'Visit site').slice(0, AD_COPY_LIMITS.sitelinkText),
        description1: (link.description1.trim() || 'Browse the store').slice(0, AD_COPY_LIMITS.sitelinkDescription),
        description2: (link.description2.trim() || 'See what we offer').slice(0, AD_COPY_LIMITS.sitelinkDescription),
        finalUrl: homeUrl,
        verified: false,
      };
    }

    const fromModel = sameHostUrl(link.finalUrl, merchantUrl);
    let chosen = '';
    if (fromModel) {
      const key = normalizePageKey(fromModel);
      if (key && !used.has(key)) {
        const modelScore = sitelinkPageScore(fromModel, link.linkText);
        const better = unused().find((item) => sitelinkPageScore(item.url, item.label) >= 3 && sitelinkPageScore(item.url, item.label) > modelScore);
        chosen = modelScore >= 0 || !better ? fromModel : better.url;
      }
    }
    if (!chosen) {
      const needle = link.linkText.trim().toLowerCase();
      const matched = unused().find((item) => {
        if (!needle) return false;
        return item.label.includes(needle) || needle.includes(item.label) || slugifyLabel(item.label) === slugifyLabel(needle);
      });
      if (matched) chosen = matched.url;
    }
    if (!chosen) {
      const next = unused()[0];
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
      // 生成时不自动算已验证，需人工点「标记已验证」
      verified: false,
    };
  });
}

/**
 * 保证默认 6 条站内链接且字段填满；有商家网址时第 1 条优先指向它。
 */
export function ensureCompleteSitelinks(
  sitelinks: AdSitelink[],
  merchantUrl: string,
  fallback: AdSitelink[] = [],
  pageLinks: Array<{ url: string; label?: string }> = [],
): AdSitelink[] {
  const prefer = AD_COPY_LIMITS.sitelinkCount.prefer;
  const padded = [...sitelinks];
  // 无 fallback 时不凑条数（AI 路径）；有示例草稿时才补到 prefer
  while (padded.length < prefer && fallback.length > 0) {
    const seed = fallback[padded.length] || fallback[0] || {
      linkText: 'Shop now',
      description1: 'Browse online',
      description2: 'See more details',
      finalUrl: '',
      verified: false,
    };
    padded.push({ ...seed, verified: false });
  }
  const filled = padded.slice(0, prefer).map((link, index) => {
    const seed = fallback[index] || fallback[0];
    return {
      ...link,
      linkText: (link.linkText.trim() || seed?.linkText || 'Shop now').slice(0, AD_COPY_LIMITS.sitelinkText),
      description1: (link.description1.trim() || seed?.description1 || 'Browse online').slice(0, AD_COPY_LIMITS.sitelinkDescription),
      description2: (link.description2.trim() || seed?.description2 || 'See more details').slice(0, AD_COPY_LIMITS.sitelinkDescription),
    };
  });
  return assignUniqueSitelinkUrls(filled, merchantUrl, pageLinks);
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
