import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Form, Input, Popconfirm, Row, Select, Space, Statistic, Switch, Table, Tag, Tooltip, Typography, message } from 'antd';
import { DeleteOutlined, PlusOutlined, ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import { api, type ApiResult } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { formatCustomerId } from './ad-launch-settings';

interface AccountRow {
  id: string;
  mccCustomerId: string;
  mccLabel: string;
  customerId: string;
  googleStatus: string;
  verificationStatus?: string;
  availability: string;
  activeCampaignCount: number;
  updatedAt: string;
}

interface Board {
  live?: boolean;
  summary: { total: number; enabled: number; suspended: number; closed: number; unknown: number };
  rows: AccountRow[];
}

interface AdsConnection {
  id: number;
  mccCustomerId: string;
  loginCustomerId: string;
  hasRefreshToken: boolean;
  customerCount: number;
}

interface AdsSetup {
  appReady: boolean;
  hasEnvRefreshToken: boolean;
  hasEnvLoginCustomerId: boolean;
  apiVersion: string;
  missing: string[];
  connections: AdsConnection[];
}

interface SyncResult {
  connections: Array<{ mccCustomerId: string; loginCustomerId: string; customerCount: number }>;
  failed: Array<{ mccCustomerId: string; message: string }>;
}

const AVAILABILITY: Record<string, { label: string; color: string; tip: string }> = {
  disabled: { label: '禁用', color: 'error', tip: '账户已暂停、取消或关闭' },
  occupied: { label: '占用', color: 'processing', tip: '有在投系列' },
  idle: { label: '空闲', color: 'success', tip: '没有在投系列' },
};

const STATUS_LABEL: Record<string, string> = {
  ENABLED: '已启用',
  SUSPENDED: '已暂停',
  CANCELED: '已取消',
  CLOSED: '已关闭',
  UNKNOWN: '未回传',
};

const VERIFICATION_LABEL: Record<string, { label: string; color: string }> = {
  NOT_REQUIRED: { label: '无需验证', color: 'default' },
  SUCCESS: { label: '已通过', color: 'success' },
  PENDING_USER_ACTION: { label: '待验证', color: 'error' },
  PENDING_REVIEW: { label: '审核中', color: 'processing' },
  FAILURE: { label: '验证失败', color: 'error' },
  API_UNAVAILABLE: { label: '需人工标记', color: 'warning' },
  UNKNOWN: { label: '未检测', color: 'default' },
};

function isAbnormal(row: AccountRow) {
  return (
    row.availability === 'disabled'
    || row.googleStatus === 'SUSPENDED'
    || row.googleStatus === 'CANCELED'
    || row.googleStatus === 'CLOSED'
    || row.verificationStatus === 'PENDING_USER_ACTION'
    || row.verificationStatus === 'FAILURE'
  );
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, '');
}

/**
 * 同一员工可挂多个 MCC。列表支持按 MCC 筛选；连接可单独同步或全部同步。
 */
