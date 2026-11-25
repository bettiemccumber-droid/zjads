import {
  AD_COPY_LIMITS,
  AdDraft,
  AdPromotionAsset,
  AdSitelink,
  AdStructuredSnippet,
  STRUCTURED_SNIPPET_HEADERS,
  adTextLen,
  buildSampleDraft,
  ensureCompleteSitelinks,
  isUnsafeAdText,
  normalizeStructuredSnippetHeader,
  SampleArticle,
  reviewDraftGate,
  isLengthValidationMessage,
  sanitizeDraftForReview,
  softenExcessiveUppercase,
  stripKeywordDecorations,
  validateDraft,
} from './ads-automation.util';
import { completeModelGoChat } from './modelgo.client';

export type AdCopyFieldKind = 'headline' | 'description' | 'callout' | 'sitelink';

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

/** 三路并行：标题、描述、扩展（站内链接+宣传+结构化） */
type AdCopyChunkId = 'headlines' | 'descriptions' | 'extensions';

const CHUNK_LABEL: Record<AdCopyChunkId, string> = {
  headlines: '标题',
  descriptions: '描述',
  extensions: '站内链接/宣传/结构化',
};

/**
 * 按投放国家并行分块生成广告草稿（3 路，降低上游并发）。
 * 预算、出价和最终网址仍用本地设置。AI 路径不用示例模板凑数；某块失败只重试该块一次。
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
  /** 商家页面/导航里出现的节日线索；无证据时不得点名节日（≠断定未参与）。 */
  pageTextHints?: string[];
  merchantSeasonEvidence?: string[];
  /** 站点抓取结果：failed 只表示爬不到，不能当成商家没做活动。 */
  siteScan?: 'ok' | 'failed' | 'unknown';
  onProgress?: (message: string, progress?: number) => void | Promise<void>;
}): Promise<AdDraft> {
  const pageLinks = input.pageLinks ?? [];
  const shell = buildSampleDraft(input);
  const language = audienceLanguage(input.countryCode, input.languageCode);
  const brand = input.merchantName.trim() || 'the brand';
  const merchantEvidence = resolveMerchantSeasonEvidence_(input);
  const seasonHint = nearbySeasonCopyHint(new Date(), input.countryCode, {
    merchantEvidence,
    siteScan: input.siteScan ?? (input.pageTextHints?.length ? 'ok' : 'unknown'),
  });
  const commonTask = `Write Google search ads for ${brand}. Audience language: ${language}. Country: ${input.countryCode}. Use real brand tone; strong click and purchase intent.
${seasonHint}`;

  const done = new Set<AdCopyChunkId>();
  const report = async (id: AdCopyChunkId) => {
    done.add(id);
    const pending = (Object.keys(CHUNK_LABEL) as AdCopyChunkId[])
      .filter((key) => !done.has(key))
      .map((key) => CHUNK_LABEL[key]);
    const finished = [...done].map((key) => CHUNK_LABEL[key]).join('、');
    const message = pending.length
      ? `${finished}已生成，${pending.join('/')}生成中…`
      : '文案各块已生成，正在校验…';
    const progress = 45 + Math.round((done.size / 3) * 25);
    await input.onProgress?.(message, progress);
  };

  const runChunk = async (
    id: AdCopyChunkId,
    shape: string,
    maxTokens: number,
  ): Promise<Record<string, unknown>> => {
    try {
      const raw = await askJson(commonTask, shape, maxTokens, input.personaPrompt);
      await report(id);
      return raw;
    } catch (firstError) {
      try {
        const raw = await askJson(
          `${commonTask}\nRetry this chunk only after a failure.`,
          shape,
          maxTokens,
          input.personaPrompt,
        );
        await report(id);
        return raw;
      } catch (secondError) {
        const detail = secondError instanceof Error ? secondError.message : String(secondError);
        const first = firstError instanceof Error ? firstError.message : String(firstError);
        throw new Error(`${CHUNK_LABEL[id]}生成失败：${detail || first}`);
      }
    }
  };

  const knownPages = pageLinks
    .slice(0, 20)
    .map((item) => `- ${item.url}${item.label ? ` (${item.label})` : ''}`)
    .join('\n');
  const headers = STRUCTURED_SNIPPET_HEADERS.join(', ');

  const [headRaw, descRaw, extRaw] = await Promise.all([
    runChunk(
      'headlines',
      `Return JSON only:
{"headlines": string[${AD_COPY_LIMITS.headlineCount.prefer}], "keywords": string[1 to 8], "negativeKeywords": string[4 to 12], "translations": {"headlines": string[${AD_COPY_LIMITS.headlineCount.prefer}], "keywords": string[1 to 8]}}
Hard limits: each headline <= ${AD_COPY_LIMITS.headline}. Exactly ${AD_COPY_LIMITS.headlineCount.prefer} unique headlines. Strong purchase intent; low repetition; match audience language. Seasonal/holiday names ONLY when the season hint marks CONFIRMED for THIS merchant. translations.headlines are Simplified Chinese glosses for review. Always include useful negativeKeywords (careers, login, free pdf, etc.).`,
      900,
    ),
    runChunk(
      'descriptions',
      `Return JSON only:
{"descriptions": string[${AD_COPY_LIMITS.descriptionCount.prefer}], "translations": {"descriptions": string[${AD_COPY_LIMITS.descriptionCount.prefer}]}}
Hard limits: each description <= ${AD_COPY_LIMITS.description}. Exactly ${AD_COPY_LIMITS.descriptionCount.prefer} unique descriptions. Match audience language; no placeholders like $X. translations are Simplified Chinese glosses.`,
      700,
    ),
    runChunk(
      'extensions',
      `Return JSON only:
{"callouts": string[${AD_COPY_LIMITS.calloutCount.prefer}], "sitelinks": [{"linkText": string, "description1": string, "description2": string, "finalUrl": string}], "structuredSnippets": [{"header": string, "values": string[${AD_COPY_LIMITS.structuredValuesMin}+]}], "promotionAsset": {"enabled": boolean, "promotionTarget": string, "discountType": "PERCENT"|"MONETARY", "percentOff": number, "moneyAmountOff": string, "currencyCode": string, "languageCode": string, "finalUrl": string, "promotionCode": string, "ordersOverAmount": string, "occasion": string, "startDate": string, "endDate": string} | null, "translations": {"callouts": string[${AD_COPY_LIMITS.calloutCount.prefer}], "sitelinks": string[${AD_COPY_LIMITS.sitelinkCount.prefer}], "structuredSnippets": string[2], "promotion": string}}
Callouts: exactly ${AD_COPY_LIMITS.calloutCount.prefer}, each <= ${AD_COPY_LIMITS.callout}, merchant-specific.
Sitelinks: exactly ${AD_COPY_LIMITS.sitelinkCount.prefer}. linkText <= ${AD_COPY_LIMITS.sitelinkText}; each description <= ${AD_COPY_LIMITS.sitelinkDescription}; all fields required. One sitelink MUST use official site finalUrl ${input.merchantUrl} (or same-host root). Remaining finalUrls distinct https pages on same host. Avoid stock phrases (Official website, Shop now, Visit our site). Prefer purchase pages.
${knownPages ? `Known on-site pages:\n${knownPages}` : ''}
Structured snippets (critical): pick exactly 2 DIFFERENT headers from [${headers}] that best fit THIS merchant (${brand}) and site content — not a default pair.
Guidance: travel/airlines → Destinations + Types (or Service catalog); hotels → Amenities + Destinations; multi-brand shop → Brands + Types; device/electronics → Models + Types; fashion own-brand → Styles + Types; local services → Service catalog + Types; courses/education → Courses or Degree programs + Types; entertainment → Shows + Types.
Do NOT default to Types+Styles unless that truly fits. Never invent headers outside the list. Values must be concrete for this merchant (real categories/brands/models/destinations), each <= ${AD_COPY_LIMITS.structuredValue}, >= ${AD_COPY_LIMITS.structuredValuesMin} per header. Avoid generic filler like Apparel/Casual/Everyday unless the merchant actually sells those.
promotionAsset.enabled=true only with concrete discount; else false/null. Leave startDate/endDate empty.
translations.* are Simplified Chinese glosses aligned to each list.`,
      1600,
    ),
  ]);

  const mergedRaw: Record<string, unknown> = {
    headlines: headRaw.headlines,
    keywords: headRaw.keywords,
    negativeKeywords: headRaw.negativeKeywords,
    descriptions: descRaw.descriptions,
    callouts: extRaw.callouts,
    sitelinks: extRaw.sitelinks,
    structuredSnippets: extRaw.structuredSnippets,
    promotionAsset: extRaw.promotionAsset,
    translations: {
      headlines: (headRaw.translations as { headlines?: unknown } | undefined)?.headlines,
      keywords: (headRaw.translations as { keywords?: unknown } | undefined)?.keywords,
      descriptions: (descRaw.translations as { descriptions?: unknown } | undefined)?.descriptions,
      callouts: (extRaw.translations as { callouts?: unknown } | undefined)?.callouts,
      sitelinks: (extRaw.translations as { sitelinks?: unknown } | undefined)?.sitelinks,
      structuredSnippets: (extRaw.translations as { structuredSnippets?: unknown } | undefined)?.structuredSnippets,
      promotion: (extRaw.translations as { promotion?: unknown } | undefined)?.promotion,
    },
  };

  let draft = sanitizeDraftForReview(
    applyAdCopy(shell, mergedRaw, pageLinks, { padFromTemplate: false }),
    shell,
    { padFromFallback: false },
  );

  if (draft.headlines.length < AD_COPY_LIMITS.headlineCount.min) {
    const retryHead = await runChunk(
      'headlines',
      `Return JSON only: {"headlines": string[${AD_COPY_LIMITS.headlineCount.prefer}], "translations": {"headlines": string[${AD_COPY_LIMITS.headlineCount.prefer}]}}
Need at least ${AD_COPY_LIMITS.headlineCount.min} unique headlines, prefer ${AD_COPY_LIMITS.headlineCount.prefer}. Each <= ${AD_COPY_LIMITS.headline}.`,
      900,
    );
    draft = sanitizeDraftForReview(
      applyAdCopy(draft, { headlines: retryHead.headlines, translations: retryHead.translations }, pageLinks, {
        padFromTemplate: false,
      }),
      shell,
      { padFromFallback: false },
    );
  }
  if (draft.descriptions.length < AD_COPY_LIMITS.descriptionCount.min) {
    const retryDesc = await runChunk(
      'descriptions',
      `Return JSON only: {"descriptions": string[${AD_COPY_LIMITS.descriptionCount.prefer}], "translations": {"descriptions": string[${AD_COPY_LIMITS.descriptionCount.prefer}]}}
Need at least ${AD_COPY_LIMITS.descriptionCount.min} unique descriptions. Each <= ${AD_COPY_LIMITS.description}.`,
      700,
    );
    draft = sanitizeDraftForReview(
      applyAdCopy(draft, { descriptions: retryDesc.descriptions, translations: retryDesc.translations }, pageLinks, {
        padFromTemplate: false,
      }),
      shell,
      { padFromFallback: false },
    );
  }

  if (draft.headlines.length < AD_COPY_LIMITS.headlineCount.min) {
    throw new Error(`标题生成不足（${draft.headlines.length}/${AD_COPY_LIMITS.headlineCount.min}），请重试`);
  }
  if (draft.descriptions.length < AD_COPY_LIMITS.descriptionCount.min) {
    throw new Error(`描述生成不足（${draft.descriptions.length}/${AD_COPY_LIMITS.descriptionCount.min}），请重试`);
  }

  // 站内链接「尚未验证」由 generate 随后 autoVerify；超字数进审核红框，不丢草稿
  const { hardErrors } = reviewDraftGate(draft);
  if (hardErrors.length) {
    throw new Error(`文案校验未通过：${hardErrors.slice(0, 3).join('；')}`);
  }
  return draft;
}

