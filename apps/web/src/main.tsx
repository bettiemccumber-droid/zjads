import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './index.css';

/**
 * 首页、隐私政策、条款的正文写在 HTML 里，给不执行脚本的审核程序看。
 * 其它页面才删掉这段，避免后台刷新时闪出首页说明。
 */
const publicPath = location.pathname.replace(/\/+$/, '') || '/';
if (publicPath !== '/' && publicPath !== '/privacy' && publicPath !== '/terms') {
  document.getElementById('compliance-fallback')?.remove();
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN}>
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
