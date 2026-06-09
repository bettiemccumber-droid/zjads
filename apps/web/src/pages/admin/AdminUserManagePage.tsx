import { useEffect, useState } from 'react';
import { Button, Card, Form, Input, Modal, Select, Space, Table, message } from 'antd';
import { api, type ApiResult } from '../../api/client';

interface UserRow {
  id: number;
  email: string;
  username: string;
  role: string;
  isActive: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: '管理员',
  OPERATOR: '员工',
  VIEWER: '只读',
};

/** 员工账号管理（创建 / 编辑 / 启用停用） */
export default function AdminUserManagePage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form] = Form.useForm();

  const load = async () => {
    const { data } = await api.get<ApiResult<UserRow[]>>('/admin/users');
    if (data.success) setUsers(data.data);
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ role: 'OPERATOR' });
    setOpen(true);
  };

  const openEdit = (row: UserRow) => {
    setEditing(row);
    form.setFieldsValue({
      username: row.username,
      email: row.email,
      role: row.role,
    });
    setOpen(true);
  };

  const closeModal = () => {
    setOpen(false);
    setEditing(null);
    form.resetFields();
  };

  const submit = async () => {
    const values = await form.validateFields();
    if (editing) {
      const payload: Record<string, string> = {
        username: values.username,
        email: values.email,
        role: values.role,
      };
      if (values.password) payload.password = values.password;
      const { data } = await api.patch<ApiResult<UserRow>>(`/admin/users/${editing.id}`, payload);
      if (data.success) {
        message.success('员工信息已更新');
        closeModal();
        load();
      } else {
        message.error(data.message);
      }
      return;
    }

    const { data } = await api.post<ApiResult<UserRow>>('/admin/users', values);
    if (data.success) {
      message.success('员工已创建');
      closeModal();
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
      title="员工账号管理"
      extra={
        <Button type="primary" onClick={openCreate}>
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
            render: (role: string) => ROLE_LABELS[role] ?? role,
          },
          {
            title: '状态',
            dataIndex: 'isActive',
            render: (v: boolean) => (v ? '启用' : '停用'),
          },
          {
            title: '操作',
            render: (_, r) => (
              <Space>
                <Button size="small" onClick={() => openEdit(r)}>
                  编辑
                </Button>
                <Button size="small" onClick={() => toggleActive(r.id, !r.isActive)}>
                  {r.isActive ? '停用' : '启用'}
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title={editing ? '编辑员工' : '新建员工'}
        open={open}
        onOk={submit}
        onCancel={closeModal}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label="邮箱" rules={[{ required: true, type: 'email' }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="password"
            label={editing ? '新密码（留空则不修改）' : '初始密码'}
            rules={editing ? [{ min: 6, message: '密码至少 6 位' }] : [{ required: true, min: 6 }]}
          >
            <Input.Password placeholder={editing ? '不修改请留空' : undefined} />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true }]}>
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
