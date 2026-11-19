import {
  AD_COPY_LIMITS,
  AdDraft,
  AdPromotionAsset,
  AdStructuredSnippet,
  STRUCTURED_SNIPPET_HEADERS,
  assignUniqueSitelinkUrls,
  buildSampleDraft,
  normalizeStructuredSnippetHeader,
  SampleArticle,
  sanitizeDraftForReview,
  softenExcessiveUppercase,
  stripKeywordDecorations,
  validateDraft,
} from './ads-automation.util';
import { completeModelGoChat } from './modelgo.client';

/**
 * 告诉模型这条广告要写给哪个国家的读者。墨西哥和西班牙的西语分开写。
 */
export function audienceLanguage(countryCode: string, languageCode: string): string {
  const country = countryCode.trim().toUpperCase();
  const language = languageCode.trim().toLowerCase().replace(/_/g, '-');
  if (country === 'MX' || language === 'es-mx') return 'Spanish as used in Mexico';
  if (country === 'ES' || language === 'es-es') return 'Spanish as used in Spain';
  if (country === 'BR' || language === 'pt-br') return 'Portuguese as used in Brazil';
  if (country === 'PT' || language === 'pt-pt') return 'Portuguese as used in Portugal';
  if (country === 'VN' || language.startsWith('vi')) return 'Vietnamese';
  if (country === 'PL' || language.startsWith('pl')) return 'Polish';
  if (language.startsWith('es')) return 'Spanish';
  if (language === 'zh-tw' || language === 'zh-hk') return 'Traditional Chinese';
  if (language.startsWith('zh')) return 'Simplified Chinese';
  if (language.startsWith('fr')) return 'French';
  if (language.startsWith('de')) return 'German';
  if (language.startsWith('it')) return 'Italian';
  if (language.startsWith('pt')) return 'Portuguese';
  if (language.startsWith('nl')) return 'Dutch';
  if (language.startsWith('sv')) return 'Swedish';
  if (language.startsWith('no') || language.startsWith('nb')) return 'Norwegian';
  if (language.startsWith('da')) return 'Danish';
  if (language.startsWith('fi')) return 'Finnish';
  if (language.startsWith('cs')) return 'Czech';
  if (language.startsWith('sk')) return 'Slovak';
  if (language.startsWith('hu')) return 'Hungarian';
  if (language.startsWith('ro')) return 'Romanian';
  if (language.startsWith('uk')) return 'Ukrainian';
  if (language.startsWith('ru')) return 'Russian';
  if (language.startsWith('tr')) return 'Turkish';
  if (language.startsWith('el')) return 'Greek';
  if (language.startsWith('he') || language.startsWith('iw')) return 'Hebrew';
  if (language.startsWith('ar')) return 'Arabic';
  if (language.startsWith('ja')) return 'Japanese';
  if (language.startsWith('ko')) return 'Korean';
  if (language.startsWith('th')) return 'Thai';
  if (language.startsWith('id')) return 'Indonesian';
  if (language.startsWith('ms')) return 'Malay';
  if (language.startsWith('tl') || language.startsWith('fil')) return 'Filipino';
  if (language.startsWith('hi')) return 'Hindi';
  if (country === 'US') return 'American English';
  if (country === 'GB' || country === 'UK') return 'British English';
  if (country === 'AU') return 'Australian English';
  if (language.startsWith('en') || !language) return 'English';
  return `the language coded ${language} for readers in ${country || 'the target country'}`;
}

/**
 * 按投放国家生成广告草稿。预算、出价和最终网址仍用本地设置。
 */
