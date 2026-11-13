import { useCallback, useEffect, useMemo, useState } from 'react';
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
      const res = await api.post<ApiResult<OpsListData>>(`/merchant-ops-lists/${listType}/import`, {
        rows: unique,
        mode,
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
    for (const file of files) {
      try {
        const parsed = parseMerchantOpsListImport(await file.arrayBuffer());
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
   * 一次选多个文件时，等本批最后一个文件到位再统一解析导入。
   */
  const pickFiles = (mode: ImportMode, multiple: boolean) => ({
    accept: '.xlsx,.xls,.csv',
    multiple,
    showUploadList: false as const,
    beforeUpload: (file: RcFile, fileList: RcFile[]) => {
      if (file.uid !== fileList[fileList.length - 1]?.uid) return false;
      void (async () => {
        const parsed = await parseFiles(fileList);
        await uploadRows(parsed, mode, { fileCount: fileList.length, rawCount: parsed.length });
      })();
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
        message="去重规则：合并导入，按平台+MID 自动去重。同一商家重复上传只会保留一条。支持多文件、多 sheet；表头可为「平台+商家ID」或「Merchant ID + BU」。"
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
              <Upload {...pickFiles('merge', true)}>
                <Button type="primary" icon={<UploadOutlined />} loading={uploading}>
                  合并导入（去重）
                </Button>
              </Upload>
              <Upload {...pickFiles('replace_platforms', true)}>
                <Button loading={uploading}>覆盖本次平台</Button>
              </Upload>
              <Upload {...pickFiles('replace_all', true)}>
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
