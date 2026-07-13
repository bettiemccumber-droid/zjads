import { Button, Modal, Table, Tag, Tooltip } from 'antd';
import { useState } from 'react';
import { api, type ApiResult } from '../api/client';
import {
  AFFILIATE_STATUS_LABELS,
  affiliateStatusColor,
  formatCollectionTime,
  formatRelativeTime,
} from '../utils/collection-display';

export interface AffiliateCollectionFields {
  lastSyncStatus: string | null;
  lastSyncAt: string | null;
  lastSyncDateRange?: string | null;
  lastSyncStartedAt?: string | null;
  lastSyncProgress?: string | null;
  lastSyncError?: string | null;
  lastSyncJobId?: number | null;
}

export interface SheetCollectionFields {
  lastSheetName?: string | null;
  lastSheetImportAt?: string | null;
  adSourceCount?: number;
  sheetNames?: string[];
  lastSheetNameSummary?: string | null;
}

interface SyncJobRow {
  id: number;
  status: string;
  startDate: string;
  endDate: string;
  startedAt: string;
  completedAt: string | null;
  totalItems: number;
  completed: number;
  failed: number;
  errorMessage: string | null;
  includeClicks: boolean;
  items: Array<{
    id: number;
    status: string;
    platformName: string;
    accountName: string;
    errorMessage: string | null;
  }>;
}

/** 联盟采集状态单元格 */
export function AffiliateCollectionCell({
  row,
  userId,
  username,
}: {
  row: AffiliateCollectionFields;
  userId?: number;
  username?: string;
}) {
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<SyncJobRow[]>([]);
  const [loading, setLoading] = useState(false);

  const openHistory = async () => {
    if (!userId) return;
    setOpen(true);
    setLoading(true);
    try {
      const { data } = await api.get<ApiResult<SyncJobRow[]>>(`/admin/users/${userId}/sync-jobs`, {
        params: { limit: 10 },
      });
      if (data.success) setJobs(data.data);
    } finally {
      setLoading(false);
    }
  };

  if (!row.lastSyncStatus) {
    return <span style={{ color: '#999' }}>未采集</span>;
  }

  const finishedAt = row.lastSyncAt;
  const relative = formatRelativeTime(finishedAt);

  return (
    <>
      <div style={{ fontSize: 12, lineHeight: 1.55, minWidth: 140 }}>
        <div>
          <Tag color={affiliateStatusColor(row.lastSyncStatus)}>
            {AFFILIATE_STATUS_LABELS[row.lastSyncStatus] ?? row.lastSyncStatus}
          </Tag>
          {relative && (
            <Tooltip title={formatCollectionTime(finishedAt)}>
              <span style={{ color: '#666' }}>{relative}</span>
            </Tooltip>
          )}
        </div>
        {row.lastSyncDateRange && (
          <div style={{ color: '#888' }}>区间 {row.lastSyncDateRange}</div>
        )}
        {row.lastSyncProgress && <div style={{ color: '#666' }}>{row.lastSyncProgress}</div>}
        {row.lastSyncError && (
          <Tooltip title={row.lastSyncError}>
            <div
              style={{
                color: '#dc2626',
                maxWidth: 160,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {row.lastSyncError}
            </div>
          </Tooltip>
        )}
        {userId && (
          <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={openHistory}>
            采集记录
          </Button>
        )}
      </div>

      <Modal
        title={`${username ?? ''} · 联盟采集记录`}
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={720}
      >
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={jobs}
          pagination={false}
          expandable={{
            expandedRowRender: (job) => (
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={job.items}
                columns={[
                  { title: '平台', dataIndex: 'platformName', width: 120 },
                  { title: '账号', dataIndex: 'accountName' },
                  {
                    title: '状态',
                    dataIndex: 'status',
                    width: 90,
                    render: (s: string) => (
                      <Tag color={affiliateStatusColor(s)}>{AFFILIATE_STATUS_LABELS[s] ?? s}</Tag>
                    ),
                  },
                  {
                    title: '错误',
                    dataIndex: 'errorMessage',
                    ellipsis: true,
                    render: (v: string | null) => v ?? '—',
                  },
                ]}
              />
            ),
          }}
          columns={[
            { title: 'ID', dataIndex: 'id', width: 56 },
            {
              title: '状态',
              dataIndex: 'status',
              width: 88,
              render: (s: string) => (
                <Tag color={affiliateStatusColor(s)}>{AFFILIATE_STATUS_LABELS[s] ?? s}</Tag>
              ),
            },
            {
              title: '采集区间',
              render: (_, j) => `${j.startDate} ~ ${j.endDate}`,
            },
            {
              title: '完成时间',
              dataIndex: 'completedAt',
              width: 150,
              render: (v: string | null, j) => formatCollectionTime(v ?? j.startedAt),
            },
            {
              title: '进度',
              width: 100,
              render: (_, j) => `${j.completed}/${j.totalItems}${j.failed ? ` (${j.failed} 失败)` : ''}`,
            },
          ]}
        />
      </Modal>
    </>
  );
}

/** Sheet 导入状态单元格 */
export function SheetCollectionCell({ row }: { row: SheetCollectionFields }) {
  if (!row.lastSheetImportAt) {
    return <span style={{ color: '#999' }}>未导入</span>;
  }

  const relative = formatRelativeTime(row.lastSheetImportAt);
  const displayName =
    row.lastSheetNameSummary ??
    (row.sheetNames && row.sheetNames.length > 1
      ? `${row.sheetNames.length} 个：${row.sheetNames.join('、')}`
      : row.lastSheetName);
  const nameTitle =
    row.sheetNames && row.sheetNames.length > 1 ? row.sheetNames.join('、') : displayName ?? undefined;

  return (
    <div style={{ fontSize: 12, lineHeight: 1.55, minWidth: 120 }}>
      <Tooltip title={formatCollectionTime(row.lastSheetImportAt)}>
        <span style={{ color: '#666' }}>{relative}</span>
      </Tooltip>
      {displayName && (
        <Tooltip title={nameTitle}>
          <div style={{ color: '#888', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {displayName}
          </div>
        </Tooltip>
      )}
    </div>
  );
}