export async function writeAdCopy(input: {
  merchantName: string;
  merchantUrl: string;
  countryCode: string;
  languageCode: string;
  bidding?: 'MAXIMIZE_CLICKS' | 'MANUAL_CPC';
  dailyBudgetUsd?: string;
  cpcBidCeilingUsd?: string;
  personaPrompt?: string;
  pageLinks?: Array<{ url: string; label?: string }>;
}): Promise<AdDraft> {
  const pageLinks = input.pageLinks ?? [];
  const base = buildSampleDraft(input);
  const language = audienceLanguage(input.countryCode, input.languageCode);
  const shape = adCopyJsonShape(input.merchantUrl, pageLinks);
  const seasonHint = nearbySeasonCopyHint(new Date(), input.countryCode);
  const raw = await askJson(
    `Write Google search ads for ${input.merchantName}. Audience language: ${language}. Country: ${input.countryCode}. Use real brand tone; strong click and purchase intent.
${seasonHint}`,
    shape,
    2400,
    input.personaPrompt,
  );
  let draft = sanitizeDraftForReview(applyAdCopy(base, raw, pageLinks), base);
  let errors = validateDraft(draft);
  if (!errors.length) return draft;

  const retryRaw = await askJson(
    `Write Google search ads for ${input.merchantName}. Audience language: ${language}. Country: ${input.countryCode}.`,
    `Previous draft failed validation: ${errors.slice(0, 3).join('; ')}.
${shape}
Fix every limit and policy issue. Prefer shorter lines. Never put prices, %, discounts, or placeholders in callouts.`,
    2200,
    input.personaPrompt,
  );
  draft = sanitizeDraftForReview(applyAdCopy(base, retryRaw, pageLinks), base);
  // 仍有问题也不抛错：进入人工预览，不合规字段已尽量换成安全备选。
  return draft;
}

function adCopyJsonShape(merchantUrl: string, pageLinks: Array<{ url: string; label?: string }> = []): string {
  const headers = STRUCTURED_SNIPPET_HEADERS.join(', ');
  const knownPages = pageLinks
    .slice(0, 20)
    .map((item) => `- ${item.url}${item.label ? ` (${item.label})` : ''}`)
    .join('\n');
  return `Return JSON only:
{"headlines": string[${AD_COPY_LIMITS.headlineCount.prefer}], "descriptions": string[${AD_COPY_LIMITS.descriptionCount.prefer}], "keywords": string[1 to 8], "negativeKeywords": string[4 to 12], "sitelinks": [{"linkText": string, "description1": string, "description2": string, "finalUrl": string}], "callouts": string[${AD_COPY_LIMITS.calloutCount.prefer}], "structuredSnippets": [{"header": string, "values": string[${AD_COPY_LIMITS.structuredValuesMin}+]}], "promotionAsset": {"enabled": boolean, "promotionTarget": string, "discountType": "PERCENT"|"MONETARY", "percentOff": number, "moneyAmountOff": string, "currencyCode": string, "languageCode": string, "finalUrl": string, "promotionCode": string, "ordersOverAmount": string, "occasion": string, "startDate": string, "endDate": string} | null, "translations": {"headlines": string[${AD_COPY_LIMITS.headlineCount.prefer}], "descriptions": string[${AD_COPY_LIMITS.descriptionCount.prefer}], "callouts": string[${AD_COPY_LIMITS.calloutCount.prefer}], "sitelinks": string[${AD_COPY_LIMITS.sitelinkCount.prefer}], "keywords": string[1 to 8], "structuredSnippets": string[2], "promotion": string}}

Hard character limits (spaces/punctuation count):
- headline <= ${AD_COPY_LIMITS.headline}
- description <= ${AD_COPY_LIMITS.description}
- callout <= ${AD_COPY_LIMITS.callout}
- sitelink linkText <= ${AD_COPY_LIMITS.sitelinkText}
- each sitelink description <= ${AD_COPY_LIMITS.sitelinkDescription}, both filled
- each structured snippet value <= ${AD_COPY_LIMITS.structuredValue}
- promotionTarget <= 20

Content rules:
- Exactly ${AD_COPY_LIMITS.headlineCount.prefer} unique headlines, ${AD_COPY_LIMITS.descriptionCount.prefer} descriptions, ${AD_COPY_LIMITS.calloutCount.prefer} callouts, exactly ${AD_COPY_LIMITS.sitelinkCount.prefer} sitelinks.
- Strong purchase verbs; low repetition; language must match the audience.
- Include several headlines/descriptions about discounts, logistics, and nearby real holidays/shopping seasons when relevant (Black Friday, Cyber Monday, Christmas, New Year, Singles Day, Valentine, Mother's Day, back-to-school, etc.). Prefer real merchant offers; if unknown, use soft seasonal or logistics lines without inventing fake coupon codes or fake % off.
- Forbidden: free trial/gift wording, placeholders like $X or [link], Google risk words (gun/firearm/tactical/combat/military/prescription/Rx/wine/vodka/etc), medical cure claims.
- Never use more than 4 consecutive uppercase Latin letters (SHOPNOW is bad; Shop Now / FREE is ok). Avoid ALL-CAPS words longer than 4 letters.
- Callouts must NOT mention free shipping, discounts, coupons, returns, or sale numbers. Put real promos in promotionAsset (optional) instead.
- promotionAsset: optional. Set enabled=true only when a concrete discount is known or strongly typical for this merchant; otherwise enabled=false or null. Use percentOff as whole percent (20 means 20%). moneyAmountOff is a decimal string. languageCode should match the ad language. finalUrl defaults to merchant URL if omitted. occasion may be empty or a real holiday occasion when applicable.
- translations: required Simplified Chinese glosses for human review only (not sent to Google). Must include: headlines, descriptions, callouts, sitelinks, keywords (aligned to keywords[]), structuredSnippets (2 strings; each is comma-separated Chinese glosses for that snippet's values), and promotion if any.
- structuredSnippets: pick exactly 2 headers from [${headers}] that best fit this merchant (e.g. travel: Types + Destinations; multi-brand: Types + Brands; own-brand: Types + Styles, avoid Brands). Use these exact English strings. Each needs at least ${AD_COPY_LIMITS.structuredValuesMin} short values.
- Always include useful negativeKeywords (careers, login, free pdf, etc.).
- Ad final URL (RSA) stays ${merchantUrl}. No URLs inside headline/description/callout text.
- Each sitelink MUST include its own finalUrl. finalUrl values must be distinct https pages on the same merchant host, not all ${merchantUrl}. Prefer purchase pages: shop, collections, products, best sellers, new arrivals, sale/deals, cart/checkout. Avoid Contact Us / About / Support / Careers / Login unless no purchase pages exist. Absolute paths or full URLs are both ok.
${knownPages ? `Known on-site pages to prefer for sitelink finalUrl (purchase pages first):\n${knownPages}` : ''}`;
}

