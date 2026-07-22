module.exports = async function handler(req, res) {
  const kvUrl = 'https://global-willing-cod-31627.upstash.io';
  const kvToken = 'AXeLASQgYjJhODFiNzItMTY2Yi00MzhkLTliMTctNmIwYjhhNTdmMTU3MWRjMmRlNjBmNzVkNDEzYThjWUE0TkEwTkE=';
  
  try {
    const kvRes = await fetch(`${kvUrl}/get/pw_cookies`, {
      headers: { Authorization: `Bearer ${kvToken}` }
    });
    const text = await kvRes.text();
    return res.status(200).json({ status: 'ok', httpStatus: kvRes.status, body: text });
  } catch (e) {
    return res.status(200).json({ error: e.message, stack: e.stack });
  }
};
