import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, Modal, Space, Table, Typography, message } from 'antd';
import { api, type ApiResult } from '../../api/client';

interface Site {
  id: number;
  name: string;
  domain: string;
  publishUrl: string;
  hasToken: boolean;
}

/**
 * 管理员维护内容站。员工在自己的投放页里绑定这些站点。
 */
export default function AdminPublishSitesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [editing, setEditing] = useState<Site | null>(null);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();

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
          onFinish={async (values: { name: string; domain: string; publishUrl?: string; token?: string }) => {
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
          <Form.Item name="publishUrl">
            <Input placeholder="https://www.example.com/api/posts" style={{ width: 280 }} />
          </Form.Item>
          <Form.Item name="token">
            <Input.Password placeholder="发布密钥" style={{ width: 180 }} />
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
            { title: '发布地址', dataIndex: 'publishUrl', ellipsis: true, render: (value: string) => value || '—' },
            { title: '密钥', dataIndex: 'hasToken', width: 90, render: (value: boolean) => (value ? '已设置' : '未设置') },
            {
              title: '操作',
              width: 80,
              render: (_: unknown, row: Site) => (
                <Button
                  type="link"
                  onClick={() => {
                    setEditing(row);
                    editForm.setFieldsValue({ publishUrl: row.publishUrl, token: '' });
                  }}
                >
                  设置接口
                </Button>
              ),
            },
          ]}
        />
      </Card>
      <Modal
        title={editing ? `设置接口：${editing.name}` : '设置接口'}
        open={editing != null}
        onCancel={() => setEditing(null)}
        onOk={() => void editForm.validateFields().then(async (values: { publishUrl?: string; token?: string }) => {
          if (!editing) return;
          const res = await api.patch<ApiResult<Site>>(`/publish-sites/${editing.id}`, values);
          if (!res.data.success) return message.error(res.data.message || '保存失败');
          message.success('内容站已更新');
          setEditing(null);
          await load();
        })}
        okText="保存"
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="publishUrl" label="发布地址" extra="文章会 POST 到这个地址。留空则只在本地保存。">
            <Input placeholder="https://www.example.com/api/posts" />
          </Form.Item>
          <Form.Item name="token" label="发布密钥" extra="留空表示不改原来的密钥。请求头是 Authorization: Bearer。">
            <Input.Password placeholder="已设置的密钥不会回显" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
