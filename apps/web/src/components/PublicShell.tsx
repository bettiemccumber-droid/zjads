import SiteFooter from './SiteFooter';
import './public-pages.css';

/**
 * 公开页面容器：内容区撑满视口，统一页脚贴在底部。
 */
export default function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-shell">
      <div className="public-shell__body">{children}</div>
      <SiteFooter />
    </div>
  );
}
