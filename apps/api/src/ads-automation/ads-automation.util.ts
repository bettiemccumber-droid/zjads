/** 广告草稿。最终到达网址是商家网址，不是文章 URL。 */
export interface AdDraft {
  headlines: string[];
  descriptions: string[];
  keywords: AdKeyword[];
  negativeKeywords: AdKeyword[];
  sitelinks: AdSitelink[];
  callouts: string[];
  merchantUrl: string;
  finalUrlSuffix: string;
  bidding: 'MAXIMIZE_CLICKS' | 'MANUAL_CPC';
  dailyBudgetUsd: string;
  cpcBidCeilingUsd: string;
  languageCode: string;
  geoTargetId: string;
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

const GEO_BY_COUNTRY: Record<string, string> = {
  US: '2840',
  GB: '2826',
  DE: '2276',
  FR: '2250',
  ES: '2724',
  MX: '2484',
  VN: '2704',
  AU: '2036',
  CA: '2124',
};

const LANGUAGE_BY_CODE: Record<string, string> = {
  en: '1000',
  de: '1001',
  fr: '1002',
  es: '1003',
  vi: '1040',
  zh: '1017',
};

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
  return GEO_BY_COUNTRY[countryCode.trim().toUpperCase()] ?? '';
}

/**
 * 语言代码对应的语言常量。
 */
export function languageConstant(languageCode: string): string {
  const code = languageCode.trim().toLowerCase().slice(0, 2);
  return LANGUAGE_BY_CODE[code] ?? '';
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
 * 组装系列名：序号-平台-商家-国家-月日-商家ID。
 */
export function buildCampaignName(input: {
  sequence: number;
  platformCode: string;
  merchantName: string;
  countryCode: string;
  mid: string;
  now?: Date;
}): string {
  return [
    String(input.sequence),
    input.platformCode,
    merchantSlug(input.merchantName),
    input.countryCode.toUpperCase(),
    shanghaiMonthDay(input.now),
    input.mid,
  ].join('-');
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
    `${brand} Official`.slice(0, 30),
    `Shop ${brand}`.slice(0, 30),
    `${brand} New Arrivals`.slice(0, 30),
  ];
  const descriptions = [
    `Browse ${brand} styles and current offers.`.slice(0, 90),
    `See what is new at ${brand} today.`.slice(0, 90),
  ];
  return {
    headlines,
    descriptions,
    keywords: [{ text: brand.toLowerCase().slice(0, 80), matchType: 'PHRASE' }],
    negativeKeywords: ['careers', 'jobs', 'login', 'wiki'].map((text) => ({
      text,
      matchType: 'BROAD' as const,
    })),
    sitelinks: [
      {
        linkText: 'Shop now'.slice(0, 25),
        description1: 'Current styles'.slice(0, 35),
        description2: 'View the latest'.slice(0, 35),
        finalUrl: input.merchantUrl,
        verified: true,
      },
    ],
    callouts: [],
    merchantUrl: input.merchantUrl,
    finalUrlSuffix: '',
    bidding: input.bidding === 'MANUAL_CPC' ? 'MANUAL_CPC' : 'MAXIMIZE_CLICKS',
    dailyBudgetUsd: input.dailyBudgetUsd?.trim() || '3.00',
    cpcBidCeilingUsd: input.cpcBidCeilingUsd?.trim() || '0.50',
    languageCode: input.languageCode || 'en',
    geoTargetId: geoTargetForCountry(input.countryCode),
  };
}

/**
 * 确认发布前的字数和结构校验。返回中文错误列表，空数组表示可以通过。
 */
