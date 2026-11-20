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
import { opsPlatformShort } from '../../utils/opsPlatform';

type ListType = 'violation' | 'recommend' | 'node';
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
  epc?: string;
  commissionRate?: string;
  avgOrderValue?: string;
  updatedAt: string;
}

interface OpsListData {
  listType: ListType;
  nodeKey?: string;
  total: number;
  platformCounts?: Record<string, number>;
  items: OpsItem[];
  imported?: number;
  platforms?: string[];
  mode?: ImportMode;
}

interface PromoNodeDef {
  key: string;
  name: string;
  nameEn: string;
  description: string;
  date?: string;
  daysUntil?: number;
  merchantCount?: number;
}

interface PromoNodesResult {
  nearestKey: string | null;
  definitions: PromoNodeDef[];
  nodes: PromoNodeDef[];
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
 * 管理员上传违规 / 推荐 / 节日节点名单；支持多文件、多 sheet，按平台+MID 去重。
 */
export default function AdminMerchantListsPage() {
  const [listType, setListType] = useState<ListType>('violation');
  const [nodeKey, setNodeKey] = useState<string>('');
  const [nodeOptions, setNodeOptions] = useState<PromoNodeDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [data, setData] = useState<OpsListData | null>(null);
  const [platformFilter, setPlatformFilter] = useState<string | undefined>();
  /** antd 多选会按文件多次触发 beforeUpload，用短延迟收齐同一批再解析 */
  const batchTimerRef = useRef<number | null>(null);
  const batchFilesRef = useRef<RcFile[]>([]);
  const batchModeRef = useRef<ImportMode>('merge');
  const listTypeRef = useRef(listType);
  const nodeKeyRef = useRef(nodeKey);
  listTypeRef.current = listType;
  nodeKeyRef.current = nodeKey;

  const loadNodes = useCallback(async () => {
    try {
      const res = await api.get<ApiResult<PromoNodesResult>>('/promo-nodes');
      if (!res.data.success) return;
      const defs = res.data.data.definitions?.length
        ? res.data.data.definitions
        : res.data.data.nodes ?? [];
      setNodeOptions(defs);
      setNodeKey((prev) => prev || res.data.data.nearestKey || defs[0]?.key || '');
    } catch {
      /* 节点日历失败不挡违规/推荐 */
    }
  }, []);

  const load = useCallback(async (type: ListType, key: string) => {
    if (type === 'node' && !key) {
      setData(null);
      return;
    }
    setLoading(true);
    try {
      const url = type === 'node'
        ? `/promo-nodes/${encodeURIComponent(key)}/merchants`
        : `/merchant-ops-lists/${type}`;
      const res = await api.get<ApiResult<OpsListData>>(url);
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
    void loadNodes();
  }, [loadNodes]);

  useEffect(() => {
    setPlatformFilter(undefined);
    void load(listType, nodeKey);
  }, [listType, nodeKey, load]);

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
    if (listTypeRef.current === 'node' && !nodeKeyRef.current) {
      message.warning('请先选择节日节点');
      return;
    }
    setUploading(true);
    try {
      const type = listTypeRef.current;
      const key = nodeKeyRef.current;
      const url = type === 'node'
        ? `/promo-nodes/${encodeURIComponent(key)}/import`
        : `/merchant-ops-lists/${type}/import`;
      const res = await api.post<ApiResult<OpsListData>>(url, {
        rows: unique,
        mode,
        ...(type === 'node' ? { nodeKey: key } : {}),
      });
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
      if (type === 'node') void loadNodes();
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
    if (listType === 'node' && !nodeKey) {
      message.warning('请先选择节日节点');
      return;
    }
    setUploading(true);
    try {
      const url = listType === 'node'
        ? `/promo-nodes/${encodeURIComponent(nodeKey)}`
        : `/merchant-ops-lists/${listType}`;
      const res = await api.delete<ApiResult<OpsListData>>(url, {
        params: platformCode ? { platformCode } : undefined,
      });
      if (!res.data.success) {
        message.error(res.data.message || '清空失败');
        return;
      }
      setData(res.data.data);
      setPlatformFilter(undefined);
      message.success(res.data.message || '已清空');
      if (listType === 'node') void loadNodes();
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
      .map(([code, count]) => ({
        value: code,
        label: `${opsPlatformShort(code)} · ${code} (${count})`,
      }));
  }, [data?.platformCounts]);

  const rows = useMemo(() => {
    const items = data?.items ?? [];
    if (!platformFilter) return items;
    return items.filter((item) => item.platformCode === platformFilter);
  }, [data, platformFilter]);

  /**
   * 多选时 beforeUpload 会按文件多次回调；用 50ms 防抖收齐同一批后再解析导入。
   */
  const pickFiles = (mode: ImportMode) => ({
    accept: '.xlsx,.xls,.csv',
    multiple: true,
    showUploadList: false as const,
    beforeUpload: (file: RcFile, fileList: RcFile[]) => {
      batchModeRef.current = mode;
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

  const activeNode = nodeOptions.find((item) => item.key === nodeKey);
  const emptyText = listType === 'recommend'
    ? '还没有推荐名单，可一次选多个平台文件上传'
    : listType === 'node'
      ? (nodeKey ? `还没有「${activeNode?.name || nodeKey}」名单，上传后按节点保存` : '请先选择节日节点')
      : '还没有违规名单，上传后按平台+MID 去重保存';

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>违规 / 推荐 / 节点商家名单</Typography.Title>
      <Alert
        type="info"
        showIcon
        message="去重规则：按平台+MID 去重。节点推荐需先选节日再上传；可识别 EPC、佣金率、每单均价列。"
      />
      <Card size="small">
        <Tabs
          activeKey={listType}
          onChange={(key) => setListType(key as ListType)}
          tabBarExtraContent={(
            <Space wrap>
              {listType === 'node' ? (
                <Select
                  style={{ width: 180 }}
                  placeholder="选择节日节点"
                  value={nodeKey || undefined}
                  options={nodeOptions.map((node) => ({
                    value: node.key,
                    label: `${node.name}${node.daysUntil != null ? ` · ${node.daysUntil}天` : ''}`,
                  }))}
                  onChange={(value) => setNodeKey(value)}
                />
              ) : null}
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
            {
              key: 'node',
              label: listType === 'node' && data ? `节点推荐 (${data.total})` : '节点推荐',
            },
          ]}
        />
        {listType === 'node' && activeNode ? (
          <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
            当前节点：{activeNode.name}（{activeNode.nameEn}）
            {activeNode.description ? ` · ${activeNode.description}` : ''}
          </Typography.Paragraph>
        ) : null}
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
          locale={{ emptyText }}
          columns={[
            { title: '商家名称', dataIndex: 'name', ellipsis: true, render: (value: string) => value || '—' },
            {
              title: '平台',
              dataIndex: 'platformCode',
              width: 120,
              render: (value: string) => (
                <span title={value}>{opsPlatformShort(value)}</span>
              ),
            },
            { title: 'MID', dataIndex: 'mid', width: 120 },
            { title: '国家', dataIndex: 'countryCode', width: 100, render: (value: string) => value || '—' },
            { title: 'EPC', dataIndex: 'epc', width: 90, render: (value: string) => value || '—' },
            { title: '佣金率', dataIndex: 'commissionRate', width: 90, render: (value: string) => value || '—' },
            { title: '每单均价', dataIndex: 'avgOrderValue', width: 90, render: (value: string) => value || '—' },
            { title: '品类', dataIndex: 'category', width: 140, ellipsis: true, render: (value: string) => value || '—' },
            { title: '网址', dataIndex: 'merchantUrl', ellipsis: true, render: (value: string) => value || '—' },
            { title: '备注', dataIndex: 'note', ellipsis: true, render: (value: string) => value || '—' },
          ]}
        />
      </Card>
    </Space>
  );
}
