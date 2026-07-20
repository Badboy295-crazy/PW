const fallbackCookies = "";

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  
  const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  
  if (!kvUrl || !kvToken) {
    console.log("Vercel KV / Upstash not configured. Using fallback.");
    return res.status(200).json({ cookies: fallbackCookies });
  }
  
  try {
    const kvRes = await fetch(`${kvUrl}/get/pw_cookies`, {
      headers: {
        Authorization: `Bearer ${kvToken}`
      }
    });
    if (kvRes.ok) {
      const kvData = await kvRes.json();
      if (kvData.result) {
        const obj = JSON.parse(kvData.result);
        
        // Self-Healing Auto-Recovery: Trigger background solve if cookies are older than 29 minutes
        const now = Date.now();
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

        return res.status(200).json(obj);
      }
    }
  } catch (e) {
    console.error("KV read error:", e);
  }
  
  return res.status(200).json({ cookies: fallbackCookies });
};
