import { Tabs, Typography } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { MERCHANT_HUB_BASE, enabledMerchantHubTabs } from './merchant-hub.routes';
import './MerchantHubLayout.css';

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

      <Tabs
        className="merchant-hub-module__tabs"
        activeKey={activeKey}
        onChange={(key) => navigate(`${MERCHANT_HUB_BASE}/${key}`)}
        items={tabs.map((t) => ({
          key: t.path,
          label: t.label,
        }))}
      />

      <Outlet />
    </div>
  );
}
