module.exports = async function handler(req, res) {
  const kvUrl = 'https://global-willing-cod-31627.upstash.io';
  const kvToken = 'AXeLASQgYjJhODFiNzItMTY2Yi00MzhkLTliMTctNmIwYjhhNTdmMTU3MWRjMmRlNjBmNzVkNDEzYThjWUE0TkEwTkE=';
  
  try {
    const kvRes = await fetch(`${kvUrl}/get/pw_cookies`, {
      headers: { Authorization: `Bearer ${kvToken}` }
    });
    const data = await kvRes.json();
    return res.status(200).json({ status: 'ok', upstashData: data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
