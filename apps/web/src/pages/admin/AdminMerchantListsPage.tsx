import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Typography,
  Upload,
  message,
} from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import type { RcFile } from 'antd/es/upload/interface';
import { api, type ApiResult } from '../../api/client';
import {
  parseMerchantOpsListImport,
  type MerchantOpsListImportRow,
} from '../../utils/parseMerchantOpsListImport';

type ListType = 'violation' | 'recommend';
type ImportMode = 'merge' | 'replace_platforms' | 'replace_all';

interface OpsItem {
  id: number;
  platformCode: string;
  mid: string;
  name: string;
  countryCode: string;
  merchantUrl: string;
  category: string;
  note: string;
  updatedAt: string;
}

interface OpsListData {
  listType: ListType;
  total: number;
  platformCounts?: Record<string, number>;
  items: OpsItem[];
  imported?: number;
  platforms?: string[];
  mode?: ImportMode;
}

/**
 * 按平台 + MID 去重，后出现的覆盖先出现的。
 */
function dedupeRows(rows: MerchantOpsListImportRow[]) {
  const map = new Map<string, MerchantOpsListImportRow>();
  for (const row of rows) {
    const platformCode = row.platformCode.trim().toLowerCase();
    const mid = row.mid.trim();
    if (!platformCode || !mid) continue;
    map.set(`${platformCode}:${mid}`, {
      ...row,
      platformCode,
      mid,
    });
  }
  return [...map.values()];
}

/**
 * 管理员上传违规 / 推荐名单；支持多文件、多 sheet，按平台+MID 去重。
 */
