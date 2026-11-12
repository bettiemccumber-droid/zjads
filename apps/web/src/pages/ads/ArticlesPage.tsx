import { useCallback, useEffect, useState } from 'react';
import { Alert, Table, Tag, Typography, message } from 'antd';
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

  const load = useCallback(async () => {
    const res = await api.get<ApiResult<ArticleRow[]>>('/articles');
    if (res.data.success) setRows(res.data.data);
  }, []);

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
          { title: '文章地址', dataIndex: 'articleUrl', render: (value: string) => value || '等待回写' },
          { title: '商家网址', dataIndex: 'merchantUrl' },
          { title: '跟踪链接', dataIndex: 'trackUrl', ellipsis: true },
          { title: '状态', dataIndex: 'publishStatus', render: (value: string) => <Tag>{STATUS_LABEL[value] ?? value}</Tag> },
        ]}
      />
    </>
  );
}
