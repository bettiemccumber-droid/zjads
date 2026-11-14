import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { setCanonical } from '../utils/canonical';
import './LandingPage.css';

type LandingLang = 'zh' | 'en';

/** Google Ads / Cloud 后台登记的公司主体，页面各处必须使用同一名称。 */
const COMPANY_ZH = '温州市鹿城区志君电子商务商行';
const COMPANY_EN = 'Wenzhou Lucheng District Zhijun E-commerce Firm';

/** 审核与用户联系使用的可达邮箱。 */
const CONTACT_EMAIL = 'marshallmarsxybasi01318@gmail.com';

/** 公司官网。平台域名 zjads.top 不是这个地址。 */
const COMPANY_SITE = 'https://www.zhijun-commerce.top/';
const COMPANY_SITE_LABEL = 'www.zhijun-commerce.top';

interface LandingCopy {
  badge: string;
  title: string;
  purpose: string;
  lead: string;
  note: string;
  about: string;
  pills: [string, string, string];
  enterUser: string;
  enterAdmin: string;
  demo: string;
  contact: string;
  apiTitle: string;
  readLabel: string;
  writeLabel: string;
  readItems: string[];
  writeItems: string[];
  apiNote: string;
  apiMore: string;
  capTitle: string;
  capLead: string;
  caps: { title: string; body: string }[];
  colProduct: string;
  colLegal: string;
  colContact: string;
  home: string;
  privacy: string;
  terms: string;
  website: string;
  company: string;
  tagline: string;
  copyright: string;
  brand: string;
}

const COPY: Record<LandingLang, LandingCopy> = {
  zh: {
    badge: '联盟营销 · Google Ads 自动化',
    title: '内部 Google Ads 管理工具',
    purpose:
      '本平台是内部广告自动化工具，用于管理自有 Google Ads 账户，只做广告数据分析和投放管理。本平台不生成 AI 内容，包括非自愿私密影像（NCII）。',
    lead: `${COMPANY_ZH}是一家联盟营销公司。公司内部广告团队通过本平台在我们自有的 Google Ads 经理账户（MCC）下管理 Google 搜索广告与效果最大化广告。所有广告预算均由本公司直接向 Google 支付。我们不为任何第三方客户管理广告。`,
    note: '本平台仅供公司内部广告团队使用，不向任何第三方提供产品或服务。所有广告均遵守 Google Ads 联盟营销计划政策。',
    about: '了解公司背景',
    pills: ['使用 Google Ads API', '自有 MCC · Google 直接扣款', '符合联盟营销计划政策'],
    enterUser: '进入用户平台',
    enterAdmin: '进入总控制台',
    demo: 'API 使用说明',
    contact: '联系我们',
    apiTitle: 'Google Ads API v23 — 使用方式',
    readLabel: '读操作',
    writeLabel: '写操作',
    readItems: [
      '每日广告指标（花费、点击、展示、转化）',
      '通过 GAQL 查询广告状态与预算',
      'MCC 子账户枚举（customer_client）',
      '广告组级别 CID 可用性检查',
    ],
    writeItems: [
      '创建广告系列 + 预算 + 广告组 + RSA',
      '关键词添加（广泛 / 词组 / 完全匹配）',
      '广告素材：站内链接 / 宣传信息 / 促销 / 价格 / 电话 / 摘要',
      '实时调整预算与 CPC 出价',
    ],
    apiNote:
      '在自有 MCC 下管理多个 Google Ads 子账户。所有广告费用由本公司直接向 Google 支付。需要 Basic Access（15,000 ops/天）——日常操作早已超出 Explorer Access 配额。',
    apiMore: '查看 API 使用说明',
    capTitle: '平台能力',
    capLead: '为联盟营销驱动的 Google Ads 运营提供端到端能力。',
    caps: [
      {
        title: '商家与广告流程',
        body: '从国际联盟网络发展合作商家，分配给内部团队成员进行端到端的广告管理。',
      },
      {
        title: 'Google Ads 投放管理',
        body: '自动化 Google 搜索广告与效果最大化广告全流程 — 广告系列创建、关键词设置、出价策略、地域/语言定向、RSA 组合及素材管理。',
      },
      {
        title: '数据看板与 ROI',
        body: '实时可视化看板，费用、点击、展示、转化、佣金、ROI 一目了然。',
      },
      {
        title: '内部效果复盘',
        body: '汇总自有账户的花费、点击、展示与转化，供内部预算和效果复盘。本平台不生成图片、视频或其他 AI 内容。',
      },
    ],
    colProduct: '产品',
    colLegal: '法律',
    colContact: '联系',
    home: 'Home',
    privacy: '隐私政策',
    terms: '服务条款',
    website: COMPANY_SITE_LABEL,
    company: COMPANY_ZH,
    tagline: '联盟营销 + Google Ads 自动化',
    copyright: `© 2026 ${COMPANY_ZH} 版权所有`,
    brand: 'Zhijun Ads Manager',
  },
  en: {
    badge: 'Affiliate marketing · Google Ads automation',
    title: 'Internal Google Ads management tool',
    purpose:
      'Zhijun Ads Manager is an internal Google Ads management tool used only to manage our own Google Ads accounts. This site is https://www.zjads.top/. It is used for advertising data analysis and campaign management. It does not generate AI content, including non-consensual intimate imagery (NCII).',
    lead: `${COMPANY_EN} is an affiliate marketing company. Our internal ads team uses this platform to manage Google Search and Performance Max campaigns under our own Google Ads manager account (MCC). All ad budgets are paid by the company directly to Google. We do not manage advertising for any third-party client.`,
    note: 'This platform is for the company’s internal ads team only and is not offered to any third party. Every campaign follows the Google Ads affiliate program policy.',
    about: 'About the company',
    pills: [
      'Uses the Google Ads API',
      'Own MCC · billed by Google',
      'Affiliate program policy',
    ],
    enterUser: 'User platform',
    enterAdmin: 'Admin console',
    demo: 'How the API is used',
    contact: 'Contact us',
    apiTitle: 'Google Ads API v23 — how we use it',
    readLabel: 'Read',
    writeLabel: 'Write',
    readItems: [
      'Daily ad metrics (cost, clicks, impressions, conversions)',
      'Campaign status and budgets via GAQL',
      'MCC sub-account enumeration (customer_client)',
      'Ad group CID availability checks',
    ],
    writeItems: [
      'Create campaigns, budgets, ad groups, and RSAs',
      'Keywords in broad, phrase, and exact match',
      'Assets: sitelinks, callouts, promotions, prices, calls, structured snippets',
      'Live budget and CPC bid changes',
    ],
    apiNote:
      'Multiple Google Ads sub-accounts are managed under our own MCC. All ad spend is paid by the company directly to Google. Basic Access (15,000 ops/day) is required — daily operations already exceed the Explorer Access quota.',
    apiMore: 'See how the API is used',
    capTitle: 'Platform capabilities',
    capLead: 'End-to-end tooling for affiliate-driven Google Ads operations.',
    caps: [
      {
        title: 'Merchants and workflow',
        body: 'Develop merchant partnerships from international affiliate networks and assign end-to-end campaign management to the internal team.',
      },
      {
        title: 'Google Ads automation',
        body: 'Automate Search and Performance Max: campaigns, keywords, bidding, location and language targeting, RSA combinations, and assets.',
      },
      {
        title: 'Dashboards and ROI',
        body: 'Live dashboards for cost, clicks, impressions, conversions, commission, and ROI.',
      },
      {
        title: 'Internal performance review',
        body: 'Summarize cost, clicks, impressions, and conversions from our own accounts for internal budget and performance review. The platform does not generate images, video, or other AI content.',
      },
    ],
    colProduct: 'Product',
    colLegal: 'Legal',
    colContact: 'Contact',
    home: 'Home',
    privacy: 'Privacy Policy',
    terms: 'Terms of Service',
    website: COMPANY_SITE_LABEL,
    company: COMPANY_EN,
    tagline: 'Affiliate marketing + Google Ads automation',
    copyright: `© 2026 ${COMPANY_EN}. All rights reserved.`,
    brand: 'Zhijun Ads Manager',
  },
};

