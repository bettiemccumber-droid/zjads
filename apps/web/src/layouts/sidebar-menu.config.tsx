import {
  BankOutlined,
  BarChartOutlined,
  CrownOutlined,
  DashboardOutlined,
  FileExcelOutlined,
  PieChartOutlined,
  ShopOutlined,
  SyncOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import type { MenuProps } from 'antd';
import { merchantHubDefaultPath } from '../pages/merchant-hub/merchant-hub.routes';

/** 我的商家菜单项 key（含 /merchants/status、/merchants/chargebacks） */
export const MERCHANT_HUB_MENU_KEY = '/merchants';

type MenuItem = NonNullable<MenuProps['items']>[number];

function item(key: string, icon: React.ReactNode, label: React.ReactNode): MenuItem {
  return { key, icon, label };
}

function group(label: string, children: MenuItem[]): MenuItem {
  return { type: 'group', label, children };
}

/** 员工 / 组长侧边栏（分组参考竞品：商家管理 · 数据中心 · 账户配置） */
export function buildEmployeeSidebarMenu(): MenuProps['items'] {
  return [
    group('商家管理', [
      item(
        MERCHANT_HUB_MENU_KEY,
        <ShopOutlined />,
        <Link to={merchantHubDefaultPath()}>我的商家</Link>,
      ),
    ]),
    group('数据中心', [
      item(
        '/dashboard',
        <DashboardOutlined />,
        <Link to="/dashboard">数据采集</Link>,
      ),
      item(
        '/settlement',
        <BarChartOutlined />,
        <Link to="/settlement">结算查询</Link>,
      ),
      item(
        '/settlement-report',
        <FileExcelOutlined />,
        <Link to="/settlement-report">结算报表</Link>,
      ),
    ]),
    group('账户配置', [
      item(
        '/channel-accounts',
        <BankOutlined />,
        <Link to="/channel-accounts">我的平台账号</Link>,
      ),
      item(
        '/ad-sources',
        <FileExcelOutlined />,
        <Link to="/ad-sources">广告数据源</Link>,
      ),
    ]),
  ];
}

/** 管理员侧边栏 */
export function buildAdminSidebarMenu(): MenuProps['items'] {
  return [
    group('系统管理', [
      item('/admin', <CrownOutlined />, <Link to="/admin">管理员中心</Link>),
      item('/admin/stats', <PieChartOutlined />, <Link to="/admin/stats">平台统计</Link>),
      item('/admin/users', <TeamOutlined />, <Link to="/admin/users">用户管理</Link>),
      item(
        '/admin/users/manage',
        <UserOutlined />,
        <Link to="/admin/users/manage">创建员工</Link>,
      ),
      item('/admin/sync', <SyncOutlined />, <Link to="/admin/sync">数据采集中心</Link>),
      item(
        '/admin/ad-sources',
        <FileExcelOutlined />,
        <Link to="/admin/ad-sources">广告数据源</Link>,
      ),
    ]),
    group('数据中心', [
      item('/settlement', <BarChartOutlined />, <Link to="/settlement">结算查询</Link>),
      item(
        '/settlement-report',
        <FileExcelOutlined />,
        <Link to="/settlement-report">结算报表</Link>,
      ),
      item(
        '/dashboard',
        <DashboardOutlined />,
        <Link to="/dashboard">员工工作台</Link>,
      ),
    ]),
    group('商家管理', [
      item(
        MERCHANT_HUB_MENU_KEY,
        <ShopOutlined />,
        <Link to={merchantHubDefaultPath()}>我的商家</Link>,
      ),
    ]),
  ];
}

/** 根据 pathname 解析应高亮的菜单 key */
export function resolveSidebarSelectedKey(pathname: string, isAdmin: boolean): string {
  if (pathname.startsWith('/merchants')) {
    return MERCHANT_HUB_MENU_KEY;
  }
  if (isAdmin && pathname.startsWith('/admin/users')) {
    return pathname === '/admin/users/manage' ? '/admin/users/manage' : '/admin/users';
  }
  if (pathname.startsWith('/admin')) {
    if (pathname === '/admin/stats') return '/admin/stats';
    if (pathname.startsWith('/admin/sync')) return '/admin/sync';
    if (pathname.startsWith('/admin/ad-sources')) return '/admin/ad-sources';
    if (pathname === '/admin' || pathname === '/admin/') return '/admin';
    return pathname;
  }
  if (pathname.startsWith('/dashboard')) return '/dashboard';
  if (pathname.startsWith('/settlement-report')) return '/settlement-report';
  if (pathname.startsWith('/settlement')) return '/settlement';
  if (pathname.startsWith('/channel-accounts')) return '/channel-accounts';
  if (pathname.startsWith('/ad-sources')) return '/ad-sources';
  return pathname;
}
