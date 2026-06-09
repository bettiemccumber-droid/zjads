import { Card, Col, Row, Typography } from 'antd';
import { Link } from 'react-router-dom';
import {
  TeamOutlined,
  BarChartOutlined,
  SyncOutlined,
  DashboardOutlined,
} from '@ant-design/icons';

const modules = [
  {
    key: 'users',
    title: '用户管理',
    desc: '查看全员平台账号、订单与佣金，下钻员工工作台',
    icon: <TeamOutlined style={{ fontSize: 32, color: '#1677ff' }} />,
    to: '/admin/users',
  },
  {
    key: 'stats',
    title: '平台统计',
    desc: '全公司用户、订单、广告费与 ROI 汇总',
    icon: <BarChartOutlined style={{ fontSize: 32, color: '#52c41a' }} />,
    to: '/admin/stats',
  },
  {
    key: 'sync',
    title: '数据采集中心',
    desc: '批量采集联盟订单、导入全员 Google Sheet',
    icon: <SyncOutlined style={{ fontSize: 32, color: '#722ed1' }} />,
    to: '/admin/sync',
  },
  {
    key: 'legacy',
    title: '员工工作台',
    desc: '进入普通数据采集页（员工自用视角）',
    icon: <DashboardOutlined style={{ fontSize: 32, color: '#fa8c16' }} />,
    to: '/dashboard',
  },
];

export default function AdminHomePage() {
  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        管理员中心
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        无需重复配置平台账号：员工维护 Token 与 Sheet，管理员在此查看汇总、批量采集与下钻明细。
      </Typography.Paragraph>
      <Row gutter={[16, 16]}>
        {modules.map((m) => (
          <Col xs={24} sm={12} lg={6} key={m.key}>
            <Link to={m.to} style={{ textDecoration: 'none' }}>
              <Card hoverable style={{ height: '100%' }}>
                <div style={{ marginBottom: 12 }}>{m.icon}</div>
                <Typography.Title level={5} style={{ margin: '0 0 8px' }}>
                  {m.title}
                </Typography.Title>
                <Typography.Text type="secondary">{m.desc}</Typography.Text>
              </Card>
            </Link>
          </Col>
        ))}
      </Row>
    </div>
  );
}
