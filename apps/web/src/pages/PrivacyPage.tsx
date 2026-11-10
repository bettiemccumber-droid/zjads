import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import PublicShell from '../components/PublicShell';

/**
 * 隐私政策页。说明内部使用范围、Google Ads 数据边界，以及不向第三方出售或分享数据。
 */
export default function PrivacyPage() {
  useEffect(() => {
    document.title = 'Privacy Policy · Zhijun';
  }, []);

  return (
    <PublicShell>
      <article className="legal-page">
        <Link className="legal-page__back" to="/">
          ← Zhijun
        </Link>
        <p className="legal-page__eyebrow">Zhijun</p>
        <h1>Privacy Policy</h1>
        <p className="legal-page__updated">Last updated: November 10, 2026</p>

        <h2>Internal use</h2>
        <p>
          Zhijun is an internal advertising operations platform operated by 温州市鹿城区志君电子商务商行
          (Wenzhou Lucheng District Zhijun E-commerce Firm). Access is limited to personnel
          authorized by the firm. The service is not a public product and is not offered to
          outside customers.
        </p>

        <h2>Google Ads data we access</h2>
        <p>
          When an authorized user connects a Google Ads account that the firm manages, Zhijun
          reads Google Ads data needed to operate those campaigns. The data may include:
        </p>
        <ul>
          <li>Account, campaign, and ad group identifiers and names</li>
          <li>Campaign status and budgets</li>
          <li>Cost, spend, impressions, clicks, and related performance metrics</li>
        </ul>
        <p>
          We request only the Google Ads data required for this internal workflow. We do not use
          the platform to access accounts the firm is not authorized to manage.
        </p>

        <h2>How we use the data</h2>
        <p>
          Google Ads data is used only for the firm’s internal budget management and performance
          analysis. This includes reviewing spend, comparing campaign results, and preparing
          internal reports for the firm’s own operations. We do not use this data to build
          profiles for outside advertising, and we do not use it for any purpose other than the
          firm’s internal analysis.
        </p>

        <h2>No sale or sharing with third parties</h2>
        <p>
          We do not sell Google Ads data or any other data collected by Zhijun. We do not
          share that data with any third party. Data stays inside the firm and is available only
          to authorized personnel for the internal purposes described above.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about this policy may be directed to the operator of Zhijun: 温州市鹿城区志君电子商务商行
          (Wenzhou Lucheng District Zhijun E-commerce Firm), at{' '}
          <a href="mailto:marshallmarsxybasi01318@gmail.com">marshallmarsxybasi01318@gmail.com</a>.
          The company website is{' '}
          <a href="https://zhijun-e-commerce-firm.vercel.app/" rel="noreferrer">
            https://zhijun-e-commerce-firm.vercel.app/
          </a>
          .
        </p>
      </article>
    </PublicShell>
  );
}
