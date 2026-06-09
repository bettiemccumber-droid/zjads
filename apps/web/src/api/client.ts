import axios from 'axios';

const TOKEN_KEY = 'zjads_token';

/** 生产环境通过 VITE_API_URL 指向 Railway 等独立 API 域名；本地开发走 Vite 代理 */
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api/v1',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export interface ApiResult<T> {
  success: boolean;
  data: T;
  message: string;
}