function resolveMerchantSeasonEvidence_(input: {
  pageLinks?: Array<{ url: string; label?: string }>;
  pageTextHints?: string[];
  merchantSeasonEvidence?: string[];
}): string[] {
  if (input.merchantSeasonEvidence?.length) {
    return uniqueNonEmpty(input.merchantSeasonEvidence.map((item) => item.trim()));
  }
  const texts = [
    ...(input.pageTextHints ?? []),
    ...(input.pageLinks ?? []).map((item) => `${item.label ?? ''} ${item.url}`),
  ];
  return detectMerchantSeasonEvidence(texts);
}

function adCopyJsonShape(merchantUrl: string, pageLinks: Array<{ url: string; label?: string }> = []): string {
  const headers = STRUCTURED_SNIPPET_HEADERS.join(', ');
  const knownPages = pageLinks
    .slice(0, 20)
    .map((item) => `- ${item.url}${item.label ? ` (${item.label})` : ''}`)
    .join('\n');
  return `Return JSON only:
{"headlines": string[${AD_COPY_LIMITS.headlineCount.prefer}], "descriptions": string[${AD_COPY_LIMITS.descriptionCount.prefer}], "keywords": string[1 to 8], "negativeKeywords": string[4 to 12], "sitelinks": [{"linkText": string, "description1": string, "description2": string, "finalUrl": string}], "callouts": string[${AD_COPY_LIMITS.calloutCount.prefer}], "structuredSnippets": [{"header": string, "values": string[${AD_COPY_LIMITS.structuredValuesMin}+]}], "promotionAsset": {"enabled": boolean, "promotionTarget": string, "discountType": "PERCENT"|"MONETARY", "percentOff": number, "moneyAmountOff": string, "currencyCode": string, "languageCode": string, "finalUrl": string, "promotionCode": string, "ordersOverAmount": string, "occasion": string, "startDate": string, "endDate": string} | null, "translations": {"headlines": string[${AD_COPY_LIMITS.headlineCount.prefer}], "descriptions": string[${AD_COPY_LIMITS.descriptionCount.prefer}], "callouts": string[${AD_COPY_LIMITS.calloutCount.prefer}], "sitelinks": string[${AD_COPY_LIMITS.sitelinkCount.prefer}], "keywords": string[1 to 8], "structuredSnippets": string[2], "promotion": string}}

Hard character limits (spaces/punctuation count — count carefully before return; do NOT write long then hope for truncation):
- headline <= ${AD_COPY_LIMITS.headline} (prefer 18–28; never exceed ${AD_COPY_LIMITS.headline})
- description <= ${AD_COPY_LIMITS.description}
- callout <= ${AD_COPY_LIMITS.callout}
- sitelink linkText <= ${AD_COPY_LIMITS.sitelinkText}; every sitelink must fill linkText, description1, description2, and finalUrl
- each sitelink description <= ${AD_COPY_LIMITS.sitelinkDescription}, both filled (never leave description blank)
- Exactly one sitelink MUST use an official-site landing page as finalUrl: either ${merchantUrl} or the same-host site root (e.g. https://example.com/). Remaining sitelinks use distinct on-site pages.
- each structured snippet value <= ${AD_COPY_LIMITS.structuredValue}
- promotionTarget <= 20
- If a phrase does not fit, rewrite a shorter phrase — never rely on cutting words mid-sentence.

Content rules:
- Exactly ${AD_COPY_LIMITS.headlineCount.prefer} unique headlines, ${AD_COPY_LIMITS.descriptionCount.prefer} descriptions, ${AD_COPY_LIMITS.calloutCount.prefer} callouts, exactly ${AD_COPY_LIMITS.sitelinkCount.prefer} fully filled sitelinks.
- Strong purchase verbs; low repetition; language must match the audience.
- Sitelink copy must feel specific to THIS merchant and page — not generic templates. Vary linkText / description1 / description2 across the ${AD_COPY_LIMITS.sitelinkCount.prefer} rows; mention brand, product type, category, season, or page purpose. Avoid repeating the same stock phrases (Official website, Shop now, Visit our site, Explore online, New arrivals, Best sellers, Collections, Sale deals, Browse online, See more details). Each pair of descriptions should add a concrete reason to click.
- Seasonal / holiday naming is compliance-sensitive: ONLY name a holiday or shopping event when the task message marks it as CONFIRMED for THIS merchant. Missing crawl evidence means insufficient proof — never conclude the merchant is not running the season. When unconfirmed, do NOT name Black Friday, Christmas, Singles Day, Valentine's, or other holidays (avoid false advertising); use evergreen sale/deal/logistics/category angles. Never invent fake coupon codes or fake % off.
- Forbidden: free trial/gift wording, placeholders like $X or [link], Google risk words (gun/firearm/tactical/combat/military/prescription/Rx/wine/vodka/etc), medical cure claims.
- Never use more than 4 consecutive uppercase Latin letters (SHOPNOW is bad; Shop Now / FREE is ok). Avoid ALL-CAPS words longer than 4 letters.
- Callouts and descriptions MAY mention discounts, free shipping, coupons, or sale language when plausible. Concrete % off / coupon codes still prefer promotionAsset when known.
- promotionAsset: optional. Set enabled=true only when a concrete discount is known or strongly typical for this merchant; otherwise enabled=false or null. Use percentOff as whole percent (20 means 20%). moneyAmountOff is a decimal string. languageCode should match the ad language. finalUrl defaults to merchant URL if omitted. occasion may be empty or a real holiday occasion when applicable. Always leave startDate and endDate empty (operators set schedule manually later).
- translations: required Simplified Chinese glosses for human review only (not sent to Google). Must include: headlines, descriptions, callouts, sitelinks, keywords (aligned to keywords[]), structuredSnippets (2 strings; each is comma-separated Chinese glosses for that snippet's values), and promotion if any. translations.headlines[i] MUST mean the same as headlines[i] as finally written (within the character limit) — never gloss a longer unused draft.
- structuredSnippets: pick exactly 2 DIFFERENT headers from [${headers}] that best fit THIS merchant (not a fixed Types+Styles habit). Examples: travel/airlines → Destinations + Types; hotels → Amenities + Destinations; multi-brand → Brands + Types; electronics → Models + Types; fashion own-brand → Styles + Types; services → Service catalog + Types. Use exact English header strings. Values must be merchant-specific (not Apparel/Casual filler). Each needs at least ${AD_COPY_LIMITS.structuredValuesMin} short values.
- Always include useful negativeKeywords (careers, login, free pdf, etc.).
- Ad final URL (RSA) stays ${merchantUrl}. No URLs inside headline/description/callout text.
- Each sitelink MUST include its own finalUrl, linkText, description1, and description2 (all required). finalUrl values must be distinct https pages on the same merchant host. MUST include one official-site sitelink using ${merchantUrl} (or same-host root /). Prefer purchase pages for the rest: shop, collections, products, best sellers, new arrivals, sale/deals. Avoid Contact Us / About / Support / Careers / Login unless no purchase pages exist. When a known page label exists, rewrite it into natural sitelink copy for the audience language instead of pasting the raw nav label.
${knownPages ? `Known on-site pages to prefer for sitelink finalUrl (purchase pages first):\n${knownPages}` : ''}`;
}

