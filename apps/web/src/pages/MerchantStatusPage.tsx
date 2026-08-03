import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Input,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Upload,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { UploadOutlined } from '@ant-design/icons';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type ApiResult } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { exportMerchantStatusExcel } from '../utils/exportMerchantStatusExcel';
import { parseMerchantStatusImport } from '../utils/parseMerchantStatusImport';
import { adminDefaultDateRange } from '../utils/date-range.util';

interface QueryableAccount {
  id: number;
  displayName: string;
  affiliateAlias: string;
  platformCode: string;
  platformName: string;
  statusQuerySupported: boolean;
}

interface MerchantQueryItem {
  merchantId?: string;
  mcid?: string;
  domain?: string;
}

interface MerchantStatusRow {
  queryKey: string;
  merchantId: string | null;
  mcid: string | null;
  merchantName: string | null;
  siteUrl: string | null;
  platformCode: string;
  platformName: string;
  channelAccountId: number;
  channelDisplayName: string;
  affiliateAlias: string;
  ownerUserId: number;
  ownerUsername: string;
  relationshipStatus: string;
  relationshipRaw: string | null;
  merchantAvailability: string;
  availabilityRaw: string | null;
  actionable: boolean;
  actionLabel: string;
  queriedAt: string;
  error: string | null;
}

interface SummaryCounts {
  total: number;
  actionable: number;
  pending: number;
  rejected: number;
  notJoined: number;
  notFound: number;
  offline: number;
  unknown: number;
  failed: number;
}

interface PlatformPassSummary {
  platformCode: string;
  platformName: string;
  passed: number;
  pending: number;
  notPassed: number;
  failed: number;
}

interface UserPassSummary {
  userId: number;
  username: string;
  byPlatform: PlatformPassSummary[];
  totalPassed: number;
}

interface EmployeeOption {
  id: number;
  username: string;
}

const ACTION_COLOR: Record<string, string> = {
  可投: 'green',
  待审核: 'gold',
  未加入: 'default',
  无商家: 'default',
  已拒绝: 'red',
  商家已下架: 'orange',
  状态未知: 'purple',
  查询失败: 'red',
};

const RELATIONSHIP_LABEL: Record<string, string> = {
  joined: '已加入',
  pending: '审核中',
  rejected: '已拒绝',
  not_joined: '未加入',
  not_found: '—',
  unknown: '未知',
};

const AVAILABILITY_LABEL: Record<string, string> = {
  online: '上架',
  offline: '下架',
  unknown: '未知',
};

