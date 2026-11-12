import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, Modal, Select, Space, Switch, Table, Tabs, Tag, message } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { api, type ApiResult } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { parseScopedViewUserId } from '../utils/team-scope.util';
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
  settlementPayeeName?: string;
  settlementBankAccount?: string;
  tokenPreview: string;
  isActive?: boolean;
  siteId?: number | null;
  siteName?: string | null;
  siteDomain?: string | null;
}

interface PublishSite {
  id: number;
  name: string;
  domain: string;
}

export default function ChannelAccountsPage() {
  const { user, isAdmin } = useAuth();
  const [searchParams] = useSearchParams();
  const scopeUserId = parseScopedViewUserId(user, isAdmin, searchParams.get('userId'));
  const scopeUsername =
    searchParams.get('username') ??
    user?.teamMembers?.find((m) => m.id === scopeUserId)?.username;
  const readOnlyMemberView = scopeUserId != null && user != null && scopeUserId !== user.id;
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [grouped, setGrouped] = useState<
    Array<{ platformCode: string; platformName: string; accounts: ChannelAccount[] }>
  >([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<ChannelAccount | null>(null);
  const [activePlatform, setActivePlatform] = useState<Platform | null>(null);
  const [form] = Form.useForm();
  const [importAccount, setImportAccount] = useState<ChannelAccount | null>(null);
  const [sites, setSites] = useState<PublishSite[]>([]);
  const [testId, setTestId] = useState<number | null>(null);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    const [pRes, aRes, siteRes] = await Promise.all([
      api.get<ApiResult<Platform[]>>('/platforms'),
      api.get<ApiResult<typeof grouped>>('/channel-accounts/by-platform', {
        params: scopeUserId != null ? { userId: scopeUserId } : undefined,
      }),
      api.get<ApiResult<PublishSite[]>>('/publish-sites'),
    ]);
    if (pRes.data.success) setPlatforms(pRes.data.data);
    if (aRes.data.success) setGrouped(aRes.data.data);
    if (siteRes.data.success) setSites(siteRes.data.data);
  }, [scopeUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openAdd = (platform: Platform) => {
    if (readOnlyMemberView) {
      message.info('查看组员账号时为只读');
      return;
    }
    if (user?.role === 'VIEWER') {
      message.warning('只读账号无法添加');
      return;
    }
    if (platform.collectorImplemented === false) {
      message.info(`${platform.name} 采集器尚未接入，可先配置账号，待上线后自动参与采集`);
    }
    setEditingAccount(null);
    setActivePlatform(platform);
    setTestId(null);
    form.resetFields();
    form.setFieldsValue({ platformId: platform.id, isActive: true });
    setModalOpen(true);
  };

  const openEdit = (account: ChannelAccount) => {
    if (readOnlyMemberView) {
      message.info('查看组员账号时为只读');
      return;
    }
    if (user?.role === 'VIEWER') {
      message.warning('只读账号无法修改');
      return;
    }
    const platform = platforms.find((p) => p.code === account.platformCode) ?? null;
    setEditingAccount(account);
    setActivePlatform(platform);
    setTestId(null);
    form.resetFields();
    form.setFieldsValue({
      displayName: account.displayName,
      externalChannelId: account.externalChannelId ?? '',
      affiliateAlias: account.affiliateAlias,
      settlementPayeeName: account.settlementPayeeName ?? '',
      settlementBankAccount: account.settlementBankAccount ?? '',
      siteId: account.siteId ?? undefined,
      isActive: account.isActive ?? true,
    });
    setModalOpen(true);
  };

  /**
   * 绑定或更换内容站前先测通 Key。编辑时 Key 留空则用已保存的 Key。
   */
  const testConnection = async () => {
    const platformId = editingAccount?.platformId ?? form.getFieldValue('platformId');
    const apiToken = String(form.getFieldValue('apiToken') ?? '').trim();
    if (!platformId) {
      message.error('请选择平台');
      return;
    }
    if (!apiToken && !editingAccount) {
      message.error('请填写 API Key');
      return;
    }
    setTesting(true);
    try {
      const res = await api.post<ApiResult<{ id: number; ok: boolean; message: string }>>('/channel-accounts/test', {
        platformId,
        apiToken,
        accountId: editingAccount?.id,
      });
      if (!res.data.success || !res.data.data?.ok) {
        setTestId(null);
        message.error(res.data.data?.message || res.data.message || '测试连接失败');
        return;
      }
      setTestId(res.data.data.id);
      message.success(res.data.data.message || '连接成功');
    } catch {
      setTestId(null);
      message.error('测试连接失败');
    } finally {
      setTesting(false);
    }
  };

  const onSubmit = async () => {
    const values = await form.validateFields();
    const nextSiteId = (values.siteId ?? null) as number | null;
    const previousSiteId = editingAccount?.siteId ?? null;
    const siteChanged = nextSiteId !== previousSiteId;
    if (nextSiteId != null && siteChanged && !testId) {
      message.error('绑定内容站前需要先测试连接');
      return;
    }

    if (editingAccount) {
      const payload: Record<string, unknown> = {
        displayName: values.displayName,
        externalChannelId: values.externalChannelId ?? '',
        affiliateAlias: values.affiliateAlias ?? '',
        settlementPayeeName: values.settlementPayeeName ?? '',
        settlementBankAccount: values.settlementBankAccount ?? '',
        isActive: values.isActive,
      };
      if (values.apiToken?.trim()) {
        payload.apiToken = values.apiToken.trim();
      }
      if (siteChanged) {
        payload.siteId = nextSiteId;
        if (testId) payload.testId = testId;
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

    const { data } = await api.post<ApiResult<ChannelAccount>>('/channel-accounts', {
      ...values,
      siteId: nextSiteId ?? undefined,
      testId: nextSiteId != null ? testId : undefined,
    });
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
              message={`${p.name} 订单采集开发中，账号可先保存；当前采集已支持 PartnerMatic、LinkHaitao、LinkBux、Rewardoo、UltraInfluence`}
            />
          ) : null}
          {p.code === 'linkbux' ? (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message="LinkBux 点击"
              description="日常采集仅更新区间最后一天的 API 点击。需与后台对齐时，请用「点击校准导入」——仅校准联盟点击数，不改订单与佣金。"
            />
          ) : null}
          {p.code === 'rewardoo' ? (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message="Rewardoo Performance"
              description="日常采集写入订单与佣金；「含联盟点击」不影响 RW（RW 不通过 API 拉点击）。与后台 Performance 的点击/订单不一致时，请用「Performance 校准导入」对齐点击与订单数（不改佣金，导入后采集不覆盖）。"
            />
          ) : null}
          {!readOnlyMemberView ? (
            <Button type="primary" style={{ marginBottom: 12 }} onClick={() => openAdd(p)}>
              添加 {p.name} 渠道
            </Button>
          ) : null}
          <Table
            rowKey="id"
            dataSource={accounts}
            columns={[
              { title: '显示名称', dataIndex: 'displayName' },
              { title: 'Channel ID', dataIndex: 'externalChannelId' },
              { title: '联盟序号', dataIndex: 'affiliateAlias' },
              {
                title: '结算收款人',
                dataIndex: 'settlementPayeeName',
                render: (v: string | undefined) => v?.trim() || '—',
              },
              {
                title: '内容站',
                dataIndex: 'siteDomain',
                render: (v: string | null | undefined, row: ChannelAccount) =>
                  v ? `${row.siteName ?? v} (${v})` : '未绑定',
              },
              {
                title: '收款卡号',
                dataIndex: 'settlementBankAccount',
                render: (v: string | undefined) => {
                  const s = v?.trim();
                  if (!s) return '—';
                  if (s.length <= 8) return s;
                  return `${s.slice(0, 4)}****${s.slice(-4)}`;
                },
              },
              { title: 'Token', dataIndex: 'tokenPreview' },
              {
                title: '状态',
                dataIndex: 'isActive',
                render: (v: boolean | undefined) => (v === false ? '已停用' : '启用'),
              },
              ...(readOnlyMemberView
                ? []
                : [
                    {
                      title: '操作',
                      render: (_: unknown, row: ChannelAccount) => (
                        <Space>
                          <Button size="small" onClick={() => openEdit(row)}>
                            编辑
                          </Button>
                          {p.code === 'linkbux' && user?.role !== 'VIEWER' ? (
                            <Button size="small" onClick={() => setImportAccount(row)}>
                              点击校准导入
                            </Button>
                          ) : null}
                          {p.code === 'rewardoo' && user?.role !== 'VIEWER' ? (
                            <Button size="small" onClick={() => setImportAccount(row)}>
                              Performance 校准导入
                            </Button>
                          ) : null}
                          <Button danger size="small" onClick={() => onDelete(row.id)}>
                            删除
                          </Button>
                        </Space>
                      ),
                    },
                  ]),
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
    <Card title={readOnlyMemberView ? `平台账号（${scopeUsername ?? scopeUserId}，只读）` : '我的平台账号'}>
      {readOnlyMemberView ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="组长只读查看：用于核对平台绑定与序号，无法修改组员 Token 或 Channel。"
        />
      ) : null}
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
        onCancel={() => setModalOpen(false)}
        destroyOnClose
        styles={{ body: { maxHeight: '60vh', overflowY: 'auto' } }}
        footer={[
          <Button key="cancel" onClick={() => setModalOpen(false)}>取消</Button>,
          <Button key="test" loading={testing} onClick={() => void testConnection()}>测试连接</Button>,
          <Button key="save" type="primary" onClick={() => void onSubmit()}>保存</Button>,
        ]}
      >
        <Form
          form={form}
          layout="vertical"
          onValuesChange={(changed) => {
            if ('apiToken' in changed || 'siteId' in changed) setTestId(null);
          }}
        >
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
            extra="须与 Google Ads 广告系列名中的序号一致，如 pm1、lh2、ui1"
          >
            <Input placeholder="如 lh2" />
          </Form.Item>
          <Form.Item
            name="settlementPayeeName"
            label="结算收款人"
            extra="月度结算报表「收款人」列；按本渠道账号展示"
          >
            <Input placeholder="真实姓名" maxLength={120} />
          </Form.Item>
          <Form.Item name="settlementBankAccount" label="收款卡号" extra="月度结算报表「收款卡号」列">
            <Input placeholder="银行卡号" maxLength={80} />
          </Form.Item>
          <Form.Item
            name="apiToken"
            label={isEdit ? 'API Key（留空不修改）' : 'API Key'}
            rules={isEdit ? [] : [{ required: true, message: '请填写 API Key' }]}
          >
            <Input.Password placeholder={isEdit ? '已保存，留空则不修改' : undefined} />
          </Form.Item>
          <Form.Item name="siteId" label="绑定站点" extra="内容站由管理员添加。选择后需先测试连接再保存。">
            <Select
              allowClear
              placeholder="选择内容站"
              options={sites.map((site) => ({ value: site.id, label: `${site.name} (${site.domain})` }))}
            />
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
          platformCode={importAccount.platformCode}
          onClose={() => setImportAccount(null)}
        />
      ) : null}
    </Card>
  );
}