/** 日历临近节日标签（与商家证据做交集后才允许点名）。 */
const NEARBY_SEASON_RULES: Array<{
  label: string;
  match: RegExp;
  when: (month: number, day: number, asia: boolean) => boolean;
}> = [
  {
    label: 'Lunar New Year / Spring Festival shopping',
    match: /lunar\s*new|spring\s*festival|chinese\s*new|春节|过年|农历新年/i,
    when: (month, day, asia) => asia && ((month === 1 && day <= 31) || (month === 2 && day <= 20)),
  },
  {
    label: 'Halloween / early holiday shopping',
    match: /halloween|万圣节/i,
    when: (month, day) => (month === 10 && day >= 20) || (month === 11 && day <= 5),
  },
  {
    label: 'Black Friday / Thanksgiving / Cyber week',
    match: /black\s*friday|thanksgiving|cyber\s*(monday|week)|黑五|黑色星期五|感恩节|网络星期一/i,
    when: (month, day) => month === 11 && day >= 15 && day <= 30,
  },
  {
    label: 'Christmas / December holiday / year-end shopping',
    match: /christmas|xmas|holiday\s*sale|year[\s-]*end|圣诞|年末|年终/i,
    when: (month) => month === 12,
  },
  {
    label: 'New Year shopping',
    match: /new\s*year|元旦|新年/i,
    when: (month, day, asia) => month === 1 && day <= 15 && !asia,
  },
  {
    label: "Valentine's Day",
    match: /valentine|情人节/i,
    when: (month, day) => month === 2 && day <= 20,
  },
  {
    label: "Mother's Day",
    match: /mother'?s\s*day|母亲节/i,
    when: (month, day) => month === 5 && day <= 15,
  },
  {
    label: "Father's Day / mid-year shopping",
    match: /father'?s\s*day|父亲节/i,
    when: (month, day) => month === 6 && day <= 20,
  },
  {
    label: 'Back-to-school',
    match: /back[\s-]*to[\s-]*school|返校|开学/i,
    when: (month, day) => month === 8 || (month === 9 && day <= 10),
  },
  {
    label: 'Singles Day (11.11) shopping',
    match: /singles?\s*day|11\.?\s*11|双十一|双11/i,
    when: (month, day, asia) => asia && month === 11 && day <= 15,
  },
];

