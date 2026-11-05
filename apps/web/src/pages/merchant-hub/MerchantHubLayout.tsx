import { AlertOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { Tabs, Typography } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { MERCHANT_HUB_BASE, enabledMerchantHubTabs } from './merchant-hub.routes';
import './MerchantHubLayout.css';

const TAB_ICONS: Record<string, React.ReactNode> = {
  status: <SafetyCertificateOutlined />,
  chargebacks: <AlertOutlined />,
};

/**
 * 我的商家模块壳层（Join 状态、拒付清单等共用 Tab 导航）。
 */
export default function MerchantHubLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const tabs = enabledMerchantHubTabs();

  const activeKey =
    tabs.find((t) => location.pathname.startsWith(`${MERCHANT_HUB_BASE}/${t.path}`))?.path ??
    tabs[0]?.path ??
    '';

  return (
    <div className="merchant-hub-module">
      <Typography.Title level={4} className="merchant-hub-module__title">
        我的商家
      </Typography.Title>
      <Typography.Paragraph type="secondary" className="merchant-hub-module__intro">
        商家 Join / 上架与全员拒付分析；请从下方选择模块。
      </Typography.Paragraph>

      <div className="merchant-hub-module__nav-shell">
        <Tabs
          className={`merchant-hub-module__tabs merchant-hub-module__tabs--prominent${activeKey === 'chargebacks' ? ' is-chargebacks-active' : ''}`}
          activeKey={activeKey}
          size="large"
          onChange={(key) => navigate(`${MERCHANT_HUB_BASE}/${key}`)}
          items={tabs.map((t) => ({
            key: t.path,
            label: (
              <span className={`merchant-hub-tab-label merchant-hub-tab-label--${t.path}`}>
                <span className="merchant-hub-tab-label__main">
                  {TAB_ICONS[t.path]}
                  {t.label}
                </span>
                <span className="merchant-hub-tab-label__sub">{t.subtitle}</span>
              </span>
            ),
          }))}
        />
      </div>

      <Outlet />
    </div>
  );
}
