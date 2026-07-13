module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!kvUrl || !kvToken) {
    return res.status(400).json({ error: "Database not configured" });
  }
  
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const adminIp = clientIp ? clientIp.split(',')[0].trim() : '';
  
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
  
  const payload = {
    cookies: cookies,
    adminIp: adminIp,
    updatedAt: Date.now()
  };
  
  try {
    const kvRes = await fetch(`${kvUrl}/set/pi_cookies`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${kvToken}`
      },
      body: JSON.stringify(payload)
    });
    if (kvRes.ok) {
      console.log(`Successfully updated Pi cookies and Admin IP (${adminIp}) in database.`);
      return res.status(200).json({ success: true });
    }
  } catch (e) {
    console.error("KV write error:", e);
  }
  
  return res.status(500).json({ error: "Failed to save cookies" });
};
