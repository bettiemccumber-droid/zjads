import { Button, Card, Form, Input, message, Typography } from 'antd';
import axios from 'axios';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken, type ApiResult } from '../api/client';
import SiteFooter from '../components/SiteFooter';
import { useAuth } from '../hooks/useAuth';
import { setCanonical } from '../utils/canonical';

export default function LoginPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();

  useEffect(() => {
    document.title = 'Zhijun Ads Manager';
    setCanonical('/login');
  }, []);

  const onFinish = async (values: { email: string; password: string }) => {
    try {
      const { data } = await api.post<
        ApiResult<{ token: string; user: { username: string } }>
      >('/auth/login', values);
      if (!data.success) {
        message.error(data.message || '登录失败');
        return;
      }
      setToken(data.data.token);
      await refresh();
      message.success(`欢迎，${data.data.user.username}`);
      navigate('/dashboard');
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const raw = err.response?.data?.message;
        if (!err.response) {
          message.error('无法连接 API，请先启动后端：npm run dev:api');
        } else if (typeof raw === 'string') {
          message.error(raw);
        } else if (Array.isArray(raw)) {
          message.error(raw.join('；'));
        } else {
          message.error('登录失败，请检查邮箱和密码');
        }
      } else {
        message.error('登录失败，请检查邮箱和密码');
      }
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%)',
      }}
    >
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Card style={{ width: 400 }}>
          <Typography.Title level={3} style={{ textAlign: 'center' }}>
            Zhijun Ads Manager
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
            内部工作台，仅限本公司授权人员登录
          </Typography.Paragraph>
          <Form layout="vertical" onFinish={onFinish}>
            <Form.Item name="email" label="邮箱" rules={[{ required: true, type: 'email' }]}>
              <Input placeholder="admin@company.local" />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, min: 6 }]}>
              <Input.Password />
            </Form.Item>
            <Button type="primary" htmlType="submit" block>
              登录
            </Button>
          </Form>
        </Card>
      </div>
      <SiteFooter tone="dark" />
    </div>
  );
}
