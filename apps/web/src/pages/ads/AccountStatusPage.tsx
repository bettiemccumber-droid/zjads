import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, AutoComplete, Button, Card, Col, Form, Input, Row, Space, Statistic, Switch, Table, Tag, Tooltip, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { api, type ApiResult } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { formatCustomerId } from './ad-launch-settings';

interface AccountRow {
  id: string;
  mccCustomerId: string;
  mccLabel: string;
  customerId: string;
  googleStatus: string;
  availability: string;
  activeCampaignCount: number;
  updatedAt: string;
}

interface Board {
  live?: boolean;
  summary: { total: number; enabled: number; suspended: number; closed: number; unknown: number };
  rows: AccountRow[];
}

interface AdsSetup {
  appReady: boolean;
  hasEnvRefreshToken: boolean;
  hasEnvLoginCustomerId: boolean;
  apiVersion: string;
  missing: string[];
  connections: Array<{ id: number; mccCustomerId: string; loginCustomerId: string; hasRefreshToken: boolean; customerCount: number }>;
}

interface AdSource {
  id: number;
  name: string;
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

/**
 * 暂停、取消、关闭的子账号算异常，不能拿来投放。
 */
function isAbnormal(row: AccountRow) {
  return row.availability === 'disabled' || row.googleStatus === 'SUSPENDED' || row.googleStatus === 'CANCELED' || row.googleStatus === 'CLOSED';
}

/**
 * 当前员工名下的子账号。空闲和占用可以投放，禁用是异常。
 * 名单和「未回传」来自广告日报。接入 Google Ads API 时改成 MCC 当前子账号和真实账户状态。
 */
export default function AccountStatusPage() {
  const { user } = useAuth();
  const [form] = Form.useForm();
  const [board, setBoard] = useState<Board>({
    summary: { total: 0, enabled: 0, suspended: 0, closed: 0, unknown: 0 },
    rows: [],
  });
  const [setup, setSetup] = useState<AdsSetup | null>(null);
  const [sources, setSources] = useState<AdSource[]>([]);
  const [keyword, setKeyword] = useState('');
  const [abnormalOnly, setAbnormalOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [accounts, config, sourceList] = await Promise.all([
      api.get<ApiResult<Board>>('/google-ads/accounts'),
      api.get<ApiResult<AdsSetup>>('/google-ads/setup'),
      api.get<ApiResult<AdSource[]>>('/ad-sources'),
    ]);
    if (accounts.data.success) setBoard(accounts.data.data);
    if (config.data.success) setSetup(config.data.data);
    if (sourceList.data.success) setSources(sourceList.data.data);
  }, []);

  useEffect(() => {
    void load().catch(() => message.error('加载账户状态失败'));
  }, [load]);

