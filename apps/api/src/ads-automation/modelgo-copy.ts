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
}): Promise<AdDraft> {
  const base = buildSampleDraft(input);
  const language = audienceLanguage(input.countryCode, input.languageCode);
  const raw = await askJson(
    `Write Google search ads for ${input.merchantName}. Audience language: ${language}. Country: ${input.countryCode}.`,
    `Return JSON only: {"headlines": string[3 to 8], "descriptions": string[2 to 4], "keywords": string[1 to 8], "negativeKeywords": string[0 to 8], "sitelinks": [{"linkText": string, "description1": string, "description2": string}]}.
Limits: headline <= 30 characters, description <= 90, sitelink text <= 25, each sitelink description <= 35 and both descriptions filled or both empty.
Do not invent prices, discounts, awards, or shipping promises. Final URL stays ${input.merchantUrl}. No URLs inside the copy.`,
  );
  const draft = applyAdCopy(base, raw);
  const errors = validateDraft(draft);
  if (errors.length) throw new Error(errors[0]);
  return draft;
}

/**
 * 按投放国家生成文章。正文不放网址，跟踪链接由系统另加。
 */
export async function writeArticle(input: {
  merchantName: string;
  merchantUrl: string;
  countryCode: string;
  languageCode: string;
}): Promise<SampleArticle> {
  const language = audienceLanguage(input.countryCode, input.languageCode);
  const raw = await askJson(
    `Write a short shopping article about ${input.merchantName} for readers in ${input.countryCode}. Language: ${language}.`,
    `Return JSON only: {"title": string, "sections": [{"heading": string, "text": string}]}.
Use 3 sections. Do not invent prices, ratings, medical claims, or limited-time offers. Do not include any URL. The page will add the affiliate link separately.`,
  );
  const article = applyArticle(raw);
  if (!article.title || article.sections.length < 2) throw new Error('模型返回的文章不完整');
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
 * 把模型文章收成标题和段落。
 */
export function applyArticle(raw: Record<string, unknown>): SampleArticle {
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 180) : '';
  const sections = Array.isArray(raw.sections)
    ? raw.sections
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const heading = typeof (item as { heading?: unknown }).heading === 'string' ? (item as { heading: string }).heading.trim() : '';
          const text = typeof (item as { text?: unknown }).text === 'string' ? (item as { text: string }).text.trim() : '';
          if (!heading || !text) return null;
          return { heading: heading.slice(0, 120), text: text.slice(0, 1200) };
        })
        .filter((item): item is { heading: string; text: string } => item != null)
        .slice(0, 6)
    : [];
  return { title, sections };
}

/**
 * 请求一段 JSON，并在格式不对时再问一次。
 */
async function askJson(task: string, shape: string): Promise<Record<string, unknown>> {
  const first = await completeModelGoChat([
    { role: 'system', content: 'You write affiliate ads and articles. Reply with JSON only.' },
    { role: 'user', content: `${task}\n${shape}` },
  ]);
  try {
    return parseModelJson(first);
  } catch {
    const second = await completeModelGoChat([
      { role: 'system', content: 'You write affiliate ads and articles. Reply with JSON only.' },
      { role: 'user', content: `${task}\n${shape}\nThe previous reply was not valid JSON. Return one JSON object and nothing else.` },
    ]);
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
