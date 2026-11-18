import {
  AD_COPY_LIMITS,
  AdDraft,
  AdStructuredSnippet,
  STRUCTURED_SNIPPET_HEADERS,
  assignUniqueSitelinkUrls,
  buildSampleDraft,
  SampleArticle,
  stripKeywordDecorations,
  validateDraft,
} from './ads-automation.util';
import { completeModelGoChat } from './modelgo.client';

/**
 * 告诉模型这条广告要写给哪个国家的读者。墨西哥和西班牙的西语分开写。
 */
export function audienceLanguage(countryCode: string, languageCode: string): string {
  const country = countryCode.trim().toUpperCase();
  const language = languageCode.trim().toLowerCase();
  if (country === 'MX' || language === 'es-mx') return 'Spanish as used in Mexico';
  if (country === 'ES' || language === 'es-es') return 'Spanish as used in Spain';
  if (country === 'VN' || language.startsWith('vi')) return 'Vietnamese';
  if (language.startsWith('es')) return 'Spanish';
  if (language.startsWith('zh')) return 'Simplified Chinese';
  if (language.startsWith('fr')) return 'French';
  if (language.startsWith('de')) return 'German';
  if (country === 'US') return 'American English';
  if (country === 'GB') return 'British English';
  if (country === 'AU') return 'Australian English';
  return `the language coded ${language || 'en'} for readers in ${country || 'the target country'}`;
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
  const raw = await askJson(
    `Write Google search ads for ${input.merchantName}. Audience language: ${language}. Country: ${input.countryCode}. Use real brand tone; strong click and purchase intent.`,
    shape,
    2200,
    input.personaPrompt,
  );
  let draft = applyAdCopy(base, raw, pageLinks);
  let errors = validateDraft(draft);
  if (!errors.length) return draft;

  const retryRaw = await askJson(
    `Write Google search ads for ${input.merchantName}. Audience language: ${language}. Country: ${input.countryCode}.`,
    `Previous draft failed validation: ${errors.slice(0, 3).join('; ')}.
${shape}
Fix every limit and policy issue. Prefer shorter lines.`,
    2200,
    input.personaPrompt,
  );
  draft = applyAdCopy(base, retryRaw, pageLinks);
  errors = validateDraft(draft);
  if (errors.length) throw new Error(errors[0]);
  return draft;
}

