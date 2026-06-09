/**
 * 统一 API 响应格式
 */
export function ok<T>(data: T, message = '') {
  return { success: true as const, data, message };
}

export function fail(message: string) {
  return { success: false as const, data: null, message };
}
