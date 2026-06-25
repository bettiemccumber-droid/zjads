import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Typography,
} from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type ApiResult } from '../api/client';

/** 与 Google Ads 脚本 lookback 对齐：默认回溯天数（含昨天） */
const DEFAULT_LOOKBACK_DAYS = 7;

interface AdDataSourceRow {
  id: number;
  name: string;
  sheetUrl: string;
  mainTab: string;
  description: string | null;
  isActive: boolean;
  updatedAt: string;
}

interface ImportResult {
  upserted: number;
  dateFrom: string;
  dateTo: string;
  campaignCount: number;
}

interface EmployeeOption {
  id: number;
  username: string;
}

interface AdSourcesPageProps {
  /** 管理员代员工管理 Sheet */
  adminMode?: boolean;
}

/**
 * 计算导入日期区间：结束日为昨天（与脚本日常模式一致），向前含 lookbackDays 个自然日
 */
function getImportDateRange(lookbackDays: number): { start: string; end: string } {
  const end = dayjs().subtract(1, 'day').startOf('day');
  const start = end.subtract(lookbackDays - 1, 'day');
  return {
    start: start.format('YYYY-MM-DD'),
    end: end.format('YYYY-MM-DD'),
  };
}

export default function AdSourcesPage({ adminMode = false }: AdSourcesPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlUserId = searchParams.get('userId');
  const scopeUserId =
    adminMode && urlUserId ? parseInt(urlUserId, 10) : undefined;

  const [list, setList] = useState<AdDataSourceRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [importingId, setImportingId] = useState<number | null>(null);
  const [rangeModalOpen, setRangeModalOpen] = useState(false);
  const [rangeTargetId, setRangeTargetId] = useState<number | null>(null);
  const [customRange, setCustomRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [form] = Form.useForm();

  const scopeUsername = useMemo(
    () => employees.find((e) => e.id === scopeUserId)?.username,
    [employees, scopeUserId],
  );

  const loadEmployees = useCallback(async () => {
    if (!adminMode) return;
    const { start, end } = getImportDateRange(30);
    const { data } = await api.get<
      ApiResult<Array<{ id: number; username: string; isActive: boolean }>>
    >('/admin/users/summary', {
      params: { startDate: start, endDate: end },
    });
    if (data.success) {
      setEmployees(
        data.data.filter((u) => u.isActive).map((u) => ({ id: u.id, username: u.username })),
      );
    }
  }, [adminMode]);

  const load = useCallback(async () => {
    if (adminMode && !scopeUserId) {
      setList([]);
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get<ApiResult<AdDataSourceRow[]>>('/ad-sources', {
        params: scopeUserId != null ? { userId: scopeUserId } : undefined,
      });
      if (data.success) setList(data.data);
    } finally {
      setLoading(false);
    }
  }, [adminMode, scopeUserId]);

  useEffect(() => {
    void loadEmployees();
  }, [loadEmployees]);

  useEffect(() => {
    void load();
  }, [load]);

  const onCreate = async (values: { name: string; sheetUrl: string; mainTab?: string }) => {
    if (adminMode && !scopeUserId) {
      message.warning('请先选择员工');
      return;
    }
    const { data } = await api.post<ApiResult<AdDataSourceRow>>('/ad-sources', {
      name: values.name,
      sheetUrl: values.sheetUrl,
      mainTab: values.mainTab || 'raw_daily_report',
      ...(scopeUserId != null ? { userId: scopeUserId } : {}),
    });
    if (data.success) {
      message.success('已添加广告数据源');
      form.resetFields();
      void load();
    } else {
      message.error(data.message);
    }
  };

  const runImport = async (
    id: number,
    startDate?: string,
    endDate?: string,
    label?: string,
  ) => {
    setImportingId(id);
    try {
      const params: Record<string, string> = {};
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      const { data } = await api.post<ApiResult<ImportResult>>(
        `/ad-sources/${id}/import`,
        null,
        { params },
      );

      if (data.success) {
        const rangeLabel =
          label ??
          (data.data.dateFrom && data.data.dateTo
            ? `${data.data.dateFrom} ~ ${data.data.dateTo}`
            : '全量');
        message.success(
          `导入完成：${data.data.upserted} 条日数据，${data.data.campaignCount} 个系列（${rangeLabel}）`,
        );
        void load();
      } else {
        message.error(data.message);
      }
    } catch {
      message.error('导入失败，请确认 Sheet 已公开可读');
    } finally {
      setImportingId(null);
    }
  };

  const onImportRecent = async (id: number) => {
    const { start, end } = getImportDateRange(DEFAULT_LOOKBACK_DAYS);
    await runImport(id, start, end, `${start} ~ ${end}`);
  };

  const onImportAll = async (id: number) => {
    await runImport(id, undefined, undefined, 'Sheet 全量');
  };

  const openRangeModal = (id: number) => {
    const { start, end } = getImportDateRange(DEFAULT_LOOKBACK_DAYS);
    setRangeTargetId(id);
    setCustomRange([dayjs(start), dayjs(end)]);
    setRangeModalOpen(true);
  };

  const onConfirmRangeImport = async () => {
    if (!rangeTargetId || !customRange) return;
    const [start, end] = customRange;
    setRangeModalOpen(false);
    await runImport(
      rangeTargetId,
      start.format('YYYY-MM-DD'),
      end.format('YYYY-MM-DD'),
    );
    setRangeTargetId(null);
  };

  const onDelete = async (id: number, purgeImported: boolean) => {
    const { data } = await api.delete<ApiResult<{ deleted: boolean; purged?: boolean }>>(
      `/ad-sources/${id}`,
      { params: purgeImported ? { purgeImported: 'true' } : undefined },
    );
    if (data.success) {
      message.success(purgeImported ? '已删除数据源并清空导入的广告数据' : '已删除数据源');
      void load();
    }
  };

  const onPurgeAll = async () => {
    if (adminMode && !scopeUserId) {
      message.warning('请先选择员工');
      return;
    }
    const { data } = await api.post<ApiResult<{ deleted: number }>>(
      '/ad-sources/purge-imported',
      null,
      { params: scopeUserId != null ? { userId: scopeUserId } : undefined },
    );
    if (data.success) {
      message.success(`已清空 ${data.data.deleted} 条广告日数据，请重新从正确 Sheet 导入`);
    } else {
      message.error(data.message);
    }
  };

  const onPurgeRange = async () => {
    if (!customRange) return;
    const [start, end] = customRange;
    const { data } = await api.post<ApiResult<{ deleted: number }>>(
      '/ad-sources/purge-imported',
      null,
      {
        params: {
          startDate: start.format('YYYY-MM-DD'),
          endDate: end.format('YYYY-MM-DD'),
          ...(scopeUserId != null ? { userId: scopeUserId } : {}),
        },
      },
    );
    if (data.success) {
      message.success(
        `已清空 ${data.data.deleted} 条（${start.format('YYYY-MM-DD')} ~ ${end.format('YYYY-MM-DD')}）`,
      );
      setRangeModalOpen(false);
    } else {
      message.error(data.message);
    }
  };

  const defaultRange = getImportDateRange(DEFAULT_LOOKBACK_DAYS);
  const ownerLabel = adminMode
    ? scopeUsername
      ? `员工「${scopeUsername}」`
      : '（请先选择员工）'
    : '我的';

  return (
    <div>
      {adminMode && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="管理员代员工管理 Google Sheet 广告数据"
          description="广告费来自 Sheet 导入，不是联盟采集。员工当天未导入 Sheet 时，工作台会看不到广告费。请在此为员工配置 Sheet 并导入。"
        />
      )}

      {adminMode && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Space wrap>
            <span>选择员工：</span>
            <Select
              style={{ width: 200 }}
              placeholder="选择员工"
              value={scopeUserId}
              options={employees.map((e) => ({ value: e.id, label: e.username }))}
              onChange={(id) => {
                const next = new URLSearchParams(searchParams);
                next.set('userId', String(id));
                const name = employees.find((e) => e.id === id)?.username;
                if (name) next.set('username', name);
                setSearchParams(next);
              }}
              allowClear
              onClear={() => setSearchParams({})}
            />
            {scopeUserId != null && (
              <Link to={`/dashboard?userId=${scopeUserId}&username=${encodeURIComponent(scopeUsername ?? '')}`}>
                打开该员工工作台 →
              </Link>
            )}
          </Space>
        </Card>
      )}

      <Card
        title={`添加 Google Sheet — ${ownerLabel}`}
        style={{ marginBottom: 16 }}
      >
        <Form form={form} layout="inline" onFinish={onCreate} style={{ flexWrap: 'wrap', gap: 8 }}>
          <Form.Item name="name" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="名称，如：MCC 报表" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="sheetUrl" rules={[{ required: true, message: '请输入 Sheet URL' }]}>
            <Input placeholder="Google Sheet 链接" style={{ width: 360 }} />
          </Form.Item>
          <Form.Item name="mainTab" initialValue="raw_daily_report">
            <Input placeholder="工作表名" style={{ width: 160 }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" disabled={adminMode && !scopeUserId}>
              保存
            </Button>
          </Form.Item>
        </Form>
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          Sheet 需设置为「知道链接的任何人可查看」。导入后可在工作台「广告系列」查看广告费。
          默认导入 <strong>昨天起回溯 {DEFAULT_LOOKBACK_DAYS} 天</strong>（{defaultRange.start} ~{' '}
          {defaultRange.end}）。
        </Typography.Paragraph>
      </Card>

      <Card
        title={`${ownerLabel} 广告数据源`}
        extra={
          <Space>
            <Popconfirm
              title={`清空${adminMode ? '该员工' : ''}全部已导入的广告数据？`}
              description="仅删除库内广告日数据，不影响联盟订单。"
              onConfirm={() => void onPurgeAll()}
            >
              <Button danger disabled={adminMode && !scopeUserId}>
                清空全部导入数据
              </Button>
            </Popconfirm>
            <Button
              disabled={adminMode && !scopeUserId}
              onClick={() => {
                const { start, end } = getImportDateRange(DEFAULT_LOOKBACK_DAYS);
                setCustomRange([dayjs(start), dayjs(end)]);
                setRangeTargetId(-1);
                setRangeModalOpen(true);
              }}
            >
              按日期清空
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          loading={loading}
          dataSource={list}
          pagination={false}
          scroll={{ x: 900 }}
          locale={{
            emptyText: adminMode && !scopeUserId ? '请先选择员工' : '暂无数据源，请添加上方 Sheet',
          }}
          columns={[
            { title: '名称', dataIndex: 'name', width: 120 },
            { title: '工作表', dataIndex: 'mainTab', width: 140 },
            {
              title: 'Sheet',
              dataIndex: 'sheetUrl',
              ellipsis: true,
              render: (url: string) => (
                <a href={url} target="_blank" rel="noreferrer">
                  打开
                </a>
              ),
            },
            {
              title: '更新时间',
              dataIndex: 'updatedAt',
              width: 170,
              render: (v: string) => new Date(v).toLocaleString('zh-CN'),
            },
            {
              title: '操作',
              width: 320,
              fixed: 'right',
              render: (_: unknown, r: AdDataSourceRow) => (
                <Space wrap size="small">
                  <Button
                    type="primary"
                    size="small"
                    loading={importingId === r.id}
                    onClick={() => onImportRecent(r.id)}
                  >
                    导入近 {DEFAULT_LOOKBACK_DAYS} 天
                  </Button>
                  <Button
                    size="small"
                    loading={importingId === r.id}
                    onClick={() => openRangeModal(r.id)}
                  >
                    自定义日期
                  </Button>
                  <Popconfirm
                    title="导入 Sheet 中全部日数据？"
                    onConfirm={() => onImportAll(r.id)}
                  >
                    <Button size="small" loading={importingId === r.id}>
                      全量
                    </Button>
                  </Popconfirm>
                  <Popconfirm
                    title="确定删除此数据源？"
                    onConfirm={() => onDelete(r.id, false)}
                  >
                    <Button size="small" danger>
                      删除
                    </Button>
                  </Popconfirm>
                  <Popconfirm
                    title="删除并清空全部导入的广告数据？"
                    onConfirm={() => onDelete(r.id, true)}
                  >
                    <Button size="small" danger type="primary">
                      删除并清空
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={rangeTargetId === -1 ? '按日期清空广告导入数据' : '按日期导入广告数据'}
        open={rangeModalOpen}
        onCancel={() => {
          setRangeModalOpen(false);
          setRangeTargetId(null);
        }}
        onOk={() => {
          if (rangeTargetId === -1) {
            void onPurgeRange();
            return;
          }
          void onConfirmRangeImport();
        }}
        okText={rangeTargetId === -1 ? '确认清空' : '开始导入'}
        okButtonProps={rangeTargetId === -1 ? { danger: true } : undefined}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          {rangeTargetId === -1
            ? '将删除所选日期区间内已导入的全部广告日数据（联盟订单不受影响）。'
            : '建议区间不窄于工作台查询日期。'}
        </Typography.Paragraph>
        <DatePicker.RangePicker
          value={customRange}
          onChange={(v) => setCustomRange(v as [Dayjs, Dayjs] | null)}
          style={{ width: '100%' }}
          allowClear={false}
        />
      </Modal>
    </div>
  );
}
