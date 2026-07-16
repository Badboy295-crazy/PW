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
        return res.status(200).json(JSON.parse(kvData.result));
      }
    }
  } catch (e) {
    console.error("KV read error:", e);
  }
  
  return res.status(200).json({ cookies: fallbackCookies });
};
