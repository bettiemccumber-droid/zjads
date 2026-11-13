import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Space, Table, Tabs, Typography, Upload, message } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { api, type ApiResult } from '../../api/client';
import {
  parseMerchantOpsListImport,
  type MerchantOpsListImportRow,
} from '../../utils/parseMerchantOpsListImport';

type ListType = 'violation' | 'recommend';

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
  items: OpsItem[];
}

/**
 * 管理员上传违规商家 / 推荐商家名单。上传后整表替换，员工在「我的商家」只读查看。
 */
export default function AdminMerchantListsPage() {
  const [listType, setListType] = useState<ListType>('violation');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [data, setData] = useState<OpsListData | null>(null);

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
    void load(listType);
  }, [listType, load]);

  const uploadRows = async (rows: MerchantOpsListImportRow[]) => {
    setUploading(true);
    try {
      const res = await api.post<ApiResult<OpsListData>>(`/merchant-ops-lists/${listType}/replace`, { rows });
      if (!res.data.success) {
        message.error(res.data.message || '上传失败');
        return;
      }
      setData(res.data.data);
      message.success(`已更新 ${res.data.data.total} 条`);
    } catch (error: unknown) {
      const apiMessage = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(apiMessage || (error instanceof Error ? error.message : '上传失败'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>违规 / 推荐商家名单</Typography.Title>
      <Alert
        type="info"
        showIcon
        message="管理员在这里上传 Excel/CSV，整表替换。员工在「我的商家」里只读查看。表头至少包含平台（联盟）和 MID，可选商家名称、国家、网址、品类、备注。"
      />
      <Card size="small">
        <Tabs
          activeKey={listType}
          onChange={(key) => setListType(key as ListType)}
          tabBarExtraContent={(
            <Upload
              accept=".xlsx,.xls,.csv"
              showUploadList={false}
              beforeUpload={(file) => {
                void file.arrayBuffer().then((buffer) => {
                  try {
                    const rows = parseMerchantOpsListImport(buffer);
                    void uploadRows(rows);
                  } catch (error: unknown) {
                    message.error(error instanceof Error ? error.message : '解析失败');
                  }
                });
                return false;
              }}
            >
              <Button type="primary" icon={<UploadOutlined />} loading={uploading}>
                上传并替换
              </Button>
            </Upload>
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
        <Table
          rowKey="id"
          size="middle"
          loading={loading || uploading}
          dataSource={data?.listType === listType ? data.items : []}
          pagination={{ pageSize: 20, showTotal: (total) => `共 ${total} 条` }}
          locale={{ emptyText: '还没有名单，请先上传' }}
          columns={[
            { title: '商家名称', dataIndex: 'name', ellipsis: true, render: (value: string) => value || '—' },
            { title: '平台', dataIndex: 'platformCode', width: 100 },
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
