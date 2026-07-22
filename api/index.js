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

let autoSolvedCookie = null;
let autoSolvedTime = 0;
const AUTO_SOLVE_TTL = 20 * 60 * 1000; // 20 minutes

async function getFreshScrapeDoCookie() {
  const now = Date.now();
  if (autoSolvedCookie && (now - autoSolvedTime < AUTO_SOLVE_TTL)) {
    return autoSolvedCookie;
  }

  const token = process.env.SCRAPEDO_TOKEN || 'ba70ac83bc71441481a4f6f1f6d469b26be12eca8fd';
  const targetUrl = encodeURIComponent('https://deltastudy.site/verify');
  const scrapeDoUrl = `https://api.scrape.do?token=${token}&url=${targetUrl}&pureCookies=true&render=true&customWait=15000`;

  try {
    const res = await fetch(scrapeDoUrl, { method: 'GET' });
    let rawHeaders = [];
    if (typeof res.headers.getSetCookie === 'function') {
      rawHeaders = res.headers.getSetCookie();
    }
    if (!rawHeaders || rawHeaders.length === 0) {
      const singleHeader = res.headers.get('set-cookie') || res.headers.get('x-set-cookie') || '';
      if (singleHeader) {
        rawHeaders = singleHeader.split(/,\s*(?=[^;]*=)/);
      }
    }
    
    let targetCookies = [];
    for (const header of rawHeaders) {
      const parts = header.split(';');
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.startsWith('delta_cf_verified=')) {
          targetCookies.push(trimmed);
        }
      }
    }

    if (targetCookies.length > 0) {
      autoSolvedCookie = targetCookies.join('; ');
      autoSolvedTime = now;
      console.log('Successfully auto-solved Turnstile cookie via Scrape.do:', autoSolvedCookie);
      return autoSolvedCookie;
    }
  } catch (e) {
    console.error('Error auto-solving Scrape.do cookie:', e.message);
  }

  return autoSolvedCookie || 'delta_cf_verified=1';
}

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

  // Render local key generation page for /deltapiro and /deltapro routes
  if (pathname === '/deltapiro' || pathname === '/deltapro' || pathname === '//deltapiro' || pathname === '//deltapro') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Delta Study - Key Generation</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
    <style>
        body {
            font-family: 'Inter', sans-serif;
            background-color: #050816;
            color: #f3f4f6;
            margin: 0;
            display: flex;
            height: 100vh;
            align-items: center;
            justify-content: center;
        }
        .container {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 16px;
        }
        .dots {
            display: flex;
            gap: 8px;
        }
        .dot {
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background-color: #6366f1;
            animation: pulse 1.4s infinite ease-in-out both;
        }
        .dot:nth-child(2) { animation-delay: 0.2s; }
        .dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes pulse {
            0%, 80%, 100% { transform: scale(0); }
            40% { transform: scale(1.0); }
        }
        .text {
            font-size: 18px;
            font-weight: 600;
            color: #9ca3af;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="dots">
            <div class="dot"></div>
            <div class="dot"></div>
            <div class="dot"></div>
        </div>
        <p class="text">Generating your key and redirecting...</p>
    </div>
    <script>
        (function() {
            try {
                var timestamp = new Date().getTime();
                var randomStr = Math.random().toString(36).substring(2);
                var key = "delta-key-" + timestamp + "-" + randomStr;
                var expiration = timestamp + 86400000; // 24 hours validity
                
                localStorage.setItem("delta-access-key", key);
                localStorage.setItem("delta-key-expiration", expiration.toString());
                
                console.log("Access key generated successfully!");
                setTimeout(function() {
                    window.location.replace("/");
                }, 1000);
            } catch (e) {
                console.error("Key generation failed:", e);
                window.location.replace("/");
            }
        })();
    </script>
</body>
</html>`);
  }

  // Determine Target Host and Path
  let targetPath = req.url;
  let targetHost = TARGET_HOST;

  if (pathname.startsWith('/apiserver/')) {
    targetPath = req.url.replace(/^\/apiserver/, '');
    targetHost = API_HOST;
  } else if (pathname.startsWith('/api/')) {
    targetHost = API_HOST;
  } else if (pathname === '/deltapiro' || pathname === '/deltapro' || pathname === '//deltapiro' || pathname === '//deltapro') {
    targetHost = 'pipro.deltastudy.site';
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

  if (targetHost === 'pipro.deltastudy.site') {
    headers['X-Delta-Friend-Key'] = 'pipro-only-lol';
  }

  // Read cookies and admin IP from Upstash KV
  const kvUrl   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL   || 'https://global-willing-cod-31627.upstash.io';
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || 'AXeLASQgYjJhODFiNzItMTY2Yi00MzhkLTliMTctNmIwYjhhNTdmMTU3MWRjMmRlNjBmNzVkNDEzYThjYThjNjA8Nzk5YzVhMjQ=';

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
        const cookieKey = (targetHost === 'pipro.deltastudy.site') ? 'pi_cookies' : 'pw_cookies';
        // Read cookies from the shared database
        const kvRes = await fetch(`${kvUrl}/get/${cookieKey}`, {
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

            // Self-Healing Auto-Recovery: Trigger background solve if cookies are older than 29 minutes
            const updatedAt = obj?.updatedAt || 0;
            const ageMs = now - updatedAt;
            const ageMin = ageMs / 60000;
            if (ageMin > 29) {
              const cronSecret = process.env.CRON_SECRET || 'autosync123';
              const currentHost = req.headers.host || '';
              const solveUrl = `https://${currentHost}/api/cron-solve?secret=${cronSecret}`;
              console.log(`[Auto-Recovery] Cookies are expired (${ageMin.toFixed(1)} mins old). Triggering background solve: ${solveUrl}`);
              fetch(solveUrl).catch(err => console.error('[Auto-Recovery] Solve trigger failed:', err.message));
            }
          }
        }
      } catch (e) {
        console.error('KV read error:', e.message);
        cookies = cachedCookies || "";
      }
    }
  }

  let freshTurnstileCookie = await getFreshScrapeDoCookie();
  let userOtherCookies = "";

  if (req.headers['cookie']) {
    // Strip old delta_cf_verified from user browser cookies so it doesn't overwrite real Turnstile token
    userOtherCookies = req.headers['cookie']
      .split(';')
      .map(c => c.trim())
      .filter(c => !c.toLowerCase().startsWith('delta_cf_verified='))
      .join('; ');
  }

  headers['cookie'] = freshTurnstileCookie + (userOtherCookies ? '; ' + userOtherCookies : '');

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
    const isText =
      contentType.includes('text/html') ||
      contentType.includes('text/css') ||
      contentType.includes('application/javascript') ||
      contentType.includes('text/javascript') ||
      contentType.includes('image/svg+xml');

    if (isText && proxyBody && proxyBody.length > 0) {
      const currentHost = req.headers.host || '';
      let bodyText = proxyBody.toString('utf8');

      // Replace apiserver.deltastudy.site domain with our proxied /apiserver path
      bodyText = bodyText.replaceAll('https://apiserver.deltastudy.site', `https://${currentHost}/apiserver`);
      bodyText = bodyText.replaceAll('http://apiserver.deltastudy.site', `http://${currentHost}/apiserver`);
      bodyText = bodyText.replaceAll('apiserver.deltastudy.site', `${currentHost}/apiserver`);

      // Inject CSS to hide the iframe's internal bell button and bottom bar to prevent duplication, 
      // and inject client-side script to auto-generate the link shortener key via /deltapiro.
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
        <script>
          (function() {
            try {
              var path = window.location.pathname;
              var isDeltaPRoute = path === '/deltapiro' || path === '/deltapro' || path === '//deltapiro' || path === '//deltapro';
              if (!isDeltaPRoute && path !== '/verify' && !path.startsWith('/api/')) {
                var key = localStorage.getItem('delta-access-key');
                var expiration = localStorage.getItem('delta-key-expiration');
                var isExpired = expiration ? (Date.now() > parseInt(expiration, 10)) : true;
                if (!key || isExpired) {
                  console.log('Redirecting to /deltapiro to generate access key...');
                  window.location.href = '/deltapiro';
                }
              }
            } catch (e) {
              console.error('Bypass script error:', e);
            }
          })();
        </script>
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
