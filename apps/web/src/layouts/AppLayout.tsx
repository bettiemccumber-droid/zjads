import { Layout, Menu, Tag, Typography } from 'antd';
import { LogoutOutlined } from '@ant-design/icons';
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

export default function AppLayout() {
  const { user, logout, isAdmin, isTeamLead } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const items = isAdmin ? buildAdminSidebarMenu() : buildEmployeeSidebarMenu();
  const selectedKey = resolveSidebarSelectedKey(location.pathname, isAdmin);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={220} theme="dark">
        <div style={{ padding: 16, color: '#fff', fontWeight: 700, fontSize: 18 }}>ZJADS</div>
        <Menu
          theme="dark"
          mode="inline"
          className="app-sider-menu"
          selectedKeys={[selectedKey]}
          items={items}
        />
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