export default function AccountStatusPage() {
  const { user } = useAuth();
  const [form] = Form.useForm();
  const [board, setBoard] = useState<Board>({
    summary: { total: 0, enabled: 0, suspended: 0, closed: 0, unknown: 0 },
    rows: [],
  });
  const [setup, setSetup] = useState<AdsSetup | null>(null);
  const [keyword, setKeyword] = useState('');
  const [mccFilter, setMccFilter] = useState<string>('all');
  const [abnormalOnly, setAbnormalOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncingMcc, setSyncingMcc] = useState<string | null>(null);
  const [verificationText, setVerificationText] = useState('');
  const [markingVerification, setMarkingVerification] = useState(false);

  const load = useCallback(async () => {
    const [accounts, config] = await Promise.all([
      api.get<ApiResult<Board>>('/google-ads/accounts'),
      api.get<ApiResult<AdsSetup>>('/google-ads/setup'),
    ]);
    if (accounts.data.success) setBoard(accounts.data.data);
    if (config.data.success) setSetup(config.data.data);
  }, []);

  useEffect(() => {
    void load().catch(() => message.error('加载账户状态失败'));
  }, [load]);

  const mccOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const connection of setup?.connections ?? []) {
      if (connection.mccCustomerId) ids.add(connection.mccCustomerId);
    }
    for (const row of board.rows) {
      if (row.mccCustomerId) ids.add(row.mccCustomerId);
    }
    return [...ids].sort();
  }, [board.rows, setup?.connections]);

  const filteredRows = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return board.rows.filter((row) => {
      if (mccFilter !== 'all' && row.mccCustomerId !== mccFilter) return false;
      if (abnormalOnly && !isAbnormal(row)) return false;
      if (!query) return true;
      const owner = (user?.username ?? '').toLowerCase();
      const cid = formatCustomerId(row.customerId).toLowerCase();
      const mcc = (row.mccLabel || row.mccCustomerId).toLowerCase();
      return cid.includes(query) || row.customerId.includes(query) || mcc.includes(query) || owner.includes(query);
    });
  }, [abnormalOnly, board.rows, keyword, mccFilter, user?.username]);

  const filteredSummary = useMemo(() => ({
    total: filteredRows.length,
    enabled: filteredRows.filter((row) => row.googleStatus === 'ENABLED').length,
    suspended: filteredRows.filter((row) => row.googleStatus === 'SUSPENDED').length,
    closed: filteredRows.filter((row) => row.googleStatus === 'CANCELED' || row.googleStatus === 'CLOSED').length,
  }), [filteredRows]);

  const abnormalCount = useMemo(() => filteredRows.filter(isAbnormal).length, [filteredRows]);

  const reportSync = (result: SyncResult) => {
    const okCount = result.connections.length;
    const failCount = result.failed?.length ?? 0;
    if (failCount) {
      message.warning(
        `已同步 ${okCount} 个 MCC；失败 ${failCount} 个：${result.failed.map((item) => `${item.mccCustomerId}（${item.message}）`).join('；')}`,
      );
      return;
    }
    const totalKids = result.connections.reduce((sum, item) => sum + item.customerCount, 0);
    message.success(`已同步 ${okCount} 个 MCC，共 ${totalKids} 个子账号`);
  };

  const syncConnections = async (mccCustomerId?: string) => {
    const synced = await api.post<ApiResult<SyncResult>>('/google-ads/sync', mccCustomerId ? { mccCustomerId } : {});
    if (!synced.data.success) {
      message.error(synced.data.message || '同步失败');
      return;
    }
    reportSync(synced.data.data);
    await load();
  };

  const removeConnection = async (mccCustomerId: string) => {
    const removed = await api.delete<ApiResult<unknown>>(
      `/google-ads/connections/${encodeURIComponent(mccCustomerId)}`,
    );
    if (!removed.data.success) {
      message.error(removed.data.message || '删除失败');
      return;
    }
    message.success(`已删除 ${formatCustomerId(mccCustomerId)}`);
    if (mccFilter === mccCustomerId) setMccFilter('all');
    await load();
  };

  return (
    <>
      <Typography.Title level={4} style={{ marginTop: 0 }}>账户状态</Typography.Title>
      <Alert
        type={board.live ? 'success' : 'info'}
        showIcon
        style={{ marginBottom: 16 }}
        message={board.live
          ? '名单来自已连接的 Google Ads MCC。信用卡结算账号 API 读不到广告客户验证，请把验证中心里「已暂停」的 CID 粘贴下方标记为待验证，避免误投放。'
          : '空闲和占用的子账号可以投放，禁用的是异常。还没接上 Google Ads 时，在投系列按该 CID 最新一天里启用的系列计算，账户状态显示「未回传」。'}
      />
      <Card title="Google Ads MCC" style={{ marginBottom: 16 }}>
        {setup && !setup.appReady ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message={`服务器还缺这些环境变量：${setup.missing.join('、')}。配好后重启 API。`}
          />
        ) : (
          <Alert
            type="success"
            showIcon
            style={{ marginBottom: 12 }}
            message={`API ${setup?.apiVersion ?? 'v26'} 已就绪。${setup?.hasEnvRefreshToken ? '默认使用环境变量里的刷新令牌；某个 MCC 需要另一套令牌时可单独填写。' : '请在下方或环境变量中配置刷新令牌。'}`}
          />
        )}

        <Table
          rowKey="id"
          size="small"
          pagination={false}
          style={{ marginBottom: 16 }}
          locale={{ emptyText: '还没有 MCC。在下方添加 10 位经理账号客户号后同步。' }}
          dataSource={setup?.connections ?? []}
          columns={[
            {
              title: 'MCC',
              dataIndex: 'mccCustomerId',
              render: (value: string) => formatCustomerId(value),
            },
            {
              title: '登录客户号',
              dataIndex: 'loginCustomerId',
              render: (value: string, row: AdsConnection) => formatCustomerId(value || row.mccCustomerId),
            },
            {
              title: '子账号',
              dataIndex: 'customerCount',
            },
            {
              title: '令牌',
              dataIndex: 'hasRefreshToken',
              render: (value: boolean) => (value ? '本条已存' : setup?.hasEnvRefreshToken ? '用环境变量' : '缺失'),
            },
            {
              title: '操作',
              render: (_: unknown, row: AdsConnection) => (
                <Space>
                  <Button
                    size="small"
                    icon={<SyncOutlined />}
                    loading={syncingMcc === row.mccCustomerId}
                    disabled={setup != null && !setup.appReady}
                    onClick={() => {
                      setSyncingMcc(row.mccCustomerId);
                      void syncConnections(row.mccCustomerId)
                        .catch((err) => {
                          const apiMessage = (err as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
                          message.error(Array.isArray(apiMessage) ? apiMessage.join('；') : apiMessage || '同步失败');
                        })
                        .finally(() => setSyncingMcc(null));
                    }}
                  >
                    同步
                  </Button>
                  <Popconfirm
                    title={`删除 MCC ${formatCustomerId(row.mccCustomerId)}？`}
                    description="会删掉这条连接和已同步的子账号列表，不影响 Google Ads 本身。"
                    okText="删除"
                    cancelText="取消"
                    onConfirm={() => removeConnection(row.mccCustomerId).catch((err) => {
                      const apiMessage = (err as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
                      message.error(Array.isArray(apiMessage) ? apiMessage.join('；') : apiMessage || '删除失败');
                    })}
                  >
                    <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />

        <Space style={{ marginBottom: 16 }}>
          <Button
            icon={<SyncOutlined />}
            loading={syncingAll}
            disabled={!setup?.connections?.length || (setup != null && !setup.appReady)}
            onClick={() => {
              setSyncingAll(true);
              void syncConnections()
                .catch((err) => {
                  const apiMessage = (err as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
                  message.error(Array.isArray(apiMessage) ? apiMessage.join('；') : apiMessage || '同步失败');
                })
                .finally(() => setSyncingAll(false));
            }}
          >
            同步全部 MCC
          </Button>
        </Space>

        <Typography.Text strong>添加 / 更新 MCC</Typography.Text>
        <Form
          form={form}
          layout="vertical"
          style={{ marginTop: 8 }}
          onFinish={async (values: { mccCustomerId: string; loginCustomerId?: string; refreshToken?: string }) => {
            setSaving(true);
            try {
              const mcc = digitsOnly(values.mccCustomerId);
              const login = digitsOnly(values.loginCustomerId || '') || mcc;
              const saved = await api.post<ApiResult<unknown>>('/google-ads/connections', {
                mccCustomerId: mcc,
                loginCustomerId: login,
                refreshToken: values.refreshToken,
              });
              if (!saved.data.success) {
                message.error(saved.data.message || '保存失败');
                return;
              }
              await syncConnections(mcc);
              form.resetFields();
            } catch (err) {
              const apiMessage = (err as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
              message.error(Array.isArray(apiMessage) ? apiMessage.join('；') : apiMessage || '保存失败');
            } finally {
              setSaving(false);
            }
          }}
        >
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item
                name="mccCustomerId"
                label="MCC 客户号"
                rules={[
                  { required: true, message: '填写经理账号客户号' },
                  {
                    validator: async (_, value) => {
                      const digits = digitsOnly(String(value || ''));
                      if (digits.length < 6) throw new Error('请填写 Google 经理账号客户号');
                    },
                  },
                ]}
                extra="只填 10 位数字，例如 520-616-2115。可添加多个。"
              >
                <Input placeholder="5206162115" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="loginCustomerId"
                label="登录客户号（可选）"
                extra="一般与 MCC 相同，可留空。只有从上级 MCC 登录时才需要另填。"
              >
                <Input placeholder="默认等于 MCC" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="refreshToken"
                label="刷新令牌（可选）"
                extra={setup?.hasEnvRefreshToken ? '留空则用环境变量；该 MCC 需另一邮箱授权时再填' : 'OAuth refresh token'}
              >
                <Input.Password placeholder="留空表示用环境变量" autoComplete="new-password" />
              </Form.Item>
            </Col>
          </Row>
          <Button type="primary" htmlType="submit" icon={<PlusOutlined />} loading={saving} disabled={setup != null && !setup.appReady}>
            保存并同步此 MCC
          </Button>
        </Form>

        <Typography.Text strong style={{ display: 'block', marginTop: 24 }}>广告客户验证标记</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          从 Google Ads 验证中心复制已暂停 / 待验证的 CID（可带横杠），粘贴后标记。标记后可用性会变成禁用，不会拿来自动上广告。
        </Typography.Paragraph>
        <Input.TextArea
          rows={3}
          value={verificationText}
          onChange={(event) => setVerificationText(event.target.value)}
          placeholder={'例如：\n580-633-8631\n462-545-9445'}
        />
        <Space style={{ marginTop: 8 }}>
          <Button
            danger
            loading={markingVerification}
            disabled={!verificationText.trim()}
            onClick={() => {
              const customerIds = verificationText.split(/[\s,;，；]+/).map((item) => item.trim()).filter(Boolean);
              setMarkingVerification(true);
              void api
                .post<ApiResult<{ updated: number }>>('/google-ads/verification-flags', {
                  customerIds,
                  status: 'PENDING_USER_ACTION',
                })
                .then(async (res) => {
                  if (!res.data.success) {
                    message.error(res.data.message || '标记失败');
                    return;
                  }
                  message.success(res.data.message || `已标记 ${res.data.data.updated} 个`);
                  setVerificationText('');
                  await load();
                })
                .catch((err) => {
                  const apiMessage = (err as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
                  message.error(Array.isArray(apiMessage) ? apiMessage.join('；') : apiMessage || '标记失败');
                })
                .finally(() => setMarkingVerification(false));
            }}
          >
            标记为待验证
          </Button>
          <Button
            loading={markingVerification}
            disabled={!verificationText.trim()}
            onClick={() => {
              const customerIds = verificationText.split(/[\s,;，；]+/).map((item) => item.trim()).filter(Boolean);
              setMarkingVerification(true);
              void api
                .post<ApiResult<{ updated: number }>>('/google-ads/verification-flags', {
                  customerIds,
                  status: 'CLEAR',
                })
                .then(async (res) => {
                  if (!res.data.success) {
                    message.error(res.data.message || '清除失败');
                    return;
                  }
                  message.success(res.data.message || `已清除 ${res.data.data.updated} 个`);
                  setVerificationText('');
                  await load();
                })
                .catch((err) => {
                  const apiMessage = (err as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
                  message.error(Array.isArray(apiMessage) ? apiMessage.join('；') : apiMessage || '清除失败');
                })
                .finally(() => setMarkingVerification(false));
            }}
          >
            清除标记
          </Button>
        </Space>
      </Card>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card><Statistic title="账户点数" value={filteredSummary.total} /></Card></Col>
        <Col span={6}><Card><Statistic title="正常" value={filteredSummary.enabled} valueStyle={{ color: '#3f8600' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="已暂停" value={filteredSummary.suspended} valueStyle={{ color: '#cf1322' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="已取消/关闭" value={filteredSummary.closed} /></Card></Col>
      </Row>

      <Card>
        <Space style={{ marginBottom: 12 }} wrap>
          <Select
            style={{ width: 220 }}
            value={mccFilter}
            onChange={setMccFilter}
            options={[
              { value: 'all', label: '全部 MCC' },
              ...mccOptions.map((id) => ({ value: id, label: formatCustomerId(id) })),
            ]}
          />
          <Input.Search
            allowClear
            placeholder="CID / MCC / 归属人"
            style={{ width: 280 }}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <span>只看异常</span>
          <Switch checked={abnormalOnly} onChange={setAbnormalOnly} />
          <Tag>{abnormalCount} 个异常</Tag>
          <Button
            icon={<ReloadOutlined />}
            loading={refreshing}
            onClick={() => {
              setRefreshing(true);
              void load().catch(() => message.error('刷新失败')).finally(() => setRefreshing(false));
            }}
          >
            刷新
          </Button>
        </Space>
        <Table
          rowKey={(row) => `${row.mccCustomerId}-${row.customerId}`}
          size="small"
          pagination={{ pageSize: 20, showSizeChanger: false }}
          dataSource={filteredRows}
          columns={[
            {
              title: 'MCC',
              dataIndex: 'mccCustomerId',
              render: (value: string) => (value ? formatCustomerId(value) : '—'),
            },
            { title: '归属人', render: () => user?.username || '—' },
            { title: '账户 CID', dataIndex: 'customerId', render: (value: string) => formatCustomerId(value) },
            {
              title: 'Google 状态',
              dataIndex: 'googleStatus',
              render: (value: string) => <Tag color={value === 'ENABLED' ? 'success' : value === 'SUSPENDED' ? 'error' : 'default'}>{STATUS_LABEL[value] ?? value}</Tag>,
            },
            {
              title: '客户验证',
              dataIndex: 'verificationStatus',
              render: (value: string | undefined) => {
                const item = VERIFICATION_LABEL[value || 'UNKNOWN'] ?? VERIFICATION_LABEL.UNKNOWN;
                return <Tag color={item.color}>{item.label}</Tag>;
              },
            },
            {
              title: '可用性',
              dataIndex: 'availability',
              render: (value: string, row: AccountRow) => {
                const item = AVAILABILITY[value];
                if (!item) return '—';
                const tip =
                  row.verificationStatus === 'PENDING_USER_ACTION' || row.verificationStatus === 'FAILURE'
                    ? '广告客户验证未完成或失败，不能投放'
                    : item.tip;
                return <Tooltip title={tip}><Tag color={item.color}>{item.label}</Tag></Tooltip>;
              },
            },
            { title: '在投系列', dataIndex: 'activeCampaignCount' },
            { title: '最近同步', dataIndex: 'updatedAt', render: (value: string) => value?.replace('T', ' ').slice(0, 10) || '—' },
          ]}
        />
      </Card>
    </>
  );
}