  const abnormalCount = useMemo(() => board.rows.filter(isAbnormal).length, [board.rows]);
  const visibleRows = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return board.rows.filter((row) => {
      if (abnormalOnly && !isAbnormal(row)) return false;
      if (!query) return true;
      const owner = (user?.username ?? '').toLowerCase();
      const cid = formatCustomerId(row.customerId).toLowerCase();
      const mcc = (row.mccLabel || row.mccCustomerId).toLowerCase();
      return cid.includes(query) || row.customerId.includes(query) || mcc.includes(query) || owner.includes(query);
    });
  }, [abnormalOnly, board.rows, keyword, user?.username]);

  return (
    <>
      <Typography.Title level={4} style={{ marginTop: 0 }}>账户状态</Typography.Title>
      <Alert
        type={board.live ? 'success' : 'info'}
        showIcon
        style={{ marginBottom: 16 }}
        message={board.live
          ? '名单来自 Google Ads MCC 当前子账号。空闲和占用可以投放，禁用是异常。在投系列按接口里当前启用的系列计算。'
          : '空闲和占用的子账号可以投放，禁用的是异常。还没接上 Google Ads 时，在投系列按该 CID 最新一天里启用的系列计算，账户状态显示「未回传」。'}
      />
      <Card title="Google Ads API" style={{ marginBottom: 16 }}>
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
            message={`API ${setup?.apiVersion ?? 'v26'} 已就绪。${setup?.hasEnvRefreshToken ? '环境变量里已有刷新令牌。' : '刷新令牌请填在下面，或写入 GOOGLE_ADS_REFRESH_TOKEN。'}`}
          />
        )}
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values: { mccCustomerId: string; loginCustomerId?: string; refreshToken?: string }) => {
            setSaving(true);
            try {
              const saved = await api.post<ApiResult<unknown>>('/google-ads/connections', {
                mccCustomerId: values.mccCustomerId,
                loginCustomerId: values.loginCustomerId,
                refreshToken: values.refreshToken,
              });
              if (!saved.data.success) {
                message.error(saved.data.message || '保存失败');
                return;
              }
              const synced = await api.post<ApiResult<unknown>>('/google-ads/sync');
              if (!synced.data.success) {
                message.warning(synced.data.message || '已保存连接，同步失败');
              } else {
                message.success('已保存并同步子账号');
              }
              form.setFieldValue('refreshToken', '');
              await load();
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
              <Form.Item name="mccCustomerId" label="MCC" rules={[{ required: true, message: '选择或填写 MCC' }]} extra="选广告数据源，或直接填 10 位经理账号客户号">
                <AutoComplete
                  placeholder="选择数据源，或填写 1234567890"
                  options={[
                    ...sources.map((item) => ({ value: `s${item.id}`, label: item.name })),
                    ...(setup?.connections ?? [])
                      .filter((item) => !sources.some((source) => `s${source.id}` === item.mccCustomerId))
                      .map((item) => ({ value: item.mccCustomerId, label: item.loginCustomerId || item.mccCustomerId })),
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="loginCustomerId" label="Google 经理账号客户号" extra={setup?.hasEnvLoginCustomerId ? '留空则使用环境变量里的客户号' : '10 位数字，例如 123-456-7890'}>
                <Input placeholder="1234567890" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="refreshToken" label="刷新令牌" extra={setup?.hasEnvRefreshToken ? '留空则使用环境变量里的刷新令牌' : 'OAuth refresh token，只保存加密后的值'}>
                <Input.Password placeholder="留空表示不修改" autoComplete="new-password" />
              </Form.Item>
            </Col>
          </Row>
          <Button type="primary" htmlType="submit" loading={saving} disabled={setup != null && !setup.appReady}>保存并同步</Button>
        </Form>
      </Card>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card><Statistic title="账户点数" value={board.summary.total} /></Card></Col>
        <Col span={6}><Card><Statistic title="正常" value={board.summary.enabled} valueStyle={{ color: '#3f8600' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="已暂停" value={board.summary.suspended} valueStyle={{ color: '#cf1322' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="已取消/关闭" value={board.summary.closed} /></Card></Col>
      </Row>
      <Card>
        <Space style={{ marginBottom: 12 }} wrap>
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
          rowKey="id"
          size="small"
          pagination={{ pageSize: 20, showSizeChanger: false }}
          dataSource={visibleRows}
          columns={[
            {
              title: 'MCC',
              dataIndex: 'mccLabel',
              render: (value: string, row: AccountRow) => value || (row.mccCustomerId ? formatCustomerId(row.mccCustomerId) : '—'),
            },
            { title: '归属人', render: () => user?.username || '—' },
            { title: '账户 CID', dataIndex: 'customerId', render: (value: string) => formatCustomerId(value) },
            {
              title: 'Google 状态',
              dataIndex: 'googleStatus',
              render: (value: string) => <Tag color={value === 'ENABLED' ? 'success' : value === 'SUSPENDED' ? 'error' : 'default'}>{STATUS_LABEL[value] ?? value}</Tag>,
            },
            {
              title: '可用性',
              dataIndex: 'availability',
              render: (value: string) => {
                const item = AVAILABILITY[value];
                if (!item) return '—';
                return <Tooltip title={item.tip}><Tag color={item.color}>{item.label}</Tag></Tooltip>;
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
