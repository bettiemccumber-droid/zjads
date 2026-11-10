import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import PublicShell from '../components/PublicShell';
import { setCanonical } from '../utils/canonical';

/**
 * 服务条款页。声明 Zhijun 为内部工具，并要求遵守 Google Ads API 与联盟营销计划政策。
 */
export default function TermsPage() {
  useEffect(() => {
    document.title = 'Terms of Service · Zhijun Ads Manager';
    setCanonical('/terms');
  }, []);

  return (
    <PublicShell>
      <article className="legal-page">
        <Link className="legal-page__back" to="/">
          ← Zhijun
        </Link>
        <p className="legal-page__eyebrow">Zhijun Ads Manager</p>
        <h1>Terms of Service</h1>
        <p className="legal-page__updated">Last updated: November 10, 2026</p>

        <h2>Internal tool</h2>
        <p>
          Zhijun Ads Manager is an internal tool operated by 温州市鹿城区志君电子商务商行 (Wenzhou
          Lucheng District Zhijun E-commerce Firm). It is provided only to employees and other
          personnel authorized by the firm. It is not a public service. You may not offer the
          platform to outside parties, resell access, or use it on behalf of another organization.
        </p>

        <h2>No AI-generated content</h2>
        <p>
          Zhijun Ads Manager does not generate or distribute AI content. It does not create
          images, video, or non-consensual intimate imagery (NCII). The platform is limited to
          advertising data analysis and the management of the firm’s own Google Ads campaigns.
        </p>

        <h2>Google Ads API policies</h2>
        <p>
          Use of Zhijun Ads Manager with Google Ads must comply with the Google Ads API Terms of
          Service and the Google Ads API policies, including the requirements published by Google
          at{' '}
          <a href="https://developers.google.com/google-ads/api/docs/terms" rel="noreferrer">
            Google Ads API Terms
          </a>{' '}
          and{' '}
          <a href="https://developers.google.com/google-ads/api/policies" rel="noreferrer">
            Google Ads API policies
          </a>
          . Use of information received from Google APIs must also comply with the{' '}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" rel="noreferrer">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. Authorized users may access only the Google
          Ads accounts they are permitted to manage, and they must not use the platform in a way
          that violates those terms or policies.
        </p>

        <h2>Affiliate marketing program policies</h2>
        <p>
          Where Zhijun Ads Manager processes information related to affiliate marketing programs,
          use of the platform must comply with the terms and policies of each applicable affiliate
          marketing program. Users must not misrepresent traffic, orders, commissions, or merchant
          relationships, and must follow the program rules that apply to the firm’s own
          campaigns.
        </p>

        <h2>Limited Use</h2>
        <p>
          Information received from Google APIs may be used only to provide the internal campaign
          management and performance analysis features shown in Zhijun Ads Manager. Users may not
          sell that information, pass it to another company for that company’s own use, use it to
          serve ads or to assess creditworthiness, or use it to train a generalized
          artificial-intelligence or machine-learning model. Humans may read it only to support an
          authorized user, to protect the security of the tool, or to comply with law.
        </p>

        <h2>Acceptable use</h2>
        <p>
          Keep your login credentials confidential. Use Zhijun Ads Manager only for the firm’s
          internal budget management and performance analysis of accounts the firm is authorized
          to manage. You may not use the platform to generate or distribute intimate imagery, to
          access Google data the firm is not authorized to use, to share Google Ads data outside
          the firm, or to offer this tool as a service to any other organization. The firm may
          suspend access that is inconsistent with these terms or with the policies named above.
        </p>

        <h2>Changes</h2>
        <p>
          We may update these terms when the tool or the policies it must follow change. The
          current version is always published at{' '}
          <a href="https://zjads.top/terms">https://zjads.top/terms</a>. Continued use of the tool
          after the date shown above means you accept the updated terms.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about these terms may be sent to 温州市鹿城区志君电子商务商行 (Wenzhou Lucheng
          District Zhijun E-commerce Firm) at{' '}
          <a href="mailto:marshallmarsxybasi01318@gmail.com">marshallmarsxybasi01318@gmail.com</a>.
        </p>
      </article>
    </PublicShell>
  );
}
