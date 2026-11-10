import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import PublicShell from '../components/PublicShell';
import { setCanonical } from '../utils/canonical';

/**
 * 隐私政策页。说明内部使用范围、Google Ads 数据边界，以及不向第三方出售或分享数据。
 */
export default function PrivacyPage() {
  useEffect(() => {
    document.title = 'Privacy Policy · Zhijun Ads Manager';
    setCanonical('/privacy');
  }, []);

  return (
    <PublicShell>
      <article className="legal-page">
        <Link className="legal-page__back" to="/">
          ← Zhijun
        </Link>
        <p className="legal-page__eyebrow">Zhijun Ads Manager</p>
        <h1>Privacy Policy</h1>
        <p className="legal-page__updated">Last updated: November 10, 2026</p>

        <h2>Who we are</h2>
        <p>
          Zhijun Ads Manager is an internal advertising automation tool operated by 温州市鹿城区志君电子商务商行
          (Wenzhou Lucheng District Zhijun E-commerce Firm). It is used only by personnel
          authorized by the firm to manage the firm’s own Google Ads accounts. It is not offered
          to the public and it is not a service for outside clients. The company website is{' '}
          <a href="https://www.zhijun-commerce.top/" rel="noreferrer">
            https://www.zhijun-commerce.top/
          </a>
          .
        </p>

        <h2>Google Ads data we collect</h2>
        <p>
          When an authorized user connects a Google Ads account that the firm owns or is
          authorized to manage, Zhijun Ads Manager reads the following Google Ads data through
          the Google Ads API:
        </p>
        <ul>
          <li>Google Ads customer IDs, account names, and manager-account (MCC) relationships</li>
          <li>Campaign, ad group, and ad identifiers, names, and status</li>
          <li>Campaign budgets and bidding settings, including CPC bids where the account exposes them</li>
          <li>Cost and spend</li>
          <li>Clicks, impressions, and conversions</li>
          <li>Keywords and match types used in the firm’s own campaigns</li>
          <li>Ad assets needed to operate those campaigns, such as sitelinks and callouts</li>
        </ul>
        <p>
          We request only the Google Ads data required to analyze and manage those accounts. We
          do not use the platform to access Google Ads accounts the firm is not authorized to
          manage. We do not collect Google user data for advertising to consumers, and we do not
          collect data from people who merely visit this public website.
        </p>

        <h2>How we use the data</h2>
        <p>
          Google Ads data is used only for the firm’s internal advertising optimization and
          performance analysis. That means reviewing budgets and spend, comparing clicks,
          impressions, and conversions, and managing the firm’s own campaigns. We do not use this
          data to build profiles for outside advertising, to resell audiences, or for any purpose
          other than the firm’s internal analysis and campaign management.
        </p>

        <h2>No sale or sharing with third parties</h2>
        <p>
          We do not sell Google Ads data or any other data collected by Zhijun Ads Manager. We
          do not share that data with any third party. Access stays inside the firm and is
          limited to authorized personnel for the internal purposes described in this policy.
        </p>

        <h2>How data is stored</h2>
        <p>
          Google Ads data and the internal login records needed to operate the tool are stored
          on systems controlled by the firm. Only authorized personnel can access them. We do
          not place this data in a public repository, and we do not make it available for
          download by outside parties.
        </p>

        <h2>Retention and deletion</h2>
        <p>
          We keep Google Ads data only for as long as it is needed for the firm’s internal
          budget review and performance analysis. When a Google Ads account is disconnected, we
          stop collecting new data from that account. Authorized personnel can ask us to delete
          stored Google Ads data for an account the firm manages. We delete that data within 30
          days of a verified request sent to the email below, unless a longer period is required
          by law. Internal login records are deleted when the person’s access to the tool ends,
          or sooner on request, subject to the same legal exception.
        </p>

        <h2>No AI-generated content</h2>
        <p>
          Zhijun Ads Manager does not generate or distribute AI content. It does not create
          images, video, text for publication, or non-consensual intimate imagery (NCII). The
          tool is limited to advertising data analysis and management of the firm’s own Google
          Ads campaigns.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about this policy, or a request to delete data, may be sent to the operator
          of Zhijun Ads Manager: 温州市鹿城区志君电子商务商行 (Wenzhou Lucheng District Zhijun
          E-commerce Firm), at{' '}
          <a href="mailto:marshallmarsxybasi01318@gmail.com">marshallmarsxybasi01318@gmail.com</a>.
        </p>
      </article>
    </PublicShell>
  );
}
