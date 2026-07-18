const https = require('https');
const url = require('url');

// ── Target Configuration ───────────────────────────────────────────────────
const TARGET_HOST = 'deltastudy.site';
const API_HOST = 'apiserver.deltastudy.site';

const targetAgent = new https.Agent({
  keepAlive: true,
});

// In-memory cache to avoid KV latency on every request
let cachedCookies = null;
let cachedAdminIp = null;
let lastFetchTime = 0;
const CACHE_TTL = 15 * 1000; // 15 seconds cache

module.exports = async function handler(req, res) {
  // CORS Headers
  const reqOrigin = req.headers.origin;
  if (reqOrigin) {
    res.setHeader('Access-Control-Allow-Origin', reqOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Authorization, Cookie');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Determine Target Host and Path
  let targetPath = req.url;
  let targetHost = TARGET_HOST;

  if (pathname.startsWith('/apiserver/')) {
    targetPath = req.url.replace(/^\/apiserver/, '');
    targetHost = API_HOST;
  } else if (pathname.startsWith('/api/')) {
    targetHost = API_HOST;
  }

  // Build forwarded headers
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const lk = key.toLowerCase();
    if (lk !== 'host' && lk !== 'connection' && lk !== 'content-length' && lk !== 'accept-encoding') {
      headers[key] = value;
    }
  }

  // Override host + referer so origin thinks request came from target domain
  headers['host']    = targetHost;
  headers['referer'] = `https://${targetHost}/`;
  headers['origin']  = `https://${targetHost}`;

  // Read cookies and admin IP from Upstash KV
  const kvUrl   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  const isStaticOrPlay =
    pathname.startsWith('/play') ||
    pathname.endsWith('.ts')     ||
    pathname.endsWith('.m3u8')   ||
    pathname.endsWith('.mp4')    ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/static/');

  let cookies = "";

  if (!isStaticOrPlay && kvUrl && kvToken) {
    const now = Date.now();
    if (cachedCookies && (now - lastFetchTime < CACHE_TTL)) {
      cookies = cachedCookies;
    } else {
      try {
        // Read cookies from the shared "pw_cookies" key
        const kvRes = await fetch(`${kvUrl}/get/pw_cookies`, {
          headers: { Authorization: `Bearer ${kvToken}` },
        });
        if (kvRes.ok) {
          const kvData = await kvRes.json();
          if (kvData.result) {
            const obj = JSON.parse(kvData.result);
            cachedCookies = obj?.cookies || "";
            cachedAdminIp = obj?.adminIp || "";
            lastFetchTime = now;
            cookies = cachedCookies;
          }
        }
      } catch (e) {
        console.error('KV read error:', e.message);
        cookies = cachedCookies || "";
      }
    }
  }

  // Inject Bypass Cookie automatically for all users (Incognito/New Users)
  let finalCookies = cookies || "";
  if (!finalCookies.includes('delta_cf_verified')) {
    finalCookies = (finalCookies ? finalCookies + '; ' : '') + 'delta_cf_verified=1';
  }
  
  if (req.headers['cookie']) {
    finalCookies = finalCookies + '; ' + req.headers['cookie'];
  }

  headers['cookie'] = finalCookies;

  // Generate a random IP for every request to completely bypass upstream rate limiting (429)
  const randomIp = `${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`;
  headers['x-forwarded-for'] = randomIp;
  headers['x-real-ip']       = randomIp;
  headers['true-client-ip']  = randomIp;

  // Read request body if needed
  let bodyBuffer = null;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    bodyBuffer = await getBodyBuffer(req);
    if (bodyBuffer.length > 0) {
      headers['content-length'] = String(bodyBuffer.length);
    }
  }

  // Proxy Request via Target Domain
  try {
    const proxyResData = await makeRequest(targetHost, 443, targetPath, req.method, headers, bodyBuffer, targetAgent);

    res.status(proxyResData.statusCode);

    // Forward Headers
    for (const [key, value] of Object.entries(proxyResData.headers)) {
      const lk = key.toLowerCase();
      if (lk === 'transfer-encoding' || lk === 'connection' || lk === 'content-encoding') continue;
      if (lk === 'location') {
        res.setHeader(key, value.replace(`https://${targetHost}`, ''));
      } else if (lk === 'cache-control' && isStaticOrPlay) {
        res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600');
      } else {
        res.setHeader(key, value);
      }
    }

    if (isStaticOrPlay && !res.getHeader('Cache-Control')) {
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600');
    }

    const proxyBody = proxyResData.body;
    const contentType = (res.getHeader('content-type') || '').toLowerCase();
    const isBinary =
      contentType.includes('image/') ||
      contentType.includes('video/') ||
      contentType.includes('audio/') ||
      contentType.includes('font/') ||
      contentType.includes('zip') ||
      contentType.includes('pdf') ||
      contentType.includes('octet-stream') ||
      pathname.startsWith('/play') ||
      pathname.endsWith('.ts') ||
      pathname.endsWith('.mp4') ||
      pathname.endsWith('.m3u8') ||
      pathname.endsWith('.png') ||
      pathname.endsWith('.jpg') ||
      pathname.endsWith('.jpeg') ||
      pathname.endsWith('.gif') ||
      pathname.endsWith('.ico') ||
      pathname.endsWith('.woff') ||
      pathname.endsWith('.woff2');

    if (!isBinary && proxyBody && proxyBody.length > 0) {
      const currentHost = req.headers.host || '';
      let bodyText = proxyBody.toString('utf8');

      // Replace apiserver.deltastudy.site domain with our proxied /apiserver path
      bodyText = bodyText.replaceAll('https://apiserver.deltastudy.site', `https://${currentHost}/apiserver`);
      bodyText = bodyText.replaceAll('http://apiserver.deltastudy.site', `http://${currentHost}/apiserver`);
      bodyText = bodyText.replaceAll('apiserver.deltastudy.site', `${currentHost}/apiserver`);

      // Inject CSS to hide the iframe's internal bell button and bottom bar to prevent duplication
      const hideOverrides = `
        <style>
          .pwa-bell-btn, 
          .bell-btn, 
          .floating-bell, 
          #pwaBellBtn, 
          #bell-btn, 
          .pwa-bottom-bar, 
          #pwa-bottom-bar,
          [class*="bell"],
          [id*="bell"] { 
            display: none !important; 
          }
        </style>
      `;
      bodyText = bodyText.replace(/<\/head>/i, `${hideOverrides}</head>`);

      res.send(Buffer.from(bodyText, 'utf8'));
    } else {
      res.send(proxyBody);
    }

  } catch (e) {
    console.error('Proxy fetch error:', e.message);
    res.status(502).send('Proxy error: ' + e.message);
  }
};

function makeRequest(hostname, port, path, method, headers, bodyBuffer, agent) {
  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname,
      port,
      path,
      method,
      headers,
      servername: hostname,
      agent,
    };

    const proxyReq = https.request(reqOptions, (proxyRes) => {
      const chunks = [];
      proxyRes.on('data', (c) => chunks.push(c));
      proxyRes.on('end', () => {
        resolve({
          statusCode: proxyRes.statusCode,
          headers: proxyRes.headers,
          body: Buffer.concat(chunks)
        });
      });
      proxyRes.on('error', reject);
    });

    proxyReq.on('error', reject);
    if (bodyBuffer && bodyBuffer.length > 0) {
      proxyReq.write(bodyBuffer);
    }
    proxyReq.end();
  });
}

function getBodyBuffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data',  (c)   => chunks.push(c));
    req.on('end',   ()    => resolve(Buffer.concat(chunks)));
    req.on('error', (err) => reject(err));
  });
}
