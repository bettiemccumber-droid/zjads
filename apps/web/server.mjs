import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const port = Number(process.env.PORT || 4173);

/** 审核爬虫直接请求这些地址，必须返回完整 HTML，不能再落到首页。 */
const pages = {
  '/': 'home.html',
  '/about': 'about.html',
  '/about/': 'about.html',
  '/privacy': 'privacy.html',
  '/privacy/': 'privacy.html',
  '/terms': 'terms.html',
  '/terms/': 'terms.html',
};

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

/**
 * 静态文件服务。隐私政策和服务条款按固定地址返回独立页面，其余未知路径回到首页。
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
function handle(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  const mapped = pages[pathname];
  const relative = (mapped || pathname).replace(/^[/\\]+/, '');
  let filePath = path.resolve(root, relative);

  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  if (!mapped && (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory())) {
    filePath = path.join(root, 'index.html');
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const type = types[path.extname(filePath)] || 'application/octet-stream';
    const cache = type.startsWith('text/html') ? 'no-cache' : 'public, max-age=31536000, immutable';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache });
    res.end(data);
  });
}

http.createServer(handle).listen(port, '0.0.0.0');