export function validateDraft(draft: AdDraft): string[] {
  const errors: string[] = [];
  if (draft.headlines.length < 3 || draft.headlines.length > 15) {
    errors.push('标题需要 3 到 15 条');
  }
  draft.headlines.forEach((text, index) => {
    if (text.trim().length === 0 || text.length > 30) errors.push(`标题 ${index + 1} 需在 1 到 30 个字符`);
  });
  if (draft.descriptions.length < 2 || draft.descriptions.length > 4) {
    errors.push('描述需要 2 到 4 条');
  }
  draft.descriptions.forEach((text, index) => {
    if (text.trim().length === 0 || text.length > 90) errors.push(`描述 ${index + 1} 需在 1 到 90 个字符`);
  });
  if (draft.keywords.length === 0) errors.push('至少需要一个关键词');
  draft.keywords.forEach((keyword) => {
    if (!keyword.text.trim()) errors.push('关键词不能为空');
  });
  draft.sitelinks.forEach((link, index) => {
    if (!link.verified) errors.push(`站内链接 ${index + 1} 尚未验证`);
    if (link.linkText.length > 25) errors.push(`站内链接 ${index + 1} 文案超过 25 个字符`);
    const hasDescription = Boolean(link.description1 || link.description2);
    if (hasDescription && (!link.description1 || !link.description2)) {
      errors.push(`站内链接 ${index + 1} 的两条描述需要同时填写`);
    }
    if (link.description1.length > 35 || link.description2.length > 35) {
      errors.push(`站内链接 ${index + 1} 描述超过 35 个字符`);
    }
  });
  draft.callouts.forEach((text, index) => {
    if (text.length > 25) errors.push(`宣传信息 ${index + 1} 超过 25 个字符`);
  });
  if (!/^https?:\/\//i.test(draft.merchantUrl)) errors.push('商家网址需要以 http 或 https 开头');
  if (draft.finalUrlSuffix.startsWith('?') || draft.finalUrlSuffix.startsWith('&')) {
    errors.push('网址后缀不要以 ? 或 & 开头');
  }
  if (!draft.geoTargetId) errors.push('目标国家还没有对应的地区常量');
  try {
    if (BigInt(usdToMicros(draft.dailyBudgetUsd)) <= 0n) errors.push('日预算必须大于 0');
    if (BigInt(usdToMicros(draft.cpcBidCeilingUsd)) <= 0n) errors.push('最高 CPC 必须大于 0');
  } catch (error) {
    errors.push(error instanceof Error ? error.message : '金额格式不正确');
  }
  if (draft.bidding !== 'MAXIMIZE_CLICKS' && draft.bidding !== 'MANUAL_CPC') {
    errors.push('出价只支持尽可能争取更多点击次数或手动 CPC');
  }
  return errors;
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

/**
 * 封面优先用商家页 https 图。正文最多插几张，避免全堆在开头。
 */
export function pickArticleImages(imageUrls: string[] = []): { cover: string; body: string[] } {
  const unique = imageUrls
    .map((url) => url.trim())
    .filter((url, index, all) => acceptedArticleImage(url) && all.indexOf(url) === index);
  const remote = unique.filter((url) => /^https?:\/\//i.test(url));
  const uploaded = unique.filter((url) => url.startsWith('data:image/'));
  // 上传的 base64 太大，只留一张兜底；有远程图时正文只用远程图。
  const bodyPool = remote.length ? remote : uploaded.slice(0, 1);
  const body = bodyPool.slice(0, 4);
  const cover = remote[0] || uploaded[0] || '';
  return { cover, body };
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
    if (figures[index]) {
      blocks.push(
        `<figure><img src="${escapeHtml(figures[index])}" alt="${escapeHtml(section.heading || merchantName)}" loading="lazy"></figure>`,
      );
    }
    if (section.heading) blocks.push(`<h2>${escapeHtml(section.heading)}</h2>`);
    (section.paragraphs ?? []).forEach((text) => {
      if (text.trim()) blocks.push(`<p>${renderAffiliateText(text.trim(), trackUrl)}</p>`);
    });
  });
  if (figures.length > sections.length) {
    figures.slice(sections.length).forEach((url) => {
      blocks.push(`<figure><img src="${escapeHtml(url)}" alt="" loading="lazy"></figure>`);
    });
  }
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
 * 判断子账户能否承接新系列。
 */
export function isCustomerEligible(customer: {
  googleStatus: string;
  availability: string;
  currencyCode: string;
  timeZone: string;
}): boolean {
  return (
    customer.availability === 'available' &&
    customer.googleStatus === 'ENABLED' &&
    customer.currencyCode === 'USD' &&
    customer.timeZone === 'Asia/Shanghai'
  );
}
