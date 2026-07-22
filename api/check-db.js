const https = require('https');

function fetchUpstash(urlStr, token) {
  return new Promise((resolve) => {
    const req = https.get(urlStr, {
      headers: { 'Authorization': `Bearer ${token}` }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
      });
    });
    req.on('error', (err) => resolve({ error: err.message }));
  });
}

module.exports = async function handler(req, res) {
  const kvUrl = 'https://global-willing-cod-31627.upstash.io';
  const kvToken = 'AXeLASQgYjJhODFiNzItMTY2Yi00MzhkLTliMTctNmIwYjhhNTdmMTU3MWRjMmRlNjBmNzVkNDEzYThjWUE0TkEwTkE=';
  
  const result = await fetchUpstash(`${kvUrl}/get/pw_cookies`, kvToken);
  return res.status(200).json({ status: 'ok', upstashData: result });
};
