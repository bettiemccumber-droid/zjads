import { AdDraft, buildSampleDraft, SampleArticle, stripKeywordDecorations, validateDraft } from './ads-automation.util';
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
}): Promise<AdDraft> {
  const base = buildSampleDraft(input);
  const language = audienceLanguage(input.countryCode, input.languageCode);
  const raw = await askJson(
    `Write Google search ads for ${input.merchantName}. Audience language: ${language}. Country: ${input.countryCode}.`,
    `Return JSON only: {"headlines": string[3 to 8], "descriptions": string[2 to 4], "keywords": string[1 to 8], "negativeKeywords": string[0 to 8], "sitelinks": [{"linkText": string, "description1": string, "description2": string}]}.
Limits: headline <= 30 characters, description <= 90, sitelink text <= 25, each sitelink description <= 35 and both descriptions filled or both empty.
Do not invent prices, discounts, awards, or shipping promises. Final URL stays ${input.merchantUrl}. No URLs inside the copy.`,
    1400,
    input.personaPrompt,
  );
  const draft = applyAdCopy(base, raw);
  const errors = validateDraft(draft);
  if (errors.length) throw new Error(errors[0]);
  return draft;
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
 * 把模型文案套进草稿。超长的句子丢掉，避免截断后意思不对。
 */
export function applyAdCopy(base: AdDraft, raw: Record<string, unknown>): AdDraft {
  const headlines = textList(raw.headlines).filter((text) => text.length <= 30).slice(0, 15);
  const descriptions = textList(raw.descriptions).filter((text) => text.length <= 90).slice(0, 4);
  const keywords = textList(raw.keywords)
    .map((text) => stripKeywordDecorations(text).slice(0, 80))
    .filter(Boolean)
    .slice(0, 8)
    .map((text) => ({ text, matchType: 'PHRASE' as const }));
  const negativeKeywords = textList(raw.negativeKeywords)
    .map((text) => stripKeywordDecorations(text).slice(0, 80))
    .filter(Boolean)
    .slice(0, 8)
    .map((text) => ({ text, matchType: 'BROAD' as const }));
  const sitelinks = sitelinkList(raw.sitelinks, base.merchantUrl);
  if (headlines.length < 3) throw new Error('模型标题不足 3 条，或有标题超过 30 个字符');
  if (descriptions.length < 2) throw new Error('模型描述不足 2 条，或有描述超过 90 个字符');
  return {
    ...base,
    headlines,
    descriptions,
    keywords: keywords.length ? keywords : base.keywords,
    negativeKeywords: negativeKeywords.length ? negativeKeywords : base.negativeKeywords,
    sitelinks: sitelinks.length ? sitelinks : [{ ...base.sitelinks[0], linkText: headlines[0].slice(0, 25), description1: '', description2: '' }],
  };
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
    'You write affiliate ads and personal product-review blog posts. Reply with JSON only.',
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
 * 读出合格的站内链接。两条描述必须同时有或同时没有。
 */
function sitelinkList(value: unknown, finalUrl: string): AdDraft['sitelinks'] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const linkText = typeof (item as { linkText?: unknown }).linkText === 'string' ? (item as { linkText: string }).linkText.trim() : '';
      const description1 = typeof (item as { description1?: unknown }).description1 === 'string' ? (item as { description1: string }).description1.trim() : '';
      const description2 = typeof (item as { description2?: unknown }).description2 === 'string' ? (item as { description2: string }).description2.trim() : '';
      if (!linkText || linkText.length > 25) return null;
      if ((description1 && !description2) || (!description1 && description2)) return null;
      if (description1.length > 35 || description2.length > 35) return null;
      return { linkText, description1, description2, finalUrl, verified: true };
    })
    .filter((item): item is AdDraft['sitelinks'][number] => item != null)
    .slice(0, 4);
}
