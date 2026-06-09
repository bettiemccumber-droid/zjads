import { useEffect, useState } from 'react';
import { Button, Card, Form, Input, Modal, Select, Table, message } from 'antd';
import { api, type ApiResult } from '../../api/client';

interface UserRow {
  id: number;
  email: string;
  username: string;
  role: string;
  isActive: boolean;
}

/** 员工账号 CRUD（创建/启用） */
export default function AdminUserManagePage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const load = async () => {
    const { data } = await api.get<ApiResult<UserRow[]>>('/admin/users');
    if (data.success) setUsers(data.data);
  };

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    const values = await form.validateFields();
    const { data } = await api.post<ApiResult<UserRow>>('/admin/users', values);
    if (data.success) {
      message.success('员工已创建');
      setOpen(false);
      load();
    } else {
      message.error(data.message);
    }
  };

  const toggleActive = async (id: number, isActive: boolean) => {
    const { data } = await api.patch<ApiResult<unknown>>(`/admin/users/${id}/active`, { isActive });
    if (data.success) {
      message.success(isActive ? '已启用' : '已停用');
      load();
    }
  };

  return (
    <Card
      title="创建员工账号"
      extra={
        <Button type="primary" onClick={() => setOpen(true)}>
          新建员工
        </Button>
      }
    >
      <Table
        rowKey="id"
        dataSource={users.filter((u) => u.role !== 'ADMIN')}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 60 },
          { title: '用户名', dataIndex: 'username' },
          { title: '邮箱', dataIndex: 'email' },
          {
            title: '角色',
            dataIndex: 'role',
            render: (role: string) =>
              ({ ADMIN: '管理员', OPERATOR: '员工', VIEWER: '只读' })[role] ?? role,
          },
          {
            title: '状态',
            dataIndex: 'isActive',
            render: (v: boolean) => (v ? '启用' : '停用'),
          },
          {
            title: '操作',
            render: (_, r) => (
              <Button
                size="small"
                onClick={() => toggleActive(r.id, !r.isActive)}
              >
                {r.isActive ? '停用' : '启用'}
              </Button>
            ),
          },
        ]}
      />
      <Modal title="新建员工" open={open} onOk={create} onCancel={() => setOpen(false)}>
        <Form form={form} layout="vertical">
          <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label="邮箱" rules={[{ required: true, type: 'email' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="初始密码" rules={[{ required: true, min: 6 }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="role" label="角色" initialValue="OPERATOR" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'OPERATOR', label: '员工' },
                { value: 'VIEWER', label: '只读' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
