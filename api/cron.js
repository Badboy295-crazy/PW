const fetch = require('node-fetch');

module.exports = async function handler(req, res) {
  // Simple authentication via query parameter secret
  const reqSecret = req.query.secret;
  if (reqSecret !== 'autosync123') {
    return res.status(401).json({ error: 'Unauthorized. Invalid or missing secret parameter.' });
  }

  const githubPat = process.env.GITHUB_PAT;
  if (!githubPat) {
    return res.status(500).json({ error: 'GITHUB_PAT environment variable is not configured in Vercel.' });
  }

  const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (kvUrl && kvToken) {
    try {
      const kvRes = await fetch(`${kvUrl}/get/pw_cookies`, {
        headers: { Authorization: `Bearer ${kvToken}` },
      });
      if (kvRes.ok) {
        const kvData = await kvRes.json();
        if (kvData.result) {
          const obj = JSON.parse(kvData.result);
          const updatedAt = obj?.updatedAt || 0;
          const ageMs = Date.now() - updatedAt;
          const ageMin = ageMs / 60000;

          // If cookies are fresh (less than 25 minutes old), skip trigger
          if (ageMin < 25) {
            console.log(`Skipping sync. Cookies are still fresh (${ageMin.toFixed(1)} mins old).`);
            return res.status(200).json({
              success: true,
              skipped: true,
              message: `Skipped triggering workflow. Cookies are fresh (age: ${ageMin.toFixed(1)} minutes).`
            });
          }
        }
      }
    } catch (e) {
      console.error('Error checking cookie age from KV:', e.message);
      // Proceed to trigger if KV check fails to ensure safety
    }
  }

  // PW repository actions trigger
  const url = 'https://api.github.com/repos/Badboy295-crazy/PW/actions/workflows/sync.yml/dispatches';
  
  try {
    console.log("Triggering PW GitHub Actions workflow dispatch...");
    const ghRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${githubPat}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Vercel-Cron-Trigger',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ref: 'main' })
    });

    if (ghRes.status === 204) {
      console.log("GitHub Action successfully triggered!");
      return res.status(200).json({
        success: true,
        message: 'Successfully triggered PW GitHub Actions background solver!'
      });
    } else {
      const errText = await ghRes.text();
      console.error(`GitHub API returned status ${ghRes.status}: ${errText}`);
      return res.status(502).json({
        success: false,
        error: `GitHub API returned status ${ghRes.status}`,
        details: errText
      });
    }
  } catch (error) {
    console.error("Exception during GitHub trigger:", error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