/**
 * 生成时提示临近节日/购物季，避免编造虚假促销码。
 */
export function nearbySeasonCopyHint(now = new Date(), countryCode = 'US'): string {
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();
  const hints: string[] = [`Today (UTC) is ${now.toISOString().slice(0, 10)}.`];
  if ((month === 10 && day >= 20) || (month === 11 && day <= 5)) {
    hints.push('Near Halloween / early holiday shopping; soft seasonal lines OK if natural.');
  }
  if (month === 11 && day >= 15 && day <= 30) {
    hints.push('Near Black Friday / Thanksgiving / Cyber week — real shopping-season headlines welcome; do not invent fake coupon codes.');
  }
  if (month === 12) {
    hints.push('December holiday / Christmas / year-end — seasonal gift or holiday shopping lines OK when natural.');
  }
  if (month === 1 && day <= 15) {
    hints.push('Near New Year — new year / fresh start shopping lines OK when natural.');
  }
  if (month === 2 && day <= 20) {
    hints.push('Near Valentine\'s Day — soft seasonal lines OK when natural for this merchant.');
  }
  if (month === 5 && day <= 15) {
    hints.push('Near Mother\'s Day (many markets) — soft seasonal lines OK when natural.');
  }
  if (month === 8 || (month === 9 && day <= 10)) {
    hints.push('Back-to-school season — seasonal lines OK when natural for this merchant.');
  }
  if (countryCode === 'CN' || countryCode === 'HK' || countryCode === 'TW' || countryCode === 'SG') {
    if (month === 11 && day <= 15) hints.push('Near Singles Day (11.11) shopping season for some Asia markets.');
  }
  hints.push('Only mention discounts/promos that are plausible; never invent fake % off or coupon codes.');
  return hints.join(' ');
}

/**
 * 按投放国家生成文章。关键词用 [[affiliate:文案]] 标记，发布时换成跟踪链接。
 */
export async function writeArticle(input: {
  merchantName: string;
  merchantUrl: string;
  countryCode: string;
  languageCode: string;
  personaPrompt?: string;
}): Promise<SampleArticle> {
  const language = audienceLanguage(input.countryCode, input.languageCode);
  const brand = input.merchantName.trim() || 'the brand';
  const raw = await askJson(
    `Write a first-person product review blog post about ${brand} for readers in ${input.countryCode}. Language: ${language}.
Match a medium-long personal blog style: specific, practical, a little conversational. Soft sell without stuffing links.`,
    `Return JSON only: {"title": string, "intro": string[2], "sections": [{"heading": string, "paragraphs": string[2 to 3]}]}.
Requirements:
- Title under 90 characters, natural for search readers in that country.
- intro: exactly 2 opening paragraphs before the first heading.
- sections: 4 or 5 sections. Each heading is concrete. Each section has 2 or 3 paragraphs of 2 to 4 sentences.
- Mention "${brand}" naturally many times in varied wording (brand alone, with product type, "try ${brand}", "shop ${brand}", etc.). Aim for roughly 8% to 10% of the body text to be brand/product phrases that could later become links.
- Do NOT insert affiliate markers, markdown links, or any [[...]] syntax. Plain prose only.
- Do not invent prices, star ratings, medical claims, or limited-time discounts.
- Never write real http/https URLs.
- Do not write generic filler like "in today's world" or "whether you are a beginner or expert".`,
    2800,
    input.personaPrompt,
  );
  const article = applyArticle(raw);
  if (!article.title || article.intro.length < 1 || article.sections.length < 3) {
    throw new Error('模型返回的文章不完整');
  }
  return article;
}

