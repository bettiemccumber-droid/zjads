import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Popconfirm, Space, Table, Tag, Typography, message } from 'antd';
import axios from 'axios';
import { api, type ApiResult } from '../../api/client';

interface ArticleRow {
  id: number;
  title: string;
  articleUrl: string;
  merchantUrl: string;
  trackUrl: string;
  publishStatus: string;
  siteName: string;
  siteDomain: string;
}

const STATUS_LABEL: Record<string, string> = {
  pending_site: '等待内容站回写',
  published: '已发布',
};

/**
 * 当前员工确认发布后留下的文章。文章地址和商家网址分开显示。
 */
export default function ArticlesPage() {
  const [rows, setRows] = useState<ArticleRow[]>([]);
  const [removingId, setRemovingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const res = await api.get<ApiResult<ArticleRow[]>>('/articles');
    if (res.data.success) setRows(res.data.data);
  }, []);

  /**
   * 确认后从内容站和本地一起删掉。内容站拒绝时列表保持原样。
   */
  const remove = useCallback(async (id: number) => {
    setRemovingId(id);
    try {
      const res = await api.delete<ApiResult<{ id: number }>>(`/articles/${id}`);
      if (!res.data.success) {
        message.error(res.data.message || '删除失败');
        return;
      }
      message.success('文章已删除');
      await load();
    } catch (error) {
      const raw = axios.isAxiosError(error) ? error.response?.data?.message : undefined;
      const detail = Array.isArray(raw) ? raw.join('；') : raw;
      message.error(typeof detail === 'string' && detail ? detail : '删除失败');
    } finally {
      setRemovingId(null);
    }
  }, [load]);

  useEffect(() => {
    void load().catch(() => message.error('加载文章失败'));
  }, [load]);

  return (
    <>
      <Typography.Title level={4} style={{ marginTop: 0 }}>文章管理</Typography.Title>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="文章地址是内容站上的文章。广告最终到达网址是商家网址。正文里的超链接是联盟跟踪链接。"
      />
      <Table
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={rows}
        columns={[
          { title: '标题', dataIndex: 'title' },
          { title: '内容站', render: (_: unknown, row: ArticleRow) => `${row.siteName} (${row.siteDomain})` },
          {
            title: '文章地址',
            dataIndex: 'articleUrl',
            render: (value: string) => value
              ? <Typography.Link href={value} target="_blank" rel="noreferrer">{value}</Typography.Link>
              : '等待回写',
          },
          { title: '商家网址', dataIndex: 'merchantUrl' },
          { title: '跟踪链接', dataIndex: 'trackUrl', ellipsis: true },
          {
            title: '状态',
            dataIndex: 'publishStatus',
            render: (value: string) => (
              <Tag color={value === 'published' ? 'success' : 'warning'}>{STATUS_LABEL[value] ?? value}</Tag>
            ),
          },
          {
            title: '操作',
            width: 160,
            render: (_: unknown, row: ArticleRow) => (
              <Space size={4}>
                {row.articleUrl ? (
                  <Button size="small" href={row.articleUrl} target="_blank">预览</Button>
                ) : null}
                <Popconfirm
                  title="删除这篇文章？"
                  description="内容站上的这篇也会一起去掉。"
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => remove(row.id)}
                >
                  <Button size="small" danger loading={removingId === row.id}>删除</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
    </>
  );
}
