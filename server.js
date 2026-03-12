const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// MIME types
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Read body helper
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// Proxy routes - maps /proxy/<service>/* to the target service
function proxyRequest(req, res, targetBase, targetPath) {
  const parsedTarget = url.parse(targetBase);
  const isHttps = parsedTarget.protocol === 'https:';
  const lib = isHttps ? https : http;

  const proxyPath = targetPath + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');

  const parsedUrl = url.parse(proxyPath, true);
  delete parsedUrl.query['_base'];
  delete parsedUrl.query['_format'];

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
    rejectUnauthorized: false,
  };

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

const server = http.createServer(async (req, res) => {
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

  // GET /api/config — return saved config
  if (pathname === '/api/config' && req.method === 'GET') {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const data = fs.readFileSync(CONFIG_FILE, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(data);
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('null');
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /api/config — save config
  if (pathname === '/api/config' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      JSON.parse(body); // Validate JSON
      fs.writeFileSync(CONFIG_FILE, body, 'utf8');
      console.log('[CONFIG] Saved to', CONFIG_FILE);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
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

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
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
  console.log(`Config persisted to: ${CONFIG_FILE}`);
});
