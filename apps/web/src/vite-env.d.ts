/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 生产 API 根路径，如 https://xxx.up.railway.app/api/v1 */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
