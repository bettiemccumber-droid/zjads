import {
  BankOutlined,
  BarChartOutlined,
  CrownOutlined,
  DashboardOutlined,
  FileExcelOutlined,
  FileTextOutlined,
  FormOutlined,
  IdcardOutlined,
  PieChartOutlined,
  AlertOutlined,
  SafetyCertificateOutlined,
  ShopOutlined,
  RocketOutlined,
  SyncOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import type { MenuProps } from 'antd';

export const MERCHANT_HUB_STATUS_KEY = '/merchants/status';
export const MERCHANT_HUB_CHARGEBACKS_KEY = '/merchants/chargebacks';

type MenuItem = NonNullable<MenuProps['items']>[number];

function item(key: string, icon: React.ReactNode, label: React.ReactNode): MenuItem {
  return { key, icon, label };
}

function group(label: string, children: MenuItem[]): MenuItem {
  return { type: 'group', label, children };
}

/** 员工 / 组长侧边栏（分组：商家管理 · 数据中心 · 文章管理 · 账户配置） */
export function buildEmployeeSidebarMenu(): MenuProps['items'] {
  return [
    group('商家管理', [
      item(
        '/ads/merchants',
        <ShopOutlined />,
        <Link to="/ads/merchants">我的商家</Link>,
      ),
      item(
        MERCHANT_HUB_STATUS_KEY,
        <SafetyCertificateOutlined />,
        <Link to="/merchants/status">商家状态</Link>,
      ),
      item(
        MERCHANT_HUB_CHARGEBACKS_KEY,
        <AlertOutlined />,
        <Link to="/merchants/chargebacks">拒付商家</Link>,
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
      item(
        '/ads/accounts',
        <IdcardOutlined />,
        <Link to="/ads/accounts">账户状态</Link>,
      ),
    ]),
    group('文章管理', [
      item(
        '/ads/articles/publish',
        <FormOutlined />,
        <Link to="/ads/articles/publish">文章发布</Link>,
      ),
      item(
        '/ads/articles',
        <FileTextOutlined />,
        <Link to="/ads/articles">文章管理</Link>,
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
      item(
        '/admin/publish-sites',
        <RocketOutlined />,
        <Link to="/admin/publish-sites">内容站</Link>,
      ),
      item(
        '/admin/merchant-lists',
        <ShopOutlined />,
        <Link to="/admin/merchant-lists">违规/推荐名单</Link>,
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
        '/ads/merchants',
        <ShopOutlined />,
        <Link to="/ads/merchants">我的商家</Link>,
      ),
      item(
        MERCHANT_HUB_STATUS_KEY,
        <SafetyCertificateOutlined />,
        <Link to="/merchants/status">商家状态</Link>,
      ),
      item(
        MERCHANT_HUB_CHARGEBACKS_KEY,
        <AlertOutlined />,
        <Link to="/merchants/chargebacks">拒付商家</Link>,
      ),
    ]),
  ];
}

/** 根据 pathname 解析应高亮的菜单 key */
export function resolveSidebarSelectedKey(pathname: string, isAdmin: boolean): string {
  if (pathname.startsWith('/merchants/chargebacks')) {
    return MERCHANT_HUB_CHARGEBACKS_KEY;
  }
  if (pathname.startsWith('/merchants')) {
    return MERCHANT_HUB_STATUS_KEY;
  }
  if (isAdmin && pathname.startsWith('/admin/users')) {
    return pathname === '/admin/users/manage' ? '/admin/users/manage' : '/admin/users';
  }
  if (pathname.startsWith('/admin')) {
    if (pathname === '/admin/stats') return '/admin/stats';
    if (pathname.startsWith('/admin/sync')) return '/admin/sync';
    if (pathname.startsWith('/admin/ad-sources')) return '/admin/ad-sources';
    if (pathname.startsWith('/admin/publish-sites')) return '/admin/publish-sites';
    if (pathname.startsWith('/admin/merchant-lists')) return '/admin/merchant-lists';
    if (pathname === '/admin' || pathname === '/admin/') return '/admin';
    return pathname;
  }
  if (pathname.startsWith('/dashboard')) return '/dashboard';
  if (pathname.startsWith('/settlement-report')) return '/settlement-report';
  if (pathname.startsWith('/settlement')) return '/settlement';
  if (pathname.startsWith('/channel-accounts')) return '/channel-accounts';
  if (pathname.startsWith('/ads/accounts')) return '/ads/accounts';
  if (pathname.startsWith('/ads/articles/publish')) return '/ads/articles/publish';
  if (pathname.startsWith('/ads/articles')) return '/ads/articles';
  if (pathname.startsWith('/ads/merchants') || pathname.startsWith('/ads-automation')) return '/ads/merchants';
  return pathname;
}
