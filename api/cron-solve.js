module.exports = async function handler(req, res) {
  // Simple authorization check
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers['authorization'] !== `Bearer ${cronSecret}` && req.query.secret !== cronSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const scrapeDoToken = process.env.SCRAPEDO_TOKEN;
  const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!scrapeDoToken) {
    return res.status(400).json({ error: "SCRAPEDO_TOKEN is not configured in Vercel environment variables." });
  }
  if (!kvUrl || !kvToken) {
    return res.status(400).json({ error: "Database not configured." });
  }

  // Check cookie age before calling Scrape.do to conserve API limits
  try {
    const kvCheck = await fetch(`${kvUrl}/get/pw_cookies`, {
      headers: { Authorization: `Bearer ${kvToken}` },
    });
    if (kvCheck.ok) {
      const kvCheckData = await kvCheck.json();
      if (kvCheckData.result) {
        const obj = JSON.parse(kvCheckData.result);
        const updatedAt = obj?.updatedAt || 0;
        const ageMs = Date.now() - updatedAt;
        const ageMin = ageMs / 60000;

        if (ageMin < 30) {
          console.log(`Cron-solve skipped. Cookies are fresh (${ageMin.toFixed(1)} mins old).`);
          return res.status(200).json({
            success: true,
            skipped: true,
            message: `Skipped solving. Cookies are fresh (age: ${ageMin.toFixed(1)} minutes).`
          });
        }
      }
    }
  } catch (e) {
    console.error('Error checking cookie age in cron-solve:', e.message);
  }

  const targetUrl = "https://deltastudy.site/verify";
  // Call Scrape.do with render=true and customWait=8000 to execute Cloudflare Turnstile JS
  const scrapeDoApiUrl = `https://api.scrape.do?token=${scrapeDoToken}&url=${encodeURIComponent(targetUrl)}&pureCookies=true&render=true&customWait=8000`;

  console.log("Triggering Scrape.do to solve Cloudflare Turnstile for deltastudy.site...");
  
  try {
    const response = await fetch(scrapeDoApiUrl);
    
    if (!response.ok) {
      const errText = await response.text();
      console.error("Scrape.do API error:", response.status, errText);
      return res.status(502).json({ error: "Scrape.do API failed", status: response.status, details: errText });
    }

    // Get all Set-Cookie headers from the response
    const setCookieHeaders = [];
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() == 'set-cookie') {
        setCookieHeaders.push(value);
      }
    });

    const customCookies = response.headers.get('x-set-cookie') || response.headers.get('set-cookie');
    if (customCookies) {
      setCookieHeaders.push(customCookies);
    }

    console.log("Received Set-Cookie headers:", setCookieHeaders);

    // Parse cookies
    let targetCookies = [];
    for (const header of setCookieHeaders) {
      const parts = header.split(/,(?=[^;]*=)/);
      for (const part of parts) {
        const cookie = part.split(';')[0].trim();
        if (cookie && !targetCookies.includes(cookie)) {
          targetCookies.push(cookie);
        }
      }
    }

    const cookiesStr = targetCookies.join('; ');
    console.log("Parsed Cookies String:", cookiesStr);

    if (!cookiesStr || !cookiesStr.includes('delta_cf_verified')) {
      return res.status(500).json({ 
        error: "Failed to capture delta_cf_verified cookie. Check Scrape.do logs.",
        parsedCookies: cookiesStr,
        headers: Object.fromEntries(response.headers.entries())
      });
    }

    // Save to Upstash
    const payload = {
      cookies: cookiesStr,
      adminIp: "104.28.166.255", // Proxy IP placeholder
      updatedAt: Date.now()
    };

    const kvRes = await fetch(`${kvUrl}/set/pw_cookies`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${kvToken}`
      },
      body: JSON.stringify(payload)
    });

    if (kvRes.ok) {
      console.log("Successfully saved fresh cookies to Upstash database.");
      return res.status(200).json({ success: true, message: "Cookies updated successfully", cookies: cookiesStr });
    } else {
      const kvErr = await kvRes.text();
      console.error("Failed to write to Upstash:", kvErr);
      return res.status(500).json({ error: "Database write failed", details: kvErr });
    }

  } catch (error) {
    console.error("Cron solver exception:", error);
    return res.status(500).json({ error: "Internal server error", message: error.message });
  }
};
