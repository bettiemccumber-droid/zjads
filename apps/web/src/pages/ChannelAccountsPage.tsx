import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, Modal, Space, Switch, Table, Tabs, Tag, message } from 'antd';
import { api, type ApiResult } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { AffiliateClickImportModal } from '../components/AffiliateClickImportModal';

interface Platform {
  id: number;
  code: string;
  name: string;
  collectorImplemented?: boolean;
}

interface ChannelAccount {
  id: number;
  platformId?: number;
  platformCode: string;
  platformName: string;
  externalChannelId: string | null;
  displayName: string;
  affiliateAlias: string;
  tokenPreview: string;
  isActive?: boolean;
}

export default function ChannelAccountsPage() {
  const { user } = useAuth();
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [grouped, setGrouped] = useState<
    Array<{ platformCode: string; platformName: string; accounts: ChannelAccount[] }>
  >([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<ChannelAccount | null>(null);
  const [activePlatform, setActivePlatform] = useState<Platform | null>(null);
  const [form] = Form.useForm();
  const [importAccount, setImportAccount] = useState<ChannelAccount | null>(null);

  const load = async () => {
    const [pRes, aRes] = await Promise.all([
      api.get<ApiResult<Platform[]>>('/platforms'),
      api.get<ApiResult<typeof grouped>>('/channel-accounts/by-platform'),
    ]);
    if (pRes.data.success) setPlatforms(pRes.data.data);
    if (aRes.data.success) setGrouped(aRes.data.data);
  };

  useEffect(() => {
    load();
  }, []);

  const openAdd = (platform: Platform) => {
    if (user?.role === 'VIEWER') {
      message.warning('只读账号无法添加');
      return;
    }
    if (platform.collectorImplemented === false) {
      message.info(`${platform.name} 采集器尚未接入，可先配置账号，待上线后自动参与采集`);
    }
    setEditingAccount(null);
    setActivePlatform(platform);
    form.resetFields();
    form.setFieldsValue({ platformId: platform.id, isActive: true });
    setModalOpen(true);
  };

  const openEdit = (account: ChannelAccount) => {
    if (user?.role === 'VIEWER') {
      message.warning('只读账号无法修改');
      return;
    }
    const platform = platforms.find((p) => p.code === account.platformCode) ?? null;
    setEditingAccount(account);
    setActivePlatform(platform);
    form.resetFields();
    form.setFieldsValue({
      displayName: account.displayName,
      externalChannelId: account.externalChannelId ?? '',
      affiliateAlias: account.affiliateAlias,
      isActive: account.isActive ?? true,
    });
    setModalOpen(true);
  };

  const onSubmit = async () => {
    const values = await form.validateFields();

    if (editingAccount) {
      const payload: Record<string, unknown> = {
        displayName: values.displayName,
        externalChannelId: values.externalChannelId ?? '',
        affiliateAlias: values.affiliateAlias ?? '',
        isActive: values.isActive,
      };
      if (values.apiToken?.trim()) {
        payload.apiToken = values.apiToken.trim();
      }
      const { data } = await api.patch<ApiResult<ChannelAccount>>(
        `/channel-accounts/${editingAccount.id}`,
        payload,
      );
      if (data.success) {
        message.success('修改成功');
        setModalOpen(false);
        load();
      } else {
        message.error(data.message);
      }
      return;
    }

    const { data } = await api.post<ApiResult<ChannelAccount>>('/channel-accounts', values);
    if (data.success) {
      message.success('添加成功');
      setModalOpen(false);
      load();
    } else {
      message.error(data.message);
    }
  };

  const onDelete = async (id: number) => {
    const { data } = await api.delete<ApiResult<unknown>>(`/channel-accounts/${id}`);
    if (data.success) {
      message.success('已删除');
      load();
    }
  };

  const tabItems = platforms.map((p) => {
    const group = grouped.find((g) => g.platformCode === p.code);
    const accounts = group?.accounts ?? [];
    return {
      key: p.code,
      label: (
        <span>
          {p.name} ({accounts.length}){' '}
          {p.collectorImplemented === false ? (
            <Tag color="default" style={{ marginLeft: 4 }}>
              未接入
            </Tag>
          ) : (
            <Tag color="success" style={{ marginLeft: 4 }}>
              已接入
            </Tag>
          )}
        </span>
      ),
      children: (
        <>
          {p.collectorImplemented === false ? (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message={`${p.name} 订单采集开发中，账号可先保存；当前采集仅支持 PartnerMatic、LinkHaitao、LinkBux`}
            />
          ) : null}
          {p.code === 'linkbux' ? (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message="LinkBux 点击"
              description="日常采集仅更新区间最后一天的 API 点击；历史或需与后台对齐的数据请用「点击校准导入」。"
            />
          ) : null}
          <Button type="primary" style={{ marginBottom: 12 }} onClick={() => openAdd(p)}>
            添加 {p.name} 渠道
          </Button>
          <Table
            rowKey="id"
            dataSource={accounts}
            columns={[
              { title: '显示名称', dataIndex: 'displayName' },
              { title: 'Channel ID', dataIndex: 'externalChannelId' },
              { title: '联盟序号', dataIndex: 'affiliateAlias' },
              { title: 'Token', dataIndex: 'tokenPreview' },
              {
                title: '状态',
                dataIndex: 'isActive',
                render: (v: boolean | undefined) => (v === false ? '已停用' : '启用'),
              },
              {
                title: '操作',
                render: (_, row) => (
                  <Space>
                    <Button size="small" onClick={() => openEdit(row)}>
                      编辑
                    </Button>
                    {p.code === 'linkbux' && user?.role !== 'VIEWER' ? (
                      <Button size="small" onClick={() => setImportAccount(row)}>
                        点击校准导入
                      </Button>
                    ) : null}
                    <Button danger size="small" onClick={() => onDelete(row.id)}>
                      删除
                    </Button>
                  </Space>
                ),
              },
            ]}
            pagination={false}
          />
        </>
      ),
    };
  });

  const isPm = activePlatform?.code === 'partnermatic';
  const isEdit = !!editingAccount;

  return (
    <Card title="我的平台账号">
      <p style={{ color: '#666' }}>
        请按平台分别添加 API Token 与 Channel ID；同一平台同一 Channel 不可重复。
        联盟序号需与广告系列名一致（如 lh2），可直接编辑修改，无需删除重建。
      </p>
      <Tabs items={tabItems} />
      <Modal
        title={
          isEdit
            ? `编辑 ${editingAccount?.platformName ?? ''} 账号`
            : activePlatform
              ? `添加 ${activePlatform.name}`
              : '添加账号'
        }
        open={modalOpen}
        onOk={onSubmit}
        onCancel={() => setModalOpen(false)}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          {!isEdit && (
            <Form.Item name="platformId" hidden>
              <Input />
            </Form.Item>
          )}
          <Form.Item name="displayName" label="显示名称" rules={[{ required: true }]}>
            <Input placeholder="如 PM-主渠道" />
          </Form.Item>
          {isPm && (
            <Form.Item
              name="externalChannelId"
              label="Channel ID"
              rules={[{ required: !isEdit, message: '请填写 Channel ID' }]}
            >
              <Input placeholder="如 PM08026591" />
            </Form.Item>
          )}
          {!isPm && (
            <Form.Item name="externalChannelId" label="Channel ID（可选）">
              <Input />
            </Form.Item>
          )}
          <Form.Item
            name="affiliateAlias"
            label="联盟序号"
            extra="须与 Google Ads 广告系列名中的序号一致，如 pm1、lh2"
          >
            <Input placeholder="如 lh2" />
          </Form.Item>
          <Form.Item
            name="apiToken"
            label={isEdit ? 'API Token（留空不修改）' : 'API Token'}
            rules={isEdit ? [] : [{ required: true, message: '请填写 API Token' }]}
          >
            <Input.Password placeholder={isEdit ? '不修改请留空' : undefined} />
          </Form.Item>
          {isEdit && (
            <Form.Item name="isActive" label="启用" valuePropName="checked">
              <Switch checkedChildren="启用" unCheckedChildren="停用" />
            </Form.Item>
          )}
        </Form>
      </Modal>
      {importAccount ? (
        <AffiliateClickImportModal
          open
          accountId={importAccount.id}
          accountLabel={`${importAccount.displayName} (${importAccount.affiliateAlias})`}
          onClose={() => setImportAccount(null)}
        />
      ) : null}
    </Card>
  );
}
