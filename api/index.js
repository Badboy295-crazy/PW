const https = require('https');
const url = require('url');

// ── Origin IP Bypass ─────────────────────────────────────────────────────────
// Cloudflare Turnstile only runs on Cloudflare's EDGE, NOT on the origin server.
// Direct connection to AWS origin (75.2.60.68) bypasses Cloudflare completely.
const ORIGIN_IP = '75.2.60.68';
const ORIGIN_HOST = 'deltastudy.site';
const ORIGIN_PORT = 443;

// API Subdomain configuration
const API_IP = '75.2.97.79';
const API_HOST = 'apiserver.deltastudy.site';

const originAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true,
});

// In-memory cache to avoid KV latency on every request
let cachedCookies = null;
let cachedAdminIp = null;
let lastFetchTime = 0;
const CACHE_TTL = 3 * 60 * 1000; // 3 minutes cache

module.exports = async function handler(req, res) {
  // ── CORS Headers Setup ────────────────────────────────────────────────────
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

  // ── Determine Target ─────────────────────────────────────────────────────
  let isApiServer = false;
  let targetPath = req.url;
  let targetHost = ORIGIN_HOST;
  let targetIp = ORIGIN_IP;

  if (pathname.startsWith('/apiserver/')) {
    isApiServer = true;
    targetPath = req.url.replace(/^\/apiserver/, '');
    targetHost = API_HOST;
    targetIp = API_IP;
  }

  // ── Build forwarded headers ──────────────────────────────────────────────
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const lk = key.toLowerCase();
    if (
      lk !== 'host' &&
      lk !== 'connection' &&
      lk !== 'content-length' &&
      lk !== 'accept-encoding' // Strip to prevent compressed responses for string replacement
    ) {
      headers[key] = value;
    }
  }

  // Override host + referer so origin thinks request came from deltastudy itself
  headers['host']    = targetHost;
  headers['referer'] = `https://${ORIGIN_HOST}/`;
  headers['origin']  = `https://${ORIGIN_HOST}`;

  // ── Read cookies and admin IP from Upstash KV ────────────────────────────
  const kvUrl   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  let cookies = "";
  let adminIp = "";

  if (kvUrl && kvToken) {
    const now = Date.now();
    if (cachedCookies && (now - lastFetchTime < CACHE_TTL)) {
      cookies = cachedCookies;
      adminIp = cachedAdminIp;
    } else {
      try {
        // Read cookies from the shared "pi_cookies" key (covers deltastudy.site domain)
        const kvRes = await fetch(`${kvUrl}/get/pi_cookies`, {
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
            adminIp = cachedAdminIp;
          }
        }
      } catch (e) {
        console.error('KV read error:', e.message);
        cookies = cachedCookies || "";
        adminIp = cachedAdminIp || "";
      }
    }
  }

  if (cookies) {
    headers['cookie'] = cookies;
  }

  if (adminIp && adminIp !== 'origin-bypass') {
    headers['x-forwarded-for'] = adminIp;
    headers['x-real-ip']       = adminIp;
    headers['true-client-ip']  = adminIp;
  }

  // ── Read request body if needed ──────────────────────────────────────────
  let bodyBuffer = null;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    bodyBuffer = await getBodyBuffer(req);
    if (bodyBuffer.length > 0) {
      headers['content-length'] = String(bodyBuffer.length);
    }
  }

  // ── Proxy via DIRECT origin IP (bypasses Cloudflare) ────────────────────
  try {
    const proxyBody = await new Promise((resolve, reject) => {
      const reqOptions = {
        hostname:            targetIp,
        port:                ORIGIN_PORT,
        path:                targetPath,
        method:              req.method,
        headers:             headers,
        servername:          targetHost,    // SNI for TLS handshake
        agent:               originAgent,
        rejectUnauthorized:  false,
      };

      const proxyReq = https.request(reqOptions, (proxyRes) => {
        // Forward response status
        res.status(proxyRes.statusCode);

        const isStaticOrPlay =
          pathname.startsWith('/play') ||
          pathname.endsWith('.ts')     ||
          pathname.endsWith('.m3u8')   ||
          pathname.endsWith('.mp4')    ||
          pathname.startsWith('/_next/') ||
          pathname.startsWith('/static/');

        // Forward response headers
        for (const [key, value] of Object.entries(proxyRes.headers)) {
          const lk = key.toLowerCase();
          if (
            lk === 'transfer-encoding' ||
            lk === 'connection' ||
            lk === 'access-control-allow-origin' ||
            lk === 'access-control-allow-credentials' ||
            lk === 'access-control-allow-methods' ||
            lk === 'access-control-allow-headers'
          ) continue;
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

        // Collect response body
        const chunks = [];
        proxyRes.on('data', (c) => chunks.push(c));
        proxyRes.on('end',  ()  => resolve(Buffer.concat(chunks)));
        proxyRes.on('error', reject);
      });

      proxyReq.on('error', reject);

      if (bodyBuffer && bodyBuffer.length > 0) {
        proxyReq.write(bodyBuffer);
      }
      proxyReq.end();
    });

    // ── HTML/JS/JSON String Replacements to proxy API subdomain ──────────────────
    const contentType = (res.getHeader('content-type') || '').toLowerCase();
    const isBinary =
      contentType.includes('image/') ||
      contentType.includes('video/') ||
      contentType.includes('audio/') ||
      contentType.includes('font/') ||
      contentType.includes('zip') ||
      contentType.includes('pdf') ||
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

      res.send(Buffer.from(bodyText, 'utf8'));
    } else {
      res.send(proxyBody);
    }

  } catch (e) {
    console.error('Proxy fetch error:', e.message);
    res.status(502).send('Proxy error: ' + e.message);
  }
};

function getBodyBuffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data',  (c)   => chunks.push(c));
    req.on('end',   ()    => resolve(Buffer.concat(chunks)));
    req.on('error', (err) => reject(err));
  });
}
