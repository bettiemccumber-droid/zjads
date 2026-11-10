import { Link } from 'react-router-dom';
import './SiteFooter.css';

export type SiteFooterTone = 'light' | 'dark';

/**
 * 登录页、隐私政策和服务条款的页脚。
 * 这里只放产品站自己的法律入口，不放公司官网，避免审核页出现第二个域名。
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
      </nav>
    </footer>
  );
}
