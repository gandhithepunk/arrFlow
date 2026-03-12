const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// MIME types
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Proxy routes - maps /proxy/<service>/* to the target service
// The frontend passes ?_base=<encoded-url> to tell us where to proxy
function proxyRequest(req, res, targetBase, targetPath) {
  const parsedTarget = url.parse(targetBase);
  const isHttps = parsedTarget.protocol === 'https:';
  const lib = isHttps ? https : http;

  const proxyPath = targetPath + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');

  // Strip our internal params from the query string
  const parsedUrl = url.parse(proxyPath, true);
  delete parsedUrl.query['_base'];
  delete parsedUrl.query['_format'];

  // Rebuild query string without _base and _format
  const qs = Object.entries(parsedUrl.query)
    .filter(([k]) => !['_base', '_format'].includes(k))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const cleanPath = (parsedUrl.pathname || '') + (qs ? '?' + qs : '');

  const options = {
    hostname: parsedTarget.hostname,
    port: parsedTarget.port || (isHttps ? 443 : 80),
    path: cleanPath,
    method: req.method,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    rejectUnauthorized: false, // Allow self-signed certs (common in homelab)
  };

  // Forward relevant headers
  if (req.headers['x-api-key']) options.headers['X-Api-Key'] = req.headers['x-api-key'];
  if (req.headers['authorization']) options.headers['Authorization'] = req.headers['authorization'];

  const proxyReq = lib.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, {
      'Content-Type': proxyRes.headers['content-type'] || 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error(`Proxy error for ${targetBase}: ${err.message}`);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Proxy error', message: err.message }));
  });

  proxyReq.setTimeout(10000, () => {
    proxyReq.destroy();
    res.writeHead(504, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Gateway timeout' }));
  });

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key, Authorization',
    });
    res.end();
    return;
  }

  // Proxy routes: /proxy/<service>/<rest-of-path>?_base=<url>
  const proxyMatch = pathname.match(/^\/proxy\/([^/]+)(\/.*)?$/);
  if (proxyMatch) {
    const service = proxyMatch[1];
    const restPath = proxyMatch[2] || '/';
    const targetBase = parsedUrl.query._base ? decodeURIComponent(parsedUrl.query._base) : null;

    if (!targetBase) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing _base parameter' }));
      return;
    }

    console.log(`[PROXY] ${service} → ${targetBase}${restPath}`);
    proxyRequest(req, res, targetBase, restPath);
    return;
  }

  // Serve static files
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  // Security: prevent path traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // SPA fallback
        fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, data2) => {
          if (err2) { res.writeHead(404); res.end('Not found'); return; }
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(data2);
        });
      } else {
        res.writeHead(500);
        res.end('Server error');
      }
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`ARRFlow running on http://0.0.0.0:${PORT}`);
  console.log(`Proxy endpoint: http://0.0.0.0:${PORT}/proxy/<service>/<path>?_base=<encoded-service-url>`);
});
