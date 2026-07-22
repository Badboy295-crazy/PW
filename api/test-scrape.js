module.exports = async function handler(req, res) {
  const token = 'ba70ac83bc71441481a4f6f1f6d469b26be12eca8fd';
  const targetUrl = encodeURIComponent('https://deltastudy.site/verify');
  const scrapeDoUrl = `https://api.scrape.do?token=${token}&url=${targetUrl}&pureCookies=true&render=true&customWait=5000&super=true`;

  try {
    const t0 = Date.now();
    const response = await fetch(scrapeDoUrl);
    const duration = Date.now() - t0;
    
    let allHeaders = {};
    response.headers.forEach((v, k) => allHeaders[k] = v);

    let getSetCookieResult = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : 'not a function';

    return res.status(200).json({
      tokenUsed: token,
      status: response.status,
      durationMs: duration,
      headers: allHeaders,
      getSetCookieResult: getSetCookieResult
    });
  } catch (e) {
    return res.status(500).json({ error: e.message, stack: e.stack });
  }
};
