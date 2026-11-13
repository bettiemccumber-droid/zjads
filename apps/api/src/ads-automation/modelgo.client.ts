import axios from 'axios';

/**
 * ModelGo 的调用配置。密钥只从环境变量读取。
 */
export function modelGoConfig(): { apiKey: string; baseUrl: string; model: string; enabled: boolean } {
  const apiKey = process.env.MODELGO_API_KEY?.trim() ?? '';
  const baseUrl = (process.env.MODELGO_BASE_URL?.trim() || 'https://api.modelgo.ai/v1').replace(/\/$/, '');
  const model = process.env.MODELGO_MODEL?.trim() ?? '';
  return { apiKey, baseUrl, model, enabled: apiKey.length > 0 };
}

let resolvedModel = '';

/**
 * 当前密钥可用的文本模型。优先用环境变量里指定的名字。
 */
export async function resolveModelGoModel(): Promise<string> {
  const config = modelGoConfig();
  if (!config.enabled) throw new Error('还没有配置 ModelGo 密钥');
  if (config.model) return config.model;
  if (resolvedModel) return resolvedModel;
  const response = await axios.get(`${config.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    timeout: 20000,
    validateStatus: () => true,
  });
  if (response.status >= 400) throw new Error(explainModelGoError(response.status, response.data));
  const ids = modelIds(response.data).filter((id) => !/embed|image|whisper|tts|rerank|video|audio/i.test(id));
  const preferred = [/sonnet/i, /claude/i, /gpt/i, /gemini/i];
  const picked = preferred.map((pattern) => ids.find((id) => pattern.test(id))).find(Boolean) ?? ids[0];
  if (!picked) throw new Error('ModelGo 没有可用的文本模型');
  resolvedModel = picked;
  return picked;
}

/**
 * 非流式对话。返回模型正文，不记录密钥。
 */
export async function completeModelGoChat(messages: Array<{ role: 'system' | 'user'; content: string }>): Promise<string> {
  const config = modelGoConfig();
  const model = await resolveModelGoModel();
  const response = await axios.post(
    `${config.baseUrl}/chat/completions`,
    { model, messages, temperature: 0.4, max_tokens: 1400 },
    {
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      timeout: 60000,
      validateStatus: () => true,
    },
  );
  if (response.status >= 400) throw new Error(explainModelGoError(response.status, response.data));
  const content = response.data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('ModelGo 没有返回文案');
  return content;
}

/**
 * 把接口错误翻成给员工看的话。不把密钥或整段响应带出去。
 */
export function explainModelGoError(status: number, body: unknown): string {
  const text = JSON.stringify(body ?? '').slice(0, 400);
  if (status === 401) return 'ModelGo 密钥无效，请在控制台重新建一把并更新服务器配置';
  if (status === 402 || /insufficient|balance|quota|credit|余额/i.test(text)) return 'ModelGo 余额不足，请先在控制台充值';
  if (status === 403) return 'ModelGo 不允许调用这个模型，请在模型广场换一个当前密钥能用的模型';
  return `ModelGo 调用失败（${status}）`;
}

/**
 * 从模型列表响应里取出模型 id。
 */
function modelIds(body: unknown): string[] {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return data
    .map((item) => (item && typeof item === 'object' ? (item as { id?: unknown }).id : ''))
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
}
