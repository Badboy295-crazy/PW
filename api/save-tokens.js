let localSavedCookie = null;
let localSavedTime = 0;

function hasValidTurnstileToken(cookiesStr) {
  if (!cookiesStr || !cookiesStr.includes('delta_cf_verified')) return false;
  const match = cookiesStr.match(/delta_cf_verified=([^;\s]+)/);
  if (match && match[1] && match[1].length > 25) {
    return true;
  }
  return false;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      success: true,
      hasCookie: !!localSavedCookie,
      cookie: localSavedCookie || "",
      updatedAt: localSavedTime
    });
  }

  const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  
  let cookies = "";
  if (typeof req.body === 'string') {
    try {
      const parsed = JSON.parse(req.body);
      cookies = parsed.cookies;
    } catch (e) {
      cookies = req.body;
    }
  } else if (req.body && req.body.cookies) {
    cookies = req.body.cookies;
  }
  
  if (!hasValidTurnstileToken(cookies)) {
    console.log("Ignoring request to save invalid/empty Turnstile cookie to prevent database corruption.");
    return res.status(200).json({ success: false, message: "Invalid/Dummy cookie ignored, keeping active database cookies." });
  }

  localSavedCookie = cookies;
  localSavedTime = Date.now();
  global.GLOBAL_SYNCED_COOKIE = cookies;
  global.GLOBAL_SYNCED_TIME = Date.now();

  const payload = {
    cookies: cookies,
    updatedAt: Date.now()
  };
  
  if (kvUrl && kvToken) {
    try {
      const kvRes = await fetch(`${kvUrl}/set/pw_cookies`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${kvToken}`
        },
        body: JSON.stringify(payload)
      });
      if (kvRes.ok) {
        console.log(`Successfully updated PW cookies in Upstash database.`);
      }
    } catch (e) {
      console.error("KV write error:", e.message);
    }
  }
  
  return res.status(200).json({ success: true, message: "Cookie saved in memory & Upstash" });
};
