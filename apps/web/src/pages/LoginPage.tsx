import { Button, Card, Form, Input, message, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { api, setToken, type ApiResult } from '../api/client';
import { useAuth } from '../hooks/useAuth';

export default function LoginPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();

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
    } catch {
      message.error('登录失败，请检查邮箱和密码');
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%)',
      }}
    >
      <Card style={{ width: 400 }}>
        <Typography.Title level={3} style={{ textAlign: 'center' }}>
          ZJADS 工作台
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
          公司内部联盟数据采集与分析
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
  );
}