export default function AdminMerchantListsPage() {
  const [listType, setListType] = useState<ListType>('violation');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [data, setData] = useState<OpsListData | null>(null);
  const [platformFilter, setPlatformFilter] = useState<string | undefined>();
  /** antd 多选会按文件多次触发 beforeUpload，用短延迟收齐同一批再解析 */
  const batchTimerRef = useRef<number | null>(null);
  const batchFilesRef = useRef<RcFile[]>([]);
  const batchModeRef = useRef<ImportMode>('merge');
  const listTypeRef = useRef(listType);
  listTypeRef.current = listType;

  const load = useCallback(async (type: ListType) => {
    setLoading(true);
    try {
      const res = await api.get<ApiResult<OpsListData>>(`/merchant-ops-lists/${type}`);
      if (!res.data.success) {
        message.error(res.data.message || '加载名单失败');
        return;
      }
      setData(res.data.data);
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : '加载名单失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPlatformFilter(undefined);
    void load(listType);
  }, [listType, load]);

  const uploadRows = async (
    rows: MerchantOpsListImportRow[],
    mode: ImportMode,
    meta?: { fileCount: number; rawCount: number },
  ) => {
    const unique = dedupeRows(rows);
    if (unique.length === 0) {
      message.warning('没有有效商家行（需要平台 + MID）');
      return;
    }
    setUploading(true);
    try {
      const res = await api.post<ApiResult<OpsListData>>(
        `/merchant-ops-lists/${listTypeRef.current}/import`,
        { rows: unique, mode },
      );
      if (!res.data.success) {
        message.error(res.data.message || '上传失败');
        return;
      }
      setData(res.data.data);
      const removed = Math.max(0, (meta?.rawCount ?? rows.length) - unique.length);
      const parts = [
        res.data.message || `已导入 ${res.data.data.imported ?? unique.length} 条`,
        meta?.fileCount && meta.fileCount > 1 ? `来自 ${meta.fileCount} 个文件` : '',
        removed > 0 ? `去重去掉 ${removed} 条` : '',
      ].filter(Boolean);
      message.success(parts.join(' · '));
    } catch (error: unknown) {
      const apiMessage = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(apiMessage || (error instanceof Error ? error.message : '上传失败'));
    } finally {
      setUploading(false);
    }
  };

  const parseFiles = async (files: File[]) => {
    const allRows: MerchantOpsListImportRow[] = [];
    const failures: string[] = [];
    // 按文件名去重，避免 antd 批次回调重复塞入同一文件
    const uniqueFiles = [...new Map(files.map((file) => [file.name + file.size, file])).values()];
    for (const file of uniqueFiles) {
      try {
        const parsed = parseMerchantOpsListImport(await file.arrayBuffer(), file.name);
        allRows.push(...parsed);
      } catch (error: unknown) {
        failures.push(`${file.name}：${error instanceof Error ? error.message : '解析失败'}`);
      }
    }
    if (failures.length) message.warning(failures.join('；'));
    return allRows;
  };

  const clearList = async (platformCode?: string) => {
    setUploading(true);
    try {
      const res = await api.delete<ApiResult<OpsListData>>(`/merchant-ops-lists/${listType}`, {
        params: platformCode ? { platformCode } : undefined,
      });
      if (!res.data.success) {
        message.error(res.data.message || '清空失败');
        return;
      }
      setData(res.data.data);
      setPlatformFilter(undefined);
      message.success(res.data.message || '已清空');
    } catch (error: unknown) {
      const apiMessage = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(apiMessage || (error instanceof Error ? error.message : '清空失败'));
    } finally {
      setUploading(false);
    }
  };

  const platformOptions = useMemo(() => {
    const counts = data?.platformCounts ?? {};
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([code, count]) => ({ value: code, label: `${code.toUpperCase()} (${count})` }));
  }, [data?.platformCounts]);

  const rows = useMemo(() => {
    const items = data?.listType === listType ? data.items : [];
    if (!platformFilter) return items;
    return items.filter((item) => item.platformCode === platformFilter);
  }, [data, listType, platformFilter]);

  /**
   * 多选时 beforeUpload 会按文件多次回调；用 50ms 防抖收齐同一批后再解析导入。
   */
  const pickFiles = (mode: ImportMode) => ({
    accept: '.xlsx,.xls,.csv',
    multiple: true,
    showUploadList: false as const,
    beforeUpload: (file: RcFile, fileList: RcFile[]) => {
      batchModeRef.current = mode;
      // fileList 为本轮对话框选中的全部文件；单次回调也至少带上当前 file
      const incoming = fileList.length > 0 ? fileList : [file];
      const merged = new Map(batchFilesRef.current.map((item) => [item.uid, item]));
      for (const item of incoming) merged.set(item.uid, item);
      batchFilesRef.current = [...merged.values()];
      if (batchTimerRef.current != null) window.clearTimeout(batchTimerRef.current);
      batchTimerRef.current = window.setTimeout(() => {
        batchTimerRef.current = null;
        const files = batchFilesRef.current;
        const batchMode = batchModeRef.current;
        batchFilesRef.current = [];
        if (!files.length) return;
        void (async () => {
          const parsed = await parseFiles(files);
          await uploadRows(parsed, batchMode, {
            fileCount: files.length,
            rawCount: parsed.length,
          });
        })();
      }, 50);
      return false;
    },
  });

  const isRecommend = listType === 'recommend';

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>违规 / 推荐商家名单</Typography.Title>
      <Alert
        type="info"
        showIcon
        message="去重规则：按平台+MID 去重。支持多文件/多 sheet；识别 MID、BU Merchant ID（含 Mercahnt 拼写）、BU 列，以及标题里的 PM/LH 等平台。"
      />
      <Card size="small">
        <Tabs
          activeKey={listType}
          onChange={(key) => setListType(key as ListType)}
          tabBarExtraContent={(
            <Space wrap>
              <Select
                allowClear
                placeholder="按平台筛选"
                style={{ width: 160 }}
                value={platformFilter}
                options={platformOptions}
                onChange={(value) => setPlatformFilter(value)}
              />
              <Upload {...pickFiles('merge')}>
                <Button type="primary" icon={<UploadOutlined />} loading={uploading}>
                  合并导入（可多选）
                </Button>
              </Upload>
              <Upload {...pickFiles('replace_platforms')}>
                <Button loading={uploading}>覆盖本次平台</Button>
              </Upload>
              <Upload {...pickFiles('replace_all')}>
                <Button danger ghost loading={uploading}>整表替换</Button>
              </Upload>
              {platformFilter ? (
                <Popconfirm
                  title={`清空平台 ${platformFilter.toUpperCase()}？`}
                  onConfirm={() => void clearList(platformFilter)}
                >
                  <Button danger loading={uploading}>清空此平台</Button>
                </Popconfirm>
              ) : (
                <Popconfirm title="清空当前名单的全部平台？" onConfirm={() => void clearList()}>
                  <Button danger loading={uploading}>清空全部</Button>
                </Popconfirm>
              )}
            </Space>
          )}
          items={[
            {
              key: 'violation',
              label: listType === 'violation' && data ? `违规商家 (${data.total})` : '违规商家',
            },
            {
              key: 'recommend',
              label: listType === 'recommend' && data ? `推荐商家 (${data.total})` : '推荐商家',
            },
          ]}
        />
        {platformOptions.length > 0 ? (
          <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
            已入库平台：{platformOptions.map((item) => item.label).join(' · ')}
          </Typography.Paragraph>
        ) : null}
        <Table
          rowKey="id"
          size="middle"
          loading={loading || uploading}
          dataSource={rows}
          pagination={{ pageSize: 20, showTotal: (total) => `共 ${total} 条` }}
          locale={{ emptyText: isRecommend ? '还没有推荐名单，可一次选多个平台文件上传' : '还没有违规名单，上传后按平台+MID 去重保存' }}
          columns={[
            { title: '商家名称', dataIndex: 'name', ellipsis: true, render: (value: string) => value || '—' },
            { title: '平台', dataIndex: 'platformCode', width: 100, render: (value: string) => value.toUpperCase() },
            { title: 'MID', dataIndex: 'mid', width: 120 },
            { title: '国家', dataIndex: 'countryCode', width: 100, render: (value: string) => value || '—' },
            { title: '品类', dataIndex: 'category', width: 140, ellipsis: true, render: (value: string) => value || '—' },
            { title: '网址', dataIndex: 'merchantUrl', ellipsis: true, render: (value: string) => value || '—' },
            { title: '备注', dataIndex: 'note', ellipsis: true, render: (value: string) => value || '—' },
          ]}
        />
      </Card>
    </Space>
  );
}
