import { useCallback, useEffect, useState } from 'react';
import { Button, Form, Input, Modal, Select, Space, Spin, Tabs, Tag, Typography, message } from 'antd';
import { CheckCircleFilled, DeleteOutlined, SmileOutlined } from '@ant-design/icons';
import { api, type ApiResult } from '../../api/client';
import './PersonaLibraryModal.css';

export interface AiPersonaItem {
  id: number;
  name: string;
  summary: string;
  tags: string[];
  systemPrompt: string;
  scope: string;
  builtin: boolean;
  useCount: number;
  active: boolean;
  owned: boolean;
}

interface PersonaLibraryData {
  activePersonaId: number | null;
  total: number;
  usedCount: number;
  items: AiPersonaItem[];
}

interface PersonaLibraryModalProps {
  open: boolean;
  onClose: () => void;
  onChanged?: (data: PersonaLibraryData) => void;
}

/**
 * AI 人设库弹窗：列表、激活、新建并激活、删除自己建的人设。
 */
export default function PersonaLibraryModal({ open, onClose, onChanged }: PersonaLibraryModalProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('library');
  const [data, setData] = useState<PersonaLibraryData | null>(null);
  const [form] = Form.useForm<{
    name: string;
    summary: string;
    tags: string[];
    systemPrompt: string;
  }>();

  const applyData = useCallback((next: PersonaLibraryData) => {
    setData(next);
    onChanged?.(next);
  }, [onChanged]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<ApiResult<PersonaLibraryData>>('/ai-personas');
      if (!res.data.success) {
        message.error(res.data.message || '加载人设失败');
        return;
      }
      applyData(res.data.data);
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : '加载人设失败');
    } finally {
      setLoading(false);
    }
  }, [applyData]);

  useEffect(() => {
    if (!open) return;
    setTab('library');
    form.resetFields();
    void load();
  }, [open, load, form]);

  const activate = async (id: number) => {
    setSaving(true);
    try {
      const res = await api.post<ApiResult<PersonaLibraryData>>(`/ai-personas/${id}/activate`);
      if (!res.data.success) {
        message.error(res.data.message || '激活失败');
        return;
      }
      applyData(res.data.data);
      message.success('已激活');
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : '激活失败');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    setSaving(true);
    try {
      const res = await api.delete<ApiResult<PersonaLibraryData>>(`/ai-personas/${id}`);
      if (!res.data.success) {
        message.error(res.data.message || '删除失败');
        return;
      }
      applyData(res.data.data);
      message.success('人设已删除');
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : '删除失败');
    } finally {
      setSaving(false);
    }
  };

  const createAndActivate = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const res = await api.post<ApiResult<PersonaLibraryData>>('/ai-personas', {
        name: values.name.trim(),
        summary: (values.summary || '').trim(),
        tags: values.tags ?? [],
        systemPrompt: (values.systemPrompt || '').trim(),
        activate: true,
      });
      if (!res.data.success) {
        message.error(res.data.message || '创建失败');
        return;
      }
      applyData(res.data.data);
      message.success(res.data.message || '人设已创建并激活');
      form.resetFields();
      setTab('library');
    } catch (error: unknown) {
      const apiMessage = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(apiMessage || (error instanceof Error ? error.message : '创建失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={720}
      destroyOnClose
      title={(
        <Space>
          <span className="persona-modal__icon"><SmileOutlined /></span>
          <span>AI 人设库管理</span>
        </Space>
      )}
      className="persona-modal"
    >
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'library',
            label: '人设库',
            children: loading && !data ? (
              <div className="persona-modal__loading"><Spin /></div>
            ) : (
              <div className="persona-list">
                {(data?.items ?? []).map((item) => (
                  <article
                    key={item.id}
                    className={`persona-card${item.active ? ' persona-card--active' : ''}`}
                  >
                    <div className="persona-card__head">
                      <div className="persona-card__title">
                        <Typography.Text strong>{item.name}</Typography.Text>
                        {item.builtin ? <Tag color="purple">系统内置</Tag> : <Tag>我的</Tag>}
                      </div>
                      {item.active ? (
                        <span className="persona-card__active"><CheckCircleFilled /> 激活中</span>
                      ) : (
                        <Button size="small" type="primary" ghost loading={saving} onClick={() => void activate(item.id)}>
                          激活
                        </Button>
                      )}
                    </div>
                    <p className="persona-card__summary">{item.summary}</p>
                    <div className="persona-card__tags">
                      {item.tags.map((tag) => (
                        <Tag key={tag} className="persona-card__tag">{tag}</Tag>
                      ))}
                    </div>
                    <pre className="persona-card__prompt">{item.systemPrompt}</pre>
                    {item.owned && !item.builtin ? (
                      <div className="persona-card__foot">
                        <Button
                          type="link"
                          danger
                          size="small"
                          icon={<DeleteOutlined />}
                          loading={saving}
                          onClick={() => void remove(item.id)}
                        >
                          删除
                        </Button>
                      </div>
                    ) : null}
                  </article>
                ))}
                {(data?.items.length ?? 0) === 0 ? (
                  <div className="persona-modal__empty">还没有人设</div>
                ) : null}
              </div>
            ),
          },
          {
            key: 'create',
            label: '+ 新建人设',
            children: (
              <Form
                form={form}
                layout="vertical"
                className="persona-create"
                initialValues={{ tags: [], summary: '', systemPrompt: '' }}
                onFinish={() => void createAndActivate()}
              >
                <Form.Item
                  name="name"
                  label="人设名称"
                  rules={[{ required: true, message: '请填写人设名称' }]}
                >
                  <Input
                    maxLength={30}
                    showCount
                    placeholder="例：激进增长派、保守稳健型"
                  />
                </Form.Item>
                <Form.Item name="tags" label="特征标签">
                  <Select
                    mode="tags"
                    tokenSeparators={[',', '，']}
                    maxCount={8}
                    placeholder="输入后回车添加，如：高预算激进、品牌优先"
                    open={false}
                  />
                </Form.Item>
                <Form.Item name="summary" label="人设描述">
                  <Input
                    maxLength={80}
                    showCount
                    placeholder="简要描述这个人设的定位和风格"
                  />
                </Form.Item>
                <Form.Item
                  name="systemPrompt"
                  label={(
                    <span>
                      核心提示词
                      <Typography.Text type="secondary" style={{ marginLeft: 8, fontWeight: 400 }}>
                        （不填则继承 Adrian 策略）
                      </Typography.Text>
                    </span>
                  )}
                >
                  <Input.TextArea
                    rows={7}
                    maxLength={2000}
                    showCount
                    placeholder="例：你是一位注重品牌形象的 Google Ads 专家，侧重高端定位和品牌词保护。关键词策略：精确匹配为主，不投 Broad Match…"
                  />
                </Form.Item>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={saving}
                  block
                  size="large"
                  className="persona-create__submit"
                  icon={<SmileOutlined />}
                >
                  创建并激活此人设
                </Button>
              </Form>
            ),
          },
        ]}
      />
    </Modal>
  );
}

/**
 * 拉取人设库摘要，给商家页面板用。
 */
export async function fetchPersonaSummary(): Promise<PersonaLibraryData | null> {
  const res = await api.get<ApiResult<PersonaLibraryData>>('/ai-personas');
  if (!res.data.success) return null;
  return res.data.data;
}