function adCopyJsonShape(merchantUrl: string, pageLinks: Array<{ url: string; label?: string }> = []): string {
  const headers = STRUCTURED_SNIPPET_HEADERS.join(', ');
  const knownPages = pageLinks
    .slice(0, 20)
    .map((item) => `- ${item.url}${item.label ? ` (${item.label})` : ''}`)
    .join('\n');
  return `Return JSON only:
{"headlines": string[${AD_COPY_LIMITS.headlineCount.prefer}], "descriptions": string[${AD_COPY_LIMITS.descriptionCount.prefer}], "keywords": string[1 to 8], "negativeKeywords": string[4 to 12], "sitelinks": [{"linkText": string, "description1": string, "description2": string, "finalUrl": string}], "callouts": string[${AD_COPY_LIMITS.calloutCount.prefer}], "structuredSnippets": [{"header": string, "values": string[${AD_COPY_LIMITS.structuredValuesMin}+]}], "promotion": string}

Hard character limits (spaces/punctuation count):
- headline <= ${AD_COPY_LIMITS.headline}
- description <= ${AD_COPY_LIMITS.description}
- callout <= ${AD_COPY_LIMITS.callout}
- sitelink linkText <= ${AD_COPY_LIMITS.sitelinkText}
- each sitelink description <= ${AD_COPY_LIMITS.sitelinkDescription}, both filled
- each structured snippet value <= ${AD_COPY_LIMITS.structuredValue}

Content rules:
- Exactly ${AD_COPY_LIMITS.headlineCount.prefer} unique headlines, ${AD_COPY_LIMITS.descriptionCount.prefer} descriptions, ${AD_COPY_LIMITS.calloutCount.prefer} callouts, at least ${AD_COPY_LIMITS.sitelinkCount.prefer} sitelinks.
- Strong purchase verbs; low repetition; language must match the audience.
- Forbidden: free trial/gift wording, specific prices or %, placeholders like $X or [link], Google risk words (gun/firearm/tactical/combat/military/prescription/Rx/wine/vodka/etc), medical cure claims.
- Callouts must NOT mention free shipping, discounts, coupons, returns, or sale numbers. Put real promos only in "promotion".
- structuredSnippets: pick exactly 2 headers from [${headers}] that best fit this merchant (e.g. travel platform: TYPES + DESTINATIONS; multi-brand: TYPES + BRANDS; own-brand: TYPES + STYLES, avoid BRANDS). Each needs at least ${AD_COPY_LIMITS.structuredValuesMin} short values.
- Always include useful negativeKeywords (careers, login, free pdf, etc.).
- Ad final URL (RSA) stays ${merchantUrl}. No URLs inside headline/description/callout text.
- Each sitelink MUST include its own finalUrl. finalUrl values must be distinct https pages on the same merchant host, not all ${merchantUrl}. Prefer real subpages (quote, locations, services, how-it-works). Absolute paths or full URLs are both ok.
${knownPages ? `Known on-site pages to prefer for sitelink finalUrl:\n${knownPages}` : ''}`;
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
Match a medium-long personal blog style: specific, practical, a little conversational. Soft sell with natural keyword links.`,
    `Return JSON only: {"title": string, "intro": string[2], "sections": [{"heading": string, "paragraphs": string[2 to 3]}]}.
Requirements:
- Title under 90 characters, natural for search readers in that country.
- intro: exactly 2 opening paragraphs before the first heading.
- sections: 4 or 5 sections. Each heading is concrete. Each section has 2 or 3 paragraphs of 2 to 4 sentences.
- Include 4 to 8 affiliate keyword markers using exactly this syntax: [[affiliate:anchor text]].
- Anchor text must be natural phrases readers would click, for example the brand name, product type, or "try ${brand}". Vary the wording. Place markers inside sentences, not as a bare list.
- Put at least one marker in the intro and at least one near the end.
- Do not invent prices, star ratings, medical claims, or limited-time discounts.
- Never write real http/https URLs. Only [[affiliate:...]] markers are allowed for links.
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
    ].slice(0, limits.sitelinkCount.max),
    base.merchantUrl,
    pageLinks,
  );
  const structuredSnippets = structuredSnippetList(raw.structuredSnippets, base.structuredSnippets);
  const promotion = typeof raw.promotion === 'string' ? raw.promotion.trim().slice(0, 120) : base.promotion;

  if (headlines.length < limits.headlineCount.min) throw new Error('模型标题不足，补齐后仍不够');
  if (descriptions.length < limits.descriptionCount.min) throw new Error('模型描述不足，补齐后仍不够');

  return {
    ...base,
    headlines,
    descriptions,
    keywords: keywords.length ? keywords : base.keywords,
    negativeKeywords: negativeKeywords.length ? negativeKeywords : base.negativeKeywords,
    callouts: callouts.length ? callouts : base.callouts,
    sitelinks: sitelinks.length
      ? sitelinks
      : assignUniqueSitelinkUrls(
        [{ ...base.sitelinks[0], linkText: fitAdText(headlines[0], limits.sitelinkText), description1: '', description2: '', finalUrl: '' }],
        base.merchantUrl,
        pageLinks,
      ),
    structuredSnippets: structuredSnippets.length ? structuredSnippets : base.structuredSnippets,
    promotion,
  };
}

/**
 * 截到 Google Ads 字数上限；尽量在空格处截断，避免半截单词。
 */
export function fitAdText(value: string, max: number): string {
  const text = value.trim().replace(/\s+/g, ' ');
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
    'Follow Google Ads policies. Never invent prices, medical cures, weapons, alcohol SKUs, or placeholder tokens.',
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
  const allowed = new Set<string>(STRUCTURED_SNIPPET_HEADERS);
  const fromModel = Array.isArray(value)
    ? value
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const headerRaw = typeof (item as { header?: unknown }).header === 'string'
            ? (item as { header: string }).header.trim().toUpperCase().replace(/\s+/g, '_')
            : '';
          const header = allowed.has(headerRaw) ? headerRaw : '';
          const values = uniqueNonEmpty(
            textList((item as { values?: unknown }).values).map((text) => fitAdText(text, AD_COPY_LIMITS.structuredValue)),
          );
          if (!header || values.length < AD_COPY_LIMITS.structuredValuesMin) return null;
          return { header, values: values.slice(0, 10) };
        })
        .filter((item): item is AdStructuredSnippet => item != null)
    : [];
  const merged = [...fromModel, ...fallback];
  const seen = new Set<string>();
  const rows: AdStructuredSnippet[] = [];
  for (const row of merged) {
    if (seen.has(row.header)) continue;
    seen.add(row.header);
    rows.push(row);
    if (rows.length >= AD_COPY_LIMITS.structuredCategories) break;
  }
  return rows;
}