export default function MerchantStatusPage() {
  const { isAdmin } = useAuth();
  const [searchParams] = useSearchParams();
  const viewUserId = isAdmin && searchParams.get('userId') ? parseInt(searchParams.get('userId')!, 10) : undefined;
  const viewUsername = searchParams.get('username') ?? (viewUserId ? `用户#${viewUserId}` : '');

  const [accounts, setAccounts] = useState<QueryableAccount[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<MerchantStatusRow[]>([]);
  const [summary, setSummary] = useState<SummaryCounts | null>(null);
  const [actionFilter, setActionFilter] = useState<string>('all');

  const [singleInput, setSingleInput] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [parsedPreview, setParsedPreview] = useState<MerchantQueryItem[]>([]);

  const [adminSummary, setAdminSummary] = useState<UserPassSummary[]>([]);
  const [adminGrandTotal, setAdminGrandTotal] = useState<SummaryCounts | null>(null);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([]);
  const [activeTab, setActiveTab] = useState('single');

  const accountParams = useMemo(
    () => (viewUserId ? { userId: viewUserId } : undefined),
    [viewUserId],
  );

  const loadAccounts = useCallback(async () => {
    const { data } = await api.get<ApiResult<QueryableAccount[]>>('/merchants/status/accounts', {
      params: accountParams,
    });
    if (data.success) {
      setAccounts(data.data);
      setSelectedAccountIds(data.data.filter((a) => a.statusQuerySupported).map((a) => a.id));
    }
  }, [accountParams]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    if (!isAdmin) return;
    const [start, end] = adminDefaultDateRange();
    void api
      .get<ApiResult<Array<{ id: number; username: string }>>>('/admin/users/summary', {
        params: {
          startDate: start.format('YYYY-MM-DD'),
          endDate: end.format('YYYY-MM-DD'),
        },
      })
      .then(({ data }) => {
        if (data.success) {
          setEmployees(data.data.map((u) => ({ id: u.id, username: u.username })));
        }
      });
  }, [isAdmin]);

  const runQuery = async (items: MerchantQueryItem[]) => {
    if (items.length === 0) {
      message.warning('请先输入商家');
      return;
    }
    if (selectedAccountIds.length === 0) {
      message.warning('请至少选择一个平台账号');
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post<
        ApiResult<{ items: MerchantStatusRow[]; summary: SummaryCounts }>
      >('/merchants/status/query', {
        items,
        channelAccountIds: selectedAccountIds,
        ...(viewUserId ? { targetUserId: viewUserId } : {}),
      });
      if (data.success) {
        setRows(data.data.items);
        setSummary(data.data.summary);
        message.success(`查询完成，共 ${data.data.items.length} 条结果`);
      } else {
        message.error(data.message || '查询失败');
      }
    } finally {
      setLoading(false);
    }
  };

  const runAdminSummary = async (items: MerchantQueryItem[]) => {
    if (items.length === 0) {
      message.warning('请先输入商家列表');
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post<
        ApiResult<{ byUser: UserPassSummary[]; grandTotal: SummaryCounts }>
      >('/merchants/status/summary', {
        items,
        ...(selectedEmployeeIds.length ? { userIds: selectedEmployeeIds } : {}),
      });
      if (data.success) {
        setAdminSummary(data.data.byUser);
        setAdminGrandTotal(data.data.grandTotal);
        message.success('汇总查询完成');
      } else {
        message.error(data.message || '汇总失败');
      }
    } finally {
      setLoading(false);
    }
  };

  const querySingle = () => {
    const token = singleInput.trim();
    if (!token) return;
    const item: MerchantQueryItem = /^\d+$/.test(token)
      ? { merchantId: token }
      : token.includes('.')
        ? { domain: token }
        : { mcid: token.toLowerCase() };
    void runQuery([item]);
  };

  const queryPaste = async () => {
    const { data } = await api.post<ApiResult<MerchantQueryItem[]>>('/merchants/status/parse-text', {
      text: pasteText,
    });
    if (!data.success) {
      message.error(data.message || '解析失败');
      return;
    }
    setParsedPreview(data.data);
    await runQuery(data.data);
  };

  const onImportFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const items = parseMerchantStatusImport(buf);
      setParsedPreview(items);
      if (activeTab === 'admin-summary') {
        await runAdminSummary(items);
      } else {
        await runQuery(items);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '导入失败');
    }
    return false;
  };

  const filteredRows = useMemo(() => {
    if (actionFilter === 'all') return rows;
    if (actionFilter === 'actionable') return rows.filter((r) => r.actionable);
    if (actionFilter === 'pending') return rows.filter((r) => r.actionLabel === '待审核');
    if (actionFilter === 'blocked') return rows.filter((r) => !r.actionable && !r.error);
    if (actionFilter === 'failed') return rows.filter((r) => Boolean(r.error));
    return rows.filter((r) => r.actionLabel === actionFilter);
  }, [rows, actionFilter]);

  const detailColumns: ColumnsType<MerchantStatusRow> = [
    { title: '查询键', dataIndex: 'queryKey', width: 110 },
    { title: '商家ID', dataIndex: 'merchantId', width: 100 },
    { title: 'mcid', dataIndex: 'mcid', width: 100 },
    { title: '商家名', dataIndex: 'merchantName', ellipsis: true },
    { title: '平台', dataIndex: 'platformName', width: 120 },
    { title: '渠道', dataIndex: 'channelDisplayName', width: 120 },
    { title: '序号', dataIndex: 'affiliateAlias', width: 70 },
    {
      title: '账号关系',
      dataIndex: 'relationshipStatus',
      width: 90,
      render: (v: string) => RELATIONSHIP_LABEL[v] ?? v,
    },
    {
      title: '上架',
      dataIndex: 'merchantAvailability',
      width: 70,
      render: (v: string) => AVAILABILITY_LABEL[v] ?? v,
    },
    {
      title: '投前建议',
      dataIndex: 'actionLabel',
      width: 100,
      render: (v: string) => <Tag color={ACTION_COLOR[v] ?? 'default'}>{v}</Tag>,
    },
    {
      title: '错误',
      dataIndex: 'error',
      ellipsis: true,
      render: (v: string | null) => v ?? '—',
    },
  ];

  const adminSummaryColumns: ColumnsType<UserPassSummary> = [
    { title: '员工', dataIndex: 'username', width: 120 },
    { title: '可投合计', dataIndex: 'totalPassed', width: 100 },
    {
      title: '各平台通过数',
      render: (_, r) => (
        <Space wrap size={[4, 4]}>
          {r.byPlatform.map((p) => (
            <Tag key={p.platformCode}>
              {p.platformName}: {p.passed}
              {p.pending > 0 ? ` / 待审${p.pending}` : ''}
            </Tag>
          ))}
        </Space>
      ),
    },
  ];

  const accountSelector = (
    <Card size="small" title="平台账号" style={{ marginBottom: 16 }}>
      <Checkbox.Group
        value={selectedAccountIds}
        onChange={(vals) => setSelectedAccountIds(vals as number[])}
        style={{ width: '100%' }}
      >
        <Space wrap>
          {accounts.map((a) => (
            <Checkbox key={a.id} value={a.id} disabled={!a.statusQuerySupported}>
              {a.platformName} · {a.displayName}
              {!a.statusQuerySupported && ' (暂不支持)'}
            </Checkbox>
          ))}
        </Space>
      </Checkbox.Group>
      {accounts.length === 0 && (
        <Alert
          type="warning"
          showIcon
          message="暂无平台账号"
          description={
            <>
              请先在
              <Link to="/channel-accounts"> 我的平台账号 </Link>
              中配置 API Token。
            </>
          }
        />
      )}
    </Card>
  );

  return (
    <div>
      {viewUserId && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={`管理员视角：正在查看员工「${viewUsername}」的商家状态查询`}
          action={<Link to={`/admin/users/${viewUserId}`}>用户详情</Link>}
        />
      )}

      <Card title="商家状态查询" style={{ marginBottom: 16 }}>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'single',
              label: '单个查询',
              children: (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Input.Search
                    placeholder="输入 MID、mcid 或域名"
                    value={singleInput}
                    onChange={(e) => setSingleInput(e.target.value)}
                    onSearch={querySingle}
                    enterButton="查询"
                    loading={loading}
                    style={{ maxWidth: 480 }}
                  />
                  {activeTab !== 'admin-summary' && accountSelector}
                </Space>
              ),
            },
            {
              key: 'paste',
              label: '批量粘贴',
              children: (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Input.TextArea
                    rows={8}
                    placeholder="每行一个 MID，或用逗号/空格分隔。也支持 mcid。"
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                  />
                  {activeTab !== 'admin-summary' && accountSelector}
                  <Button type="primary" loading={loading} onClick={() => void queryPaste()}>
                    开始查询
                  </Button>
                </Space>
              ),
            },
            {
              key: 'import',
              label: 'Excel 导入',
              children: (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Upload beforeUpload={onImportFile} accept=".xlsx,.xls,.csv" maxCount={1} showUploadList={false}>
                    <Button icon={<UploadOutlined />} loading={loading}>
                      选择 Excel / CSV 文件
                    </Button>
                  </Upload>
                  <Alert
                    type="info"
                    showIcon
                    message="表头需包含 MID / mcid / 网址 之一（不区分大小写）"
                  />
                  {activeTab !== 'admin-summary' && accountSelector}
                </Space>
              ),
            },
            ...(isAdmin
              ? [
                  {
                    key: 'admin-summary',
                    label: '管理员汇总',
                    children: (
                      <Space direction="vertical" style={{ width: '100%' }}>
                        <Alert
                          type="info"
                          showIcon
                          message="同一批商家，统计每个员工在各平台的「可投」数量（已 Join + 仍 Online）"
                        />
                        <Select
                          mode="multiple"
                          allowClear
                          placeholder="选择员工（默认全公司活跃员工）"
                          style={{ width: '100%', maxWidth: 560 }}
                          options={employees.map((e) => ({ value: e.id, label: e.username }))}
                          value={selectedEmployeeIds}
                          onChange={setSelectedEmployeeIds}
                        />
                        <Input.TextArea
                          rows={6}
                          placeholder="粘贴 MID 列表，或使用下方导入"
                          value={pasteText}
                          onChange={(e) => setPasteText(e.target.value)}
                        />
                        <Space>
                          <Button
                            type="primary"
                            loading={loading}
                            onClick={async () => {
                              const { data } = await api.post<ApiResult<MerchantQueryItem[]>>(
                                '/merchants/status/parse-text',
                                { text: pasteText },
                              );
                              if (data.success) await runAdminSummary(data.data);
                              else message.error(data.message);
                            }}
                          >
                            汇总查询
                          </Button>
                          <Upload
                            beforeUpload={onImportFile}
                            accept=".xlsx,.xls,.csv"
                            maxCount={1}
                            showUploadList={false}
                          >
                            <Button icon={<UploadOutlined />}>导入并汇总</Button>
                          </Upload>
                        </Space>
                      </Space>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Card>

      {parsedPreview.length > 0 && activeTab !== 'admin-summary' && (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 16 }}
          message={`已解析 ${parsedPreview.length} 个商家`}
        />
      )}

      {summary && activeTab !== 'admin-summary' && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={3}><Statistic title="总结果" value={summary.total} /></Col>
            <Col span={3}><Statistic title="可投" value={summary.actionable} valueStyle={{ color: '#16a34a' }} /></Col>
            <Col span={3}><Statistic title="待审核" value={summary.pending} valueStyle={{ color: '#ca8a04' }} /></Col>
            <Col span={3}><Statistic title="未加入" value={summary.notJoined} /></Col>
            <Col span={3}><Statistic title="无商家" value={summary.notFound} /></Col>
            <Col span={3}><Statistic title="已下架" value={summary.offline} valueStyle={{ color: '#ea580c' }} /></Col>
            <Col span={3}><Statistic title="查询失败" value={summary.failed} valueStyle={{ color: '#dc2626' }} /></Col>
          </Row>
        </Card>
      )}

      {activeTab === 'admin-summary' && adminGrandTotal && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={4}><Statistic title="全公司可投" value={adminGrandTotal.actionable} valueStyle={{ color: '#16a34a' }} /></Col>
            <Col span={4}><Statistic title="待审核" value={adminGrandTotal.pending} /></Col>
            <Col span={4}><Statistic title="不可投" value={adminGrandTotal.notJoined + adminGrandTotal.notFound + adminGrandTotal.rejected + adminGrandTotal.offline} /></Col>
            <Col span={4}><Statistic title="失败" value={adminGrandTotal.failed} valueStyle={{ color: '#dc2626' }} /></Col>
          </Row>
        </Card>
      )}

      {activeTab === 'admin-summary' && adminSummary.length > 0 && (
        <Card
          title="员工 × 平台通过数"
          style={{ marginBottom: 16 }}
          extra={
            <Button
              onClick={() =>
                void exportMerchantStatusExcel(
                  adminSummary.flatMap((u) =>
                    u.byPlatform.map((p) => ({
                      queryKey: u.username,
                      merchantId: null,
                      mcid: null,
                      merchantName: null,
                      siteUrl: null,
                      platformName: p.platformName,
                      channelDisplayName: '',
                      affiliateAlias: '',
                      ownerUsername: u.username,
                      relationshipStatus: '',
                      relationshipRaw: null,
                      merchantAvailability: '',
                      availabilityRaw: null,
                      actionLabel: `可投 ${p.passed}`,
                      error: null,
                      queriedAt: new Date().toISOString(),
                    })),
                  ),
                  '商家状态汇总',
                  true,
                )
              }
            >
              导出汇总
            </Button>
          }
        >
          <Table
            rowKey="userId"
            dataSource={adminSummary}
            columns={adminSummaryColumns}
            pagination={{ pageSize: 20 }}
            size="small"
          />
        </Card>
      )}

      {rows.length > 0 && activeTab !== 'admin-summary' && (
        <Card
          title="查询结果"
          extra={
            <Space>
              <Select
                value={actionFilter}
                onChange={setActionFilter}
                style={{ width: 140 }}
                options={[
                  { value: 'all', label: '全部' },
                  { value: 'actionable', label: '仅可投' },
                  { value: 'pending', label: '待审核' },
                  { value: 'blocked', label: '不可投' },
                  { value: 'failed', label: '查询失败' },
                ]}
              />
              <Button
                onClick={() =>
                  void exportMerchantStatusExcel(
                    filteredRows.map((r) => ({ ...r })),
                    '商家状态查询',
                    Boolean(viewUserId),
                  )
                }
              >
                导出 Excel
              </Button>
              <Button onClick={() => { setRows([]); setSummary(null); setParsedPreview([]); }}>
                清除结果
              </Button>
            </Space>
          }
        >
          <Table
            rowKey={(r) => `${r.queryKey}|${r.channelAccountId}`}
            dataSource={filteredRows}
            columns={detailColumns}
            scroll={{ x: 1200 }}
            pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
            size="small"
          />
        </Card>
      )}
    </div>
  );
}
