import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, Space, Table, Typography, message } from 'antd';
import { api, type ApiResult } from '../../api/client';

interface Site {
  id: number;
  name: string;
  domain: string;
}

/**
 * 管理员维护内容站。员工在自己的投放页里绑定这些站点。
 */
export default function AdminPublishSitesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    const res = await api.get<ApiResult<Site[]>>('/publish-sites');
    if (res.data.success) setSites(res.data.data);
  }, []);

  useEffect(() => {
    void load().catch(() => message.error('加载内容站失败'));
  }, [load]);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>内容站</Typography.Title>
      <Alert
        type="info"
        showIcon
        message="这里只添加内容站。员工登录后，在自己的投放页里把联盟账号绑到这些站点上。"
      />
      <Card size="small">
        <Form
          form={form}
          layout="inline"
          onFinish={async (values: { name: string; domain: string }) => {
            const res = await api.post<ApiResult<Site>>('/publish-sites', values);
            if (!res.data.success) return message.error(res.data.message || '添加失败');
            message.success('内容站已添加');
            form.resetFields();
            await load();
          }}
        >
          <Form.Item name="name" rules={[{ required: true, message: '填写名称' }]}>
            <Input placeholder="Blivio" />
          </Form.Item>
          <Form.Item name="domain" rules={[{ required: true, message: '填写域名' }]}>
            <Input placeholder="blivio.com" />
          </Form.Item>
          <Button type="primary" htmlType="submit">添加</Button>
        </Form>
        <Table
          style={{ marginTop: 12 }}
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={sites}
          columns={[
            { title: '名称', dataIndex: 'name' },
            { title: '域名', dataIndex: 'domain' },
          ]}
        />
      </Card>
    </Space>
  );
}
