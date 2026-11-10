import { Link } from 'react-router-dom';
import './SiteFooter.css';

/** 公司官网。平台域名 zjads.top 不是这个地址。 */
const COMPANY_SITE = 'https://www.zhijun-commerce.top/';

export type SiteFooterTone = 'light' | 'dark';

/**
 * 公开页与登录页共用的页脚。
 * 展示公司主体、版权，以及隐私政策和服务条款入口。
 */
export default function SiteFooter({ tone = 'light' }: { tone?: SiteFooterTone }) {
  return (
    <footer className={`site-footer site-footer--${tone}`}>
      <p className="site-footer__company">
        温州市鹿城区志君电子商务商行 (Wenzhou Lucheng District Zhijun E-commerce Firm)
      </p>
      <p className="site-footer__copy">© 2026 Wenzhou Lucheng District Zhijun E-commerce Firm. All rights reserved.</p>
      <nav className="site-footer__links" aria-label="Legal">
        <Link to="/privacy">Privacy Policy</Link>
        <span className="site-footer__sep" aria-hidden="true">
          ·
        </span>
        <Link to="/terms">Terms of Service</Link>
        <span className="site-footer__sep" aria-hidden="true">
          ·
        </span>
        <a href={COMPANY_SITE} target="_blank" rel="noreferrer">
          www.zhijun-commerce.top
        </a>
      </nav>
    </footer>
  );
}
