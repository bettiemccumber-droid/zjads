import { Alert, Button, Descriptions, Spin, Table, Tag } from 'antd';

export interface SyncJobItemRow {
  id: number;
  status: string;
  ordersFetched: number;
  ordersInserted: number;
  ordersUpdated: number;
  errorMessage: string | null;
  channelAccount?: {
    displayName: string;
    affiliateAlias: string;
    platform: { name: string };
  };
}

export interface SyncJobDetail {
  id: number;
  status: string;
  startDate: string;
  endDate: string;
  totalItems: number;
  completed: number;
  failed: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  items: SyncJobItemRow[];
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending: { label: '排队中', color: 'default' },
  running: { label: '采集中', color: 'processing' },
  completed: { label: '已完成', color: 'success' },
  failed: { label: '失败', color: 'error' },
  partial: { label: '部分成功', color: 'warning' },
};

const ITEM_STATUS: Record<string, string> = {
  pending: '等待',
  running: '进行中',
  completed: '成功',
  failed: '失败',
};

function formatDate(d: string | Date) {
  const s = typeof d === 'string' ? d : d.toISOString();
  return s.slice(0, 10);
}

function formatTime(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('zh-CN');
}

interface SyncJobStatusProps {
  job: SyncJobDetail | null;
  loading?: boolean;
  onCancel?: (jobId: number) => void;
  cancelling?: boolean;
}

/**
 * 采集任务状态面板
 */
export default function SyncJobStatus({ job, loading, onCancel, cancelling }: SyncJobStatusProps) {
  if (loading && !job) {
    return (
      <div style={{ marginTop: 12, textAlign: 'center' }}>
        <Spin tip="正在查询采集状态…" />
      </div>
    );
  }

  if (!job) return null;

  const meta = STATUS_MAP[job.status] ?? { label: job.status, color: 'default' };
  const isDone = ['completed', 'failed', 'partial'].includes(job.status);
  const alertType =
    job.status === 'completed' ? 'success' : job.status === 'failed' ? 'error' : 'info';

  const isActive = job.status === 'pending' || job.status === 'running';
  const startedMs = job.startedAt ? new Date(job.startedAt).getTime() : 0;
  const stuckHint =
    isActive && startedMs && Date.now() - startedMs > 3 * 60 * 60 * 1000
      ? '任务可能已卡住（服务重启或点击采集过慢），可取消后重新采集'
      : null;

  return (
    <div style={{ marginTop: 12 }}>
      <Alert
        type={alertType}
        showIcon
        message={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>
              采集任务 #{job.id} <Tag color={meta.color}>{meta.label}</Tag>
              {!isDone && <Spin size="small" style={{ marginLeft: 8 }} />}
            </span>
            {isActive && onCancel && (
              <Button size="small" danger loading={cancelling} onClick={() => onCancel(job.id)}>
                取消任务
              </Button>
            )}
          </span>
        }
        description={
          <>
            {stuckHint && (
              <p style={{ color: '#b45309', margin: '0 0 8px' }}>{stuckHint}</p>
            )}
            {job.errorMessage && isDone && (
              <p style={{ margin: '0 0 8px' }}>{job.errorMessage}</p>
            )}
            <Descriptions size="small" column={2}>
            <Descriptions.Item label="日期范围">
              {formatDate(job.startDate)} ~ {formatDate(job.endDate)}
            </Descriptions.Item>
            <Descriptions.Item label="进度">
              {job.completed + job.failed} / {job.totalItems} 个账号
            </Descriptions.Item>
            <Descriptions.Item label="开始时间">{formatTime(job.startedAt)}</Descriptions.Item>
            <Descriptions.Item label="结束时间">{formatTime(job.completedAt)}            </Descriptions.Item>
          </Descriptions>
          </>
        }
      />
      <Table
        size="small"
        style={{ marginTop: 8 }}
        rowKey="id"
        pagination={false}
        dataSource={job.items ?? []}
        columns={[
          {
            title: '账号',
            render: (_: unknown, r: SyncJobItemRow) => {
              const ca = r.channelAccount;
              if (!ca?.platform) return '—';
              return `${ca.platform.name} · ${ca.displayName} (${ca.affiliateAlias})`;
            },
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 90,
            render: (s: string) => ITEM_STATUS[s] ?? s,
          },
          {
            title: '订单写入',
            width: 120,
            render: (_: unknown, r: SyncJobItemRow) =>
              r.status === 'completed'
                ? `拉取 ${r.ordersFetched} / 新增 ${r.ordersInserted} / 更新 ${r.ordersUpdated}`
                : '—',
          },
          {
            title: '说明',
            dataIndex: 'errorMessage',
            render: (msg: string | null, r: SyncJobItemRow) => {
              if (r.status === 'failed') {
                return <span style={{ color: '#dc2626' }}>{msg}</span>;
              }
              if (r.status === 'running' && msg) {
                return <span style={{ color: '#2563eb' }}>{msg}</span>;
              }
              return msg ?? '—';
            },
          },
        ]}
      />
    </div>
  );
}