/**
 * 取出模型返回的 JSON。允许包在 markdown 代码块里。
 */
export function parseModelJson(text: string): Record<string, unknown> {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型没有返回 JSON');
  const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('模型没有返回 JSON 对象');
  return parsed as Record<string, unknown>;
}

/**
 * 把模型文案套进草稿。超长截断到规范上限，条数不够时用示例草稿补齐。
 * 站内链接落地页会去重并优先落到爬到的同站内链。
 */
export function applyAdCopy(
  base: AdDraft,
  raw: Record<string, unknown>,
  pageLinks: Array<{ url: string; label?: string }> = [],
): AdDraft {
  const limits = AD_COPY_LIMITS;
  const headlines = uniqueNonEmpty([
    ...textList(raw.headlines).map((text) => fitAdText(text, limits.headline)),
    ...base.headlines,
  ]).slice(0, limits.headlineCount.max);
  const descriptions = uniqueNonEmpty([
    ...textList(raw.descriptions).map((text) => fitAdText(text, limits.description)),
    ...base.descriptions,
  ]).slice(0, limits.descriptionCount.max);
  const keywords = textList(raw.keywords)
    .map((text) => stripKeywordDecorations(text).slice(0, 80))
    .filter(Boolean)
    .slice(0, 8)
    .map((text) => ({ text, matchType: 'PHRASE' as const }));
  const negativeKeywords = textList(raw.negativeKeywords)
    .map((text) => stripKeywordDecorations(text).slice(0, 80))
    .filter(Boolean)
    .slice(0, 12)
    .map((text) => ({ text, matchType: 'BROAD' as const }));
  const callouts = uniqueNonEmpty([
    ...textList(raw.callouts).map((text) => fitAdText(text, limits.callout)),
    ...base.callouts,
  ]).slice(0, limits.calloutCount.max);
  const sitelinks = assignUniqueSitelinkUrls(
    [
      ...sitelinkList(raw.sitelinks),
      ...base.sitelinks,
    ].slice(0, limits.sitelinkCount.prefer),
    base.merchantUrl,
    pageLinks,
  );
  const structuredSnippets = structuredSnippetList(raw.structuredSnippets, base.structuredSnippets);
  const promotion = typeof raw.promotion === 'string' ? raw.promotion.trim().slice(0, 120) : base.promotion;
  const promotionAsset = parsePromotionAsset(raw.promotionAsset, base);
  const nextKeywords = keywords.length ? keywords : base.keywords;
  const nextCallouts = callouts.length ? callouts : base.callouts;
  const nextSnippets = structuredSnippets.length ? structuredSnippets : base.structuredSnippets;
  const nextSitelinks = sitelinks.length
    ? sitelinks
    : assignUniqueSitelinkUrls(
      base.sitelinks.slice(0, limits.sitelinkCount.prefer),
      base.merchantUrl,
      pageLinks,
    );
  const translations = parseTranslations(raw.translations, {
    headlines,
    descriptions,
    callouts: nextCallouts,
    sitelinks: nextSitelinks,
    keywords: nextKeywords,
    structuredSnippets: nextSnippets,
    promotion,
  });

  if (headlines.length < limits.headlineCount.min) throw new Error('模型标题不足，补齐后仍不够');
  if (descriptions.length < limits.descriptionCount.min) throw new Error('模型描述不足，补齐后仍不够');

  return {
    ...base,
    headlines,
    descriptions,
    keywords: nextKeywords,
    negativeKeywords: negativeKeywords.length ? negativeKeywords : base.negativeKeywords,
    callouts: nextCallouts,
    sitelinks: nextSitelinks,
    structuredSnippets: nextSnippets,
    promotion,
    promotionAsset,
    translations,
    imageUrls: base.imageUrls ?? [],
  };
}

