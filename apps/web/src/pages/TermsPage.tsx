import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import PublicShell from '../components/PublicShell';

/**
 * 服务条款页。声明 fengdu-ads 为内部工具，并要求遵守 Google Ads API 与联盟营销计划政策。
 */
export default function TermsPage() {
  useEffect(() => {
    document.title = 'Terms of Service · fengdu-ads';
  }, []);

  return (
    <PublicShell>
      <article className="legal-page">
        <Link className="legal-page__back" to="/">
          ← fengdu-ads
        </Link>
        <p className="legal-page__eyebrow">fengdu-ads</p>
        <h1>Terms of Service</h1>
        <p className="legal-page__updated">Last updated: November 10, 2026</p>

        <h2>Internal tool</h2>
        <p>
          fengdu-ads is an internal tool operated by 温州市鹿城区志君电子商务商行 (Wenzhou Lucheng
          District Zhijun E-commerce Firm). It is provided only to employees and other personnel
          authorized by the firm. It is not a public service. You may not offer the platform to
          outside parties, resell access, or use it on behalf of another organization.
        </p>

        <h2>Google Ads API policies</h2>
        <p>
          Use of fengdu-ads with Google Ads must comply with the Google Ads API Terms of Service
          and the Google Ads API policies, including the requirements published by Google at{' '}
          <a href="https://developers.google.com/google-ads/api/docs/terms" rel="noreferrer">
            Google Ads API Terms
          </a>{' '}
          and{' '}
          <a href="https://developers.google.com/google-ads/api/policies" rel="noreferrer">
            Google Ads API policies
          </a>
          . Authorized users may access only the Google Ads accounts they are permitted to manage,
          and they must not use the platform in a way that violates those terms or policies.
        </p>

        <h2>Affiliate marketing program policies</h2>
        <p>
          Where fengdu-ads processes information related to affiliate marketing programs, use of
          the platform must comply with the terms and policies of each applicable affiliate
          marketing program. Users must not misrepresent traffic, orders, commissions, or merchant
          relationships, and must follow the program rules that apply to the firm’s own
          campaigns.
        </p>

        <h2>Acceptable use</h2>
        <p>
          Keep your login credentials confidential. Use fengdu-ads only for the firm’s internal
          budget management and performance analysis. The firm may suspend access that is
          inconsistent with these terms or with the policies named above.
        </p>
      </article>
    </PublicShell>
  );
}