/**
 * 从商家页面/导航文本里抽出节日线索（用于和日历窗口求交）。
 */
export function detectMerchantSeasonEvidence(texts: string[]): string[] {
  const blob = texts.filter(Boolean).join('\n');
  if (!blob.trim()) return [];
  const found: string[] = [];
  for (const rule of NEARBY_SEASON_RULES) {
    if (rule.match.test(blob)) found.push(rule.label);
  }
  return found;
}

/**
 * 生成时提示临近节日/购物季。
 * 有页面证据才点名节日；抓取失败/无线索 = 证据不足，不等于商家未参与。
 */
export function nearbySeasonCopyHint(
  now = new Date(),
  countryCode = 'US',
  options?: { merchantEvidence?: string[]; siteScan?: 'ok' | 'failed' | 'unknown' },
): string {
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();
  const country = countryCode.trim().toUpperCase();
  const asia = ['CN', 'HK', 'TW', 'SG', 'MY', 'JP', 'KR'].includes(country);
  const hints: string[] = [`Today (UTC) is ${now.toISOString().slice(0, 10)}.`];
  const nearby = NEARBY_SEASON_RULES
    .filter((rule) => rule.when(month, day, asia))
    .map((rule) => rule.label);
  const evidenceBlob = (options?.merchantEvidence ?? []).join('\n');
  const siteScan = options?.siteScan ?? (evidenceBlob.trim() ? 'ok' : 'unknown');
  const confirmed = nearby.filter((label) => {
    const rule = NEARBY_SEASON_RULES.find((item) => item.label === label);
    if (!rule) return false;
    if (!evidenceBlob.trim()) return false;
    return rule.match.test(evidenceBlob) || evidenceBlob.toLowerCase().includes(label.toLowerCase());
  });

  if (confirmed.length) {
    for (const label of confirmed) {
      hints.push(
        `CONFIRMED MERCHANT SEASON: ${label}. Site evidence shows this merchant is running it. You MUST weave this into the ad copy — at least 4 headlines, 1–2 descriptions, and 1–2 callouts that clearly reference it in the audience language. Soft gift / deal / shopping-event wording is fine; do not invent fake coupon codes or fake % off.`,
      );
    }
  } else if (nearby.length) {
    if (siteScan === 'failed') {
      hints.push(
        `Calendar-nearby seasons (${nearby.join('; ')}) exist, but the merchant site could not be crawled. Crawl failure is NOT proof the merchant is skipping these events — do not claim they are not participating. Still do NOT name these holidays in ads without confirmation (avoid false advertising); use evergreen deal / logistics / category angles. Operators can add holiday copy manually after review.`,
      );
    } else if (siteScan === 'ok') {
      hints.push(
        `Calendar-nearby seasons (${nearby.join('; ')}) exist. The page was scanned but no matching holiday keywords were found — that is insufficient evidence to name the holiday, NOT a conclusion that the merchant is not participating. Do NOT name these holidays in headlines, descriptions, or callouts without confirmation; use evergreen deal / logistics / category angles.`,
      );
    } else {
      hints.push(
        `Calendar-nearby seasons (${nearby.join('; ')}) exist, but merchant participation is unconfirmed (no site evidence available). Unconfirmed ≠ not participating. Do NOT name these holidays without confirmation; use evergreen deal / logistics / category angles.`,
      );
    }
  } else {
    hints.push(
      'No major holiday is immediate; still include a few evergreen deal / logistics / seasonal-pick headlines when natural for this merchant.',
    );
  }
  hints.push('Never invent fake % off amounts or coupon codes.');
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
 * 把模型文案套进草稿。
 * 标题/描述/宣传语不硬截断（保留与 translations 同义）；超限由审核红框 + validateDraft 处理。
 * padFromTemplate=false（默认）：不用示例句凑数；true 仅兼容旧测试/未开 AI 合并。
 */
export function applyAdCopy(
  base: AdDraft,
  raw: Record<string, unknown>,
  pageLinks: Array<{ url: string; label?: string }> = [],
  options?: { padFromTemplate?: boolean },
): AdDraft {
  const padFromTemplate = options?.padFromTemplate === true;
  const limits = AD_COPY_LIMITS;
  const modelHeadlines = textList(raw.headlines).map((text) => normalizeAdLine(text));
  const modelDescriptions = textList(raw.descriptions).map((text) => normalizeAdLine(text));
  const modelCallouts = textList(raw.callouts).map((text) => normalizeAdLine(text));
  const headlines = uniqueNonEmpty(
    padFromTemplate ? [...modelHeadlines, ...base.headlines] : modelHeadlines.length ? modelHeadlines : base.headlines,
  ).slice(0, limits.headlineCount.max);
  const descriptions = uniqueNonEmpty(
    padFromTemplate
      ? [...modelDescriptions, ...base.descriptions]
      : modelDescriptions.length ? modelDescriptions : base.descriptions,
  ).slice(0, limits.descriptionCount.max);
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
  const callouts = uniqueNonEmpty(
    padFromTemplate ? [...modelCallouts, ...base.callouts] : modelCallouts.length ? modelCallouts : base.callouts,
  ).slice(0, limits.calloutCount.prefer);
  const modelSitelinks = sitelinkList(raw.sitelinks);
  const sitelinks = ensureCompleteSitelinks(
    (padFromTemplate ? [...modelSitelinks, ...base.sitelinks] : modelSitelinks).slice(0, limits.sitelinkCount.prefer),
    base.merchantUrl,
    padFromTemplate ? base.sitelinks : [],
    pageLinks,
  );
  const structuredSnippets = structuredSnippetList(
    raw.structuredSnippets,
    padFromTemplate ? base.structuredSnippets : [],
  );
  const promotion = typeof raw.promotion === 'string' ? raw.promotion.trim().slice(0, 120) : base.promotion;
  const promotionAsset = parsePromotionAsset(raw.promotionAsset, base);
  const nextKeywords = keywords.length ? keywords : base.keywords;
  const nextCallouts = callouts;
  const nextSnippets = structuredSnippets.length ? structuredSnippets : (padFromTemplate ? base.structuredSnippets : []);
  const nextSitelinks = sitelinks;
  const parsedTranslations = parseTranslations(raw.translations, {
    headlines,
    descriptions,
    callouts: nextCallouts,
    sitelinks: nextSitelinks,
    keywords: nextKeywords,
    structuredSnippets: nextSnippets,
    promotion,
  });
  const translations = padFromTemplate
    ? (parsedTranslations ?? base.translations)
    : mergeTranslations_(base.translations, parsedTranslations);

  if (headlines.length < limits.headlineCount.min) throw new Error('模型标题不足');
  if (descriptions.length < limits.descriptionCount.min) throw new Error('模型描述不足');

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

function mergeTranslations_(
  prev: AdDraft['translations'] | undefined,
  next: AdDraft['translations'] | undefined,
): AdDraft['translations'] | undefined {
  if (!prev && !next) return undefined;
  return {
    headlines: next?.headlines?.length ? next.headlines : prev?.headlines,
    descriptions: next?.descriptions?.length ? next.descriptions : prev?.descriptions,
    callouts: next?.callouts?.length ? next.callouts : prev?.callouts,
    sitelinks: next?.sitelinks?.length ? next.sitelinks : prev?.sitelinks,
    keywords: next?.keywords?.length ? next.keywords : prev?.keywords,
    structuredSnippets: next?.structuredSnippets?.length ? next.structuredSnippets : prev?.structuredSnippets,
    promotion: next?.promotion || prev?.promotion,
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
    // 起止时间由人工按投放情况填写，不采用模型自动填的日期
    startDate: '',
    endDate: '',
  };
}

/** 规范化空白与过度大写；不截断。 */
export function normalizeAdLine(value: string): string {
  return softenExcessiveUppercase(value.trim().replace(/\s+/g, ' '));
}

/**
 * 截到 Google Ads 字数上限；尽量在空格处截断。
 * 仅用于模板兜底/结构化短值等；主广告文案请用 normalizeAdLine，避免与中文提示错位。
 */
export function fitAdText(value: string, max: number): string {
  const text = normalizeAdLine(value);
  if (adTextLen(text) <= max) return text;
  const chars = [...text];
  const sliced = chars.slice(0, max).join('');
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
 * 审核页单条重写：只生成标题 / 描述 / 宣传信息 / 站内链接中的一条，避免整单重跑。
 */
export async function rewriteAdField(input: {
  kind: AdCopyFieldKind;
  merchantName: string;
  merchantUrl: string;
  countryCode: string;
  languageCode: string;
  personaPrompt?: string;
  siblings: string[];
  currentText?: string;
  currentSitelink?: Pick<AdSitelink, 'linkText' | 'description1' | 'description2' | 'finalUrl'>;
  pageTextHints?: string[];
  merchantSeasonEvidence?: string[];
  siteScan?: 'ok' | 'failed' | 'unknown';
}): Promise<{ text: string; zh?: string } | { sitelink: Pick<AdSitelink, 'linkText' | 'description1' | 'description2'>; zh?: string }> {
  const language = audienceLanguage(input.countryCode, input.languageCode);
  const seasonHint = nearbySeasonCopyHint(new Date(), input.countryCode, {
    merchantEvidence: resolveMerchantSeasonEvidence_(input),
    siteScan: input.siteScan ?? (input.pageTextHints?.length ? 'ok' : 'unknown'),
  });
  const brand = input.merchantName.trim() || 'the brand';
  const avoid = input.siblings
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((item) => `- ${item}`)
    .join('\n');

  if (input.kind === 'sitelink') {
    const current = input.currentSitelink;
    const raw = await askJson(
      `Rewrite ONE Google Ads sitelink for ${brand}. Audience language: ${language}. Country: ${input.countryCode}.
Landing page hint: ${current?.finalUrl || input.merchantUrl}.
${seasonHint}
Make linkText + description1 + description2 specific to this merchant/page. Do not reuse stock phrases like Official website / Shop now / Visit our site.
Avoid duplicating these existing sitelink titles:
${avoid || '- (none)'}`,
      `Return JSON only: {"linkText": string, "description1": string, "description2": string, "zh": string}.
Limits: linkText <= ${AD_COPY_LIMITS.sitelinkText}; each description <= ${AD_COPY_LIMITS.sitelinkDescription}; both descriptions required.
zh is a short Simplified Chinese gloss of the three fields for human review.`,
      500,
      input.personaPrompt,
    );
    const linkText = normalizeAdLine(String(raw.linkText ?? ''));
    const description1 = normalizeAdLine(String(raw.description1 ?? ''));
    const description2 = normalizeAdLine(String(raw.description2 ?? ''));
    if (!linkText || !description1 || !description2) {
      throw new Error('模型没有返回完整的站内链接文案');
    }
    if (
      isUnsafeAdText(linkText, 'sitelink')
      || isUnsafeAdText(description1, 'sitelink')
      || isUnsafeAdText(description2, 'sitelink')
    ) {
      throw new Error('生成的站内链接含违规表述，请再试一次');
    }
    return {
      sitelink: { linkText, description1, description2 },
      zh: typeof raw.zh === 'string' ? raw.zh.trim() : undefined,
    };
  }

  const limit = input.kind === 'headline'
    ? AD_COPY_LIMITS.headline
    : input.kind === 'description'
      ? AD_COPY_LIMITS.description
      : AD_COPY_LIMITS.callout;
  const label = input.kind === 'headline' ? 'headline' : input.kind === 'description' ? 'description' : 'callout';
  const raw = await askJson(
    `Rewrite ONE Google Ads RSA ${label} for ${brand}. Audience language: ${language}. Country: ${input.countryCode}.
Current line (replace it, do not copy): ${input.currentText?.trim() || '(empty)'}
${seasonHint}
Avoid duplicating these existing lines:
${avoid || '- (none)'}`,
    `Return JSON only: {"text": string, "zh": string}.
Hard limit: text <= ${limit} characters (spaces/punctuation count). Prefer rewriting shorter over long phrases. Strong click intent; specific to this merchant; no placeholders like $X or [link]; no more than 4 consecutive uppercase Latin letters.
zh must gloss the exact text you return (same meaning), Simplified Chinese for human review.`,
    400,
    input.personaPrompt,
  );
  const text = normalizeAdLine(String(raw.text ?? ''));
  if (!text) throw new Error('模型没有返回文案');
  const unsafeKind = input.kind === 'headline' || input.kind === 'description' || input.kind === 'callout'
    ? input.kind
    : 'general';
  if (isUnsafeAdText(text, unsafeKind)) {
    throw new Error('生成的文案含违规表述，请再试一次');
  }
  if (input.siblings.some((item) => item.trim().toLowerCase() === text.toLowerCase())) {
    throw new Error('生成结果与现有文案重复，请再试一次');
  }
  // 超限不硬截断：保留原文与 zh 同义，由审核页标红；发布仍会被 validate 拦住
  return {
    text,
    zh: typeof raw.zh === 'string' ? raw.zh.trim() : undefined,
  };
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
    { maxTokens, timeoutMs: 90000 },
  );
  try {
    return parseModelJson(first);
  } catch {
    const second = await completeModelGoChat(
      [
        { role: 'system', content: system },
        { role: 'user', content: `${task}\n${shape}\nThe previous reply was not valid JSON. Return one JSON object and nothing else.` },
      ],
      { maxTokens, timeoutMs: 90000 },
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
 * 读出合格的站内链接。文案与两条描述都必须有；finalUrl 可后置分配。
 */
function sitelinkList(value: unknown): AdDraft['sitelinks'] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const linkText = typeof (item as { linkText?: unknown }).linkText === 'string'
        ? normalizeAdLine((item as { linkText: string }).linkText)
        : '';
      const description1 = typeof (item as { description1?: unknown }).description1 === 'string'
        ? normalizeAdLine((item as { description1: string }).description1)
        : '';
      const description2 = typeof (item as { description2?: unknown }).description2 === 'string'
        ? normalizeAdLine((item as { description2: string }).description2)
        : '';
      const finalUrl = typeof (item as { finalUrl?: unknown }).finalUrl === 'string'
        ? (item as { finalUrl: string }).finalUrl.trim()
        : '';
      if (!linkText || !description1 || !description2) return null;
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
