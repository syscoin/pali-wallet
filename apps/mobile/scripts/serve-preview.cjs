const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../dist');
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.json': 'application/json',
  '.css': 'text/css',
};
http
  .createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(
        new URL(req.url, 'http://127.0.0.1').pathname
      );
      const file = path.resolve(
        root,
        '.' + (pathname === '/' ? '/index.html' : pathname)
      );
      if (!file.startsWith(root + path.sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const data = await fs.readFile(file);
      res.writeHead(200, {
        'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  })
  .listen(4178, '127.0.0.1', () =>
    console.log('Pali preview: http://127.0.0.1:4178')
  );
