// Local dev server. Serves /public and mounts the same /api handlers that
// Vercel runs as serverless functions, so local behavior matches production.
// NO cookies are ever set — re-identification is purely from the fingerprint.

const http = require('http');
const fs = require('fs');
const path = require('path');

const fp = require('./api/fp');

const PORT = process.env.PORT || 8080;
const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.mp4': 'video/mp4',
};

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://x');
  } catch {
    res.writeHead(400);
    return res.end('bad request');
  }
  if (url.pathname === '/api/fp') return fp(req, res);

  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(PUBLIC, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403);
    return res.end('no');
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => console.log('incognito-tracking on http://localhost:' + PORT));
