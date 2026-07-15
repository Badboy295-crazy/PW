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
