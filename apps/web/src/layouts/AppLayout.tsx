import { useEffect, useState } from 'react';
import { Layout, Menu, Tag, Typography } from 'antd';
import { LeftOutlined, LogoutOutlined, RightOutlined } from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import TeamMemberScopeSelect from '../components/TeamMemberScopeSelect';
import {
  buildAdminSidebarMenu,
  buildEmployeeSidebarMenu,
  resolveSidebarSelectedKey,
} from './sidebar-menu.config';
import './AppLayout.css';

const { Header, Sider, Content } = Layout;

const COLLAPSE_KEY = 'zjads.sidebar.collapsed';

/**
 * 主框架：侧边栏可收起，状态记在本机。
 */
export default function AppLayout() {
  const { user, logout, isAdmin, isTeamLead } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const items = isAdmin ? buildAdminSidebarMenu() : buildEmployeeSidebarMenu();
  const selectedKey = resolveSidebarSelectedKey(location.pathname, isAdmin);

  return (
    <Layout className="app-shell" style={{ minHeight: '100vh' }}>
      <Sider
        className="app-sider"
        width={220}
        collapsedWidth={64}
        collapsible
        collapsed={collapsed}
        trigger={null}
        theme="dark"
      >
        <div className="app-sider__brand">{collapsed ? 'ZJ' : 'ZJADS'}</div>
        <Menu
          theme="dark"
          mode="inline"
          className="app-sider-menu"
          inlineCollapsed={collapsed}
          selectedKeys={[selectedKey]}
          items={items}
        />
        <button
          type="button"
          className="app-sider__collapse"
          aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
          onClick={() => setCollapsed((current) => !current)}
        >
          {collapsed ? <RightOutlined /> : <LeftOutlined />}
        </button>
      </Sider>
      <Layout>
        <Header
          style={{
            background: '#fff',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Typography.Text type="secondary">
            {isAdmin
              ? '管理员后台 · 联盟数据采集与投放分析'
              : isTeamLead
                ? '组长工作台 · 联盟数据采集与投放分析'
                : '联盟数据采集与投放分析'}
          </Typography.Text>
          <Typography.Link
            onClick={() => {
              logout();
              navigate('/login');
            }}
          >
            <LogoutOutlined /> {user?.username}
            {isAdmin && (
              <Tag color="gold" style={{ marginLeft: 8, verticalAlign: 'middle' }}>
                管理员
              </Tag>
            )}
            {!isAdmin && isTeamLead && (
              <Tag color="processing" style={{ marginLeft: 8, verticalAlign: 'middle' }}>
                组长
              </Tag>
            )}{' '}
            退出
          </Typography.Link>
        </Header>
        <Content style={{ margin: 24 }}>
          {isTeamLead && !isAdmin ? (
            <div style={{ marginBottom: 16 }}>
              <TeamMemberScopeSelect user={user} isAdmin={isAdmin} embedded />
            </div>
          ) : null}
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
