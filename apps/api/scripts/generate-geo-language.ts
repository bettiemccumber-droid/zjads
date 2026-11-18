import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'scripts/geo-lang.generated.json'), 'utf8')) as {
  geo: Record<string, string>;
  language: Record<string, string>;
  countryOpts: Array<{ value: string; label: string }>;
  langOpts: Array<{ value: string; label: string }>;
};

const geoEntries = Object.entries(data.geo)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([code, id]) => `  ${code}: '${id}',`)
  .join('\n');

const langEntries = Object.entries(data.language)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([code, id]) => `  ${JSON.stringify(code)}: '${id}',`)
  .join('\n');

const apiTs = `/** Google Ads country geoTargetConstants and languageConstants (generated from official CSV). */
export const GEO_TARGET_BY_COUNTRY: Record<string, string> = {
${geoEntries}
};

export const LANGUAGE_CONSTANT_BY_CODE: Record<string, string> = {
${langEntries}
};
`;

fs.writeFileSync(path.join(root, 'src/ads-automation/geo-language.constants.ts'), apiTs, 'utf8');

const countryOpts = [...data.countryOpts]
  .sort((a, b) => a.value.localeCompare(b.value))
  .map((item) => `  { value: '${item.value}', label: ${JSON.stringify(item.label)} },`)
  .join('\n');

const seen = new Set<string>();
const langOpts: string[] = [];
for (const item of data.langOpts) {
  const value = item.value === 'zh_CN' ? 'zh' : item.value;
  if (seen.has(value)) continue;
  seen.add(value);
  const label = value === 'zh'
    ? 'zh - Chinese (simplified)'
    : item.label.replace(/^zh_CN/, 'zh').replace(/^zh_TW/, 'zh-TW');
  langOpts.push(`  { value: '${value}', label: ${JSON.stringify(label)} },`);
}

const webTs = `/** 领取/预览用的全球国家与语言选项（与 API geo-language.constants 对齐）。 */
export const AD_COUNTRY_OPTIONS = [
${countryOpts}
] as const;

export const AD_LANGUAGE_OPTIONS = [
${langOpts.join('\n')}
] as const;
`;

fs.writeFileSync(path.join(root, '../web/src/pages/ads/ad-geo-language-options.ts'), webTs, 'utf8');
console.log('generated geo-language constants');
