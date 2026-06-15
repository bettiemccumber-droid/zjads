import { Layout, Menu, Tag, Typography } from 'antd';
import {
  DashboardOutlined,
  TeamOutlined,
  BankOutlined,
  LogoutOutlined,
  UserOutlined,
  BarChartOutlined,
  FileExcelOutlined,
  CrownOutlined,
  SyncOutlined,
  PieChartOutlined,
} from '@ant-design/icons';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const { Header, Sider, Content } = Layout;

/** 员工（运营/只读）侧边栏 */
const employeeMenuItems = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: <Link to="/dashboard">数据采集</Link> },
  {
    key: '/channel-accounts',
    icon: <BankOutlined />,
    label: <Link to="/channel-accounts">我的平台账号</Link>,
  },
  { key: '/settlement', icon: <BarChartOutlined />, label: <Link to="/settlement">结算查询</Link> },
  {
    key: '/ad-sources',
    icon: <FileExcelOutlined />,
    label: <Link to="/ad-sources">广告数据源</Link>,
  },
];

/** 管理员侧边栏（平台账号在员工侧配置；Sheet 在「广告数据源」代员工导入） */
const adminMenuItems = [
  { key: '/admin', icon: <CrownOutlined />, label: <Link to="/admin">管理员中心</Link> },
  { key: '/admin/stats', icon: <PieChartOutlined />, label: <Link to="/admin/stats">平台统计</Link> },
  { key: '/admin/users', icon: <TeamOutlined />, label: <Link to="/admin/users">用户管理</Link> },
  { key: '/admin/sync', icon: <SyncOutlined />, label: <Link to="/admin/sync">数据采集中心</Link> },
  {
    key: '/admin/ad-sources',
    icon: <FileExcelOutlined />,
    label: <Link to="/admin/ad-sources">广告数据源</Link>,
  },
  {
    key: '/admin/users/manage',
    icon: <UserOutlined />,
    label: <Link to="/admin/users/manage">创建员工</Link>,
  },
  { type: 'divider' as const },
  { key: '/settlement', icon: <BarChartOutlined />, label: <Link to="/settlement">结算查询</Link> },
  {
    key: '/dashboard',
    icon: <DashboardOutlined />,
    label: <Link to="/dashboard">员工工作台</Link>,
  },
];

export default function AppLayout() {
  const { user, logout, isAdmin } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const items = isAdmin ? adminMenuItems : employeeMenuItems;

  let selectedKey = location.pathname;
  if (isAdmin && location.pathname.startsWith('/admin/users')) {
    selectedKey =
      location.pathname === '/admin/users/manage' ? '/admin/users/manage' : '/admin/users';
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={220} theme="dark">
        <div style={{ padding: 16, color: '#fff', fontWeight: 700, fontSize: 18 }}>ZJADS</div>
        <Menu theme="dark" mode="inline" selectedKeys={[selectedKey]} items={items} />
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
            {isAdmin ? '管理员后台 · 联盟数据采集与投放分析' : '联盟数据采集与投放分析'}
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
            )}{' '}
            退出
          </Typography.Link>
        </Header>
        <Content style={{ margin: 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