function parseTranslations(
  value: unknown,
  sizes: {
    headlines: string[];
    descriptions: string[];
    callouts: string[];
    sitelinks: AdDraft['sitelinks'];
    keywords: AdDraft['keywords'];
    structuredSnippets: AdDraft['structuredSnippets'];
    promotion: string;
  },
): AdDraft['translations'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const list = (key: string, max: number) => textList(row[key]).map((text) => text.slice(0, 120)).slice(0, max);
  return {
    headlines: list('headlines', sizes.headlines.length),
    descriptions: list('descriptions', sizes.descriptions.length),
    callouts: list('callouts', sizes.callouts.length),
    sitelinks: list('sitelinks', sizes.sitelinks.length),
    keywords: list('keywords', sizes.keywords.length),
    structuredSnippets: list('structuredSnippets', sizes.structuredSnippets.length),
    promotion: typeof row.promotion === 'string' ? row.promotion.trim().slice(0, 120) : undefined,
  };
}

function parsePromotionAsset(value: unknown, base: AdDraft): AdPromotionAsset | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return base.promotionAsset ?? null;
  const row = value as Record<string, unknown>;
  const enabled = row.enabled === true;
  if (!enabled) return null;
  const discountType = row.discountType === 'MONETARY' ? 'MONETARY' : 'PERCENT';
  const percentOff = Number(row.percentOff);
  const moneyAmountOff = typeof row.moneyAmountOff === 'string' ? row.moneyAmountOff.trim() : '';
  const promotionTarget = typeof row.promotionTarget === 'string' ? row.promotionTarget.trim().slice(0, 20) : '';
  if (!promotionTarget) return null;
  if (discountType === 'PERCENT' && !(Number.isFinite(percentOff) && percentOff > 0 && percentOff <= 100)) {
    return null;
  }
  if (discountType === 'MONETARY' && !moneyAmountOff) return null;
  return {
    enabled: true,
    promotionTarget,
    discountType,
    percentOff: discountType === 'PERCENT' ? percentOff : undefined,
    moneyAmountOff: discountType === 'MONETARY' ? moneyAmountOff : undefined,
    currencyCode: typeof row.currencyCode === 'string' ? row.currencyCode.trim().toUpperCase().slice(0, 3) : 'USD',
    languageCode: typeof row.languageCode === 'string' ? row.languageCode.trim() : base.languageCode,
    occasion: typeof row.occasion === 'string' ? row.occasion.trim() : '',
    finalUrl: typeof row.finalUrl === 'string' && row.finalUrl.trim() ? row.finalUrl.trim() : base.merchantUrl,
    promotionCode: typeof row.promotionCode === 'string' ? row.promotionCode.trim().slice(0, 20) : '',
    ordersOverAmount: typeof row.ordersOverAmount === 'string' ? row.ordersOverAmount.trim() : '',
    startDate: typeof row.startDate === 'string' ? row.startDate.trim() : '',
    endDate: typeof row.endDate === 'string' ? row.endDate.trim() : '',
  };
}

/**
 * 截到 Google Ads 字数上限；尽量在空格处截断，避免半截单词。
 */
export function fitAdText(value: string, max: number): string {
  const text = softenExcessiveUppercase(value.trim().replace(/\s+/g, ' '));
  if (text.length <= max) return text;
  const sliced = text.slice(0, max);
  const space = sliced.lastIndexOf(' ');
  if (space >= Math.floor(max * 0.6)) return sliced.slice(0, space).trim();
  return sliced.trim();
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const value of values) {
    const text = value.trim();
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    rows.push(text);
  }
  return rows;
}

/**
 * 把模型文章收成开篇和分节。兼容旧的 text 字段。
 */
export function applyArticle(raw: Record<string, unknown>): SampleArticle {
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 180) : '';
  const intro = textList(raw.intro)
    .map((text) => text.slice(0, 900))
    .filter(Boolean)
    .slice(0, 3);
  const sections = Array.isArray(raw.sections)
    ? raw.sections
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const heading = typeof (item as { heading?: unknown }).heading === 'string' ? (item as { heading: string }).heading.trim() : '';
          const fromParagraphs = textList((item as { paragraphs?: unknown }).paragraphs).map((text) => text.slice(0, 900));
          const fromText = typeof (item as { text?: unknown }).text === 'string'
            ? String((item as { text: string }).text)
                .split(/\n{2,}/)
                .map((text) => text.trim())
                .filter(Boolean)
            : [];
          const paragraphs = (fromParagraphs.length ? fromParagraphs : fromText).slice(0, 4);
          if (!heading || !paragraphs.length) return null;
          return { heading: heading.slice(0, 120), paragraphs };
        })
        .filter((item): item is { heading: string; paragraphs: string[] } => item != null)
        .slice(0, 6)
    : [];
  return { title, intro, sections };
}