/**
 * 营销展示页。版式与文案对齐 fengdu-ads 参考首页，登录入口统一指向 /login。
 */
export default function LandingPage() {
  const [lang, setLang] = useState<LandingLang>('en');
  const t = COPY[lang];

  useEffect(() => {
    document.title = 'Zhijun Ads Manager';
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.documentElement.setAttribute('data-rendered', '1');
    setCanonical('/');
  }, [lang]);

  return (
    <div className="lp">
      <header className="lp-header">
        <Link className="lp-brand" to="/">
          <span className="lp-brand__mark" aria-hidden="true">
            Z
          </span>
          <span>
            <span className="lp-brand__name">{t.brand}</span>
            <span className="lp-brand__sub">{t.title}</span>
          </span>
        </Link>
        <div className="lp-header__actions">
          <Link className="lp-site" to="/privacy">
            Privacy Policy
          </Link>
          <a className="lp-site" href={COMPANY_SITE} target="_blank" rel="noreferrer">
            {t.website}
          </a>
          <button
            type="button"
            className="lp-lang"
            onClick={() => setLang((current) => (current === 'zh' ? 'en' : 'zh'))}
          >
            {lang === 'zh' ? 'EN' : '中文'}
          </button>
        </div>
      </header>

      <main>
        <section className="lp-hero">
          <p className="lp-badge">
            <ShieldIcon />
            {t.badge}
          </p>
          <h1>Zhijun Ads Manager</h1>
          <p className="lp-kicker">{t.title}</p>
          <p className="lp-purpose">{t.purpose}</p>
          <p className="lp-lead">{t.lead}</p>
          <p className="lp-note">
            {t.note}{' '}
            <a href={COMPANY_SITE} target="_blank" rel="noreferrer">
              {t.about} <span aria-hidden="true">→</span>
            </a>
          </p>
          <ul className="lp-pills">
            {t.pills.map((item) => (
              <li key={item}>
                <CheckIcon />
                {item}
              </li>
            ))}
          </ul>
          <div className="lp-actions">
            <Link className="lp-btn lp-btn--primary" to="/login">
              <UserIcon />
              {t.enterUser}
            </Link>
            <Link className="lp-btn lp-btn--ghost" to="/login">
              <ConsoleIcon />
              {t.enterAdmin}
            </Link>
            <a className="lp-btn lp-btn--ghost" href="#api">
              <PlayIcon />
              {t.demo}
            </a>
            <a className="lp-btn lp-btn--green" href="#contact">
              <MailIcon />
              {t.contact}
            </a>
          </div>
        </section>

        <section className="lp-api" id="api">
          <div className="lp-wrap">
            <h2>{t.apiTitle}</h2>
            <div className="lp-api__grid">
              <article className="lp-panel">
                <h3 className="lp-panel__title lp-panel__title--read">
                  {t.readLabel} — <code>google.ads.searchStream</code>
                </h3>
                <ul>
                  {t.readItems.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
              <article className="lp-panel">
                <h3 className="lp-panel__title lp-panel__title--write">
                  {t.writeLabel} — <code>google.ads.mutate</code>
                </h3>
                <ul>
                  {t.writeItems.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            </div>
            <p className="lp-api__note">
              {t.apiNote}{' '}
              <a href="#capabilities">
                {t.apiMore} <span aria-hidden="true">→</span>
              </a>
            </p>
          </div>
        </section>

        <section className="lp-caps" id="capabilities">
          <div className="lp-wrap">
            <h2>{t.capTitle}</h2>
            <p className="lp-caps__lead">{t.capLead}</p>
            <div className="lp-caps__grid">
              {t.caps.map((item, index) => (
                <article className="lp-cap" key={item.title}>
                  <span className="lp-cap__icon" aria-hidden="true">
                    <CapIcon index={index} />
                  </span>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer" id="about">
        <div className="lp-footer__grid">
          <div>
            <Link className="lp-brand" to="/">
              <span className="lp-brand__mark" aria-hidden="true">
                Z
              </span>
              <span className="lp-brand__name">{t.brand}</span>
            </Link>
            <p className="lp-footer__company">{t.company}</p>
            <p className="lp-footer__tag">{t.tagline}</p>
          </div>
          <nav aria-label={t.colProduct}>
            <h2>{t.colProduct}</h2>
            <Link to="/">{t.home}</Link>
            <a href="#api">{t.demo}</a>
            <a href={COMPANY_SITE} target="_blank" rel="noreferrer">
              {t.about}
            </a>
          </nav>
          <nav aria-label={t.colLegal}>
            <h2>{t.colLegal}</h2>
            <Link to="/privacy">{t.privacy}</Link>
            <Link to="/terms">{t.terms}</Link>
            {lang === 'zh' ? (
              <>
                <Link to="/privacy">Privacy Policy</Link>
                <Link to="/terms">Terms of Service</Link>
              </>
            ) : null}
          </nav>
          <div id="contact">
            <h2>{t.colContact}</h2>
            <a href="#contact">{t.contact}</a>
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            <a href={COMPANY_SITE} target="_blank" rel="noreferrer">
              {t.website}
            </a>
          </div>
        </div>
        <p className="lp-footer__copy">{t.copyright}</p>
        <p className="lp-footer__legal">
          {lang === 'zh' ? COMPANY_ZH : COMPANY_EN}
          <br />
          {lang === 'zh' ? `© 2026 ${COMPANY_ZH} 版权所有` : `© 2026 ${COMPANY_EN}. All rights reserved.`}
          {' · '}
          <Link to="/privacy">{t.privacy}</Link>
          {' · '}
          <Link to="/terms">{t.terms}</Link>
        </p>
      </footer>
    </div>
  );
}

/** 顶栏与徽章用的小图标。 */
function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3 5 6v6c0 4.2 2.8 7.2 7 9 4.2-1.8 7-4.8 7-9V6l-7-3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M9 12.2 11 14l4-4.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

/** 认证要点前的对勾。 */
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.5 12.2 11 14.6 15.5 9.8" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

/** 进入用户平台。 */
function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6.5 18.5c1.2-2.4 3.1-3.5 5.5-3.5s4.3 1.1 5.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

/** 进入总控制台。 */
function ConsoleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="11" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 19h8M8 9.5l2.2 1.8L8 13" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

/** 平台演示。 */
function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M10.5 9.5v5l4.2-2.5-4.2-2.5Z" fill="currentColor" />
    </svg>
  );
}

/** 联系我们。 */
function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="6" width="16" height="12" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m5 7 7 6 7-6" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

/**
 * 平台能力卡片图标，按卡片顺序切换图形。
 */
function CapIcon({ index }: { index: number }) {
  if (index === 1) {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M5 16v2h14v-2M8 14V8m4 6V5m4 9v-4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  if (index === 2) {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M5 16V9m0 7 4.5-4 3 2.5L19 7" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  if (index === 3) {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M7 4h8l4 4v12H7V4Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M15 4v4h4M9 13h6M9 16h4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24">
      <rect x="5" y="4" width="14" height="16" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 9h8M8 12h8M8 15h5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