/**
 * 请求一段 JSON，并在格式不对时再问一次。
 */
async function askJson(
  task: string,
  shape: string,
  maxTokens = 1400,
  personaPrompt = '',
): Promise<Record<string, unknown>> {
  const system = [
    'You write affiliate Google Ads RSA copy and personal product-review blog posts. Reply with JSON only.',
    'Follow Google Ads policies. Prefer real discount and logistics headlines when plausible. Never invent fake coupon codes, medical cures, weapons, alcohol SKUs, or placeholder tokens like $X. Never use more than 4 consecutive uppercase Latin letters.',
    personaPrompt.trim(),
  ]
    .filter(Boolean)
    .join('\n\n');
  const first = await completeModelGoChat(
    [
      { role: 'system', content: system },
      { role: 'user', content: `${task}\n${shape}` },
    ],
    { maxTokens },
  );
  try {
    return parseModelJson(first);
  } catch {
    const second = await completeModelGoChat(
      [
        { role: 'system', content: system },
        { role: 'user', content: `${task}\n${shape}\nThe previous reply was not valid JSON. Return one JSON object and nothing else.` },
      ],
      { maxTokens },
    );
    return parseModelJson(second);
  }
}

/**
 * 读出字符串数组。
 */
function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
}

/**
 * 读出合格的站内链接。两条描述必须同时有或同时没有；finalUrl 可后置分配。
 */
function sitelinkList(value: unknown): AdDraft['sitelinks'] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const linkText = typeof (item as { linkText?: unknown }).linkText === 'string'
        ? fitAdText((item as { linkText: string }).linkText, AD_COPY_LIMITS.sitelinkText)
        : '';
      const description1 = typeof (item as { description1?: unknown }).description1 === 'string'
        ? fitAdText((item as { description1: string }).description1, AD_COPY_LIMITS.sitelinkDescription)
        : '';
      const description2 = typeof (item as { description2?: unknown }).description2 === 'string'
        ? fitAdText((item as { description2: string }).description2, AD_COPY_LIMITS.sitelinkDescription)
        : '';
      const finalUrl = typeof (item as { finalUrl?: unknown }).finalUrl === 'string'
        ? (item as { finalUrl: string }).finalUrl.trim()
        : '';
      if (!linkText) return null;
      if ((description1 && !description2) || (!description1 && description2)) return null;
      return { linkText, description1, description2, finalUrl, verified: false };
    })
    .filter((item): item is AdDraft['sitelinks'][number] => item != null)
    .slice(0, AD_COPY_LIMITS.sitelinkCount.max);
}

function structuredSnippetList(value: unknown, fallback: AdStructuredSnippet[]): AdStructuredSnippet[] {
  const fromModel = Array.isArray(value)
    ? value
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const headerRaw = typeof (item as { header?: unknown }).header === 'string'
            ? (item as { header: string }).header
            : '';
          const header = normalizeStructuredSnippetHeader(headerRaw);
          const values = uniqueNonEmpty(
            textList((item as { values?: unknown }).values).map((text) => fitAdText(text, AD_COPY_LIMITS.structuredValue)),
          );
          if (!header || values.length < AD_COPY_LIMITS.structuredValuesMin) return null;
          return { header, values: values.slice(0, 10) };
        })
        .filter((item): item is AdStructuredSnippet => item != null)
    : [];
  const merged = [...fromModel, ...fallback.map((row) => ({
    ...row,
    header: normalizeStructuredSnippetHeader(row.header) || row.header,
  }))];
  const seen = new Set<string>();
  const rows: AdStructuredSnippet[] = [];
  for (const row of merged) {
    const header = normalizeStructuredSnippetHeader(row.header);
    if (!header || seen.has(header)) continue;
    seen.add(header);
    rows.push({ ...row, header });
    if (rows.length >= AD_COPY_LIMITS.structuredCategories) break;
  }
  return rows;
}
