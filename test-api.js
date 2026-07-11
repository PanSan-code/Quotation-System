const http = require('http');
const https = require('https');
const { URL } = require('url');

function fetchWithRedirect(url, options = {}, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('Too many redirects'));
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const reqOptions = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'node-test/1.0',
        ...(options.headers || {})
      },
      timeout: 60000
    };
    const req = lib.request(reqOptions, (res) => {
      console.log(`[${depth}] ${res.statusCode} ${u.href}`);
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const loc = res.headers.location;
        if (!loc) return reject(new Error('Redirect with no location'));
        const next = new URL(loc, u).href;
        res.resume();
        return resolve(fetchWithRedirect(next, options, depth + 1));
      }
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data, finalUrl: u.href }));
    });
    req.on('error', (err) => reject(err));
    req.on('timeout', () => { req.destroy(new Error('Timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

(async () => {
  try {
    const url = process.argv[2] || 'https://quote-system-api.zp1364625224.workers.dev/api/shipping-rates';
    const method = process.argv[3] || 'GET';
    const body = process.argv[4] || null;
    console.log('Fetching:', url, method);
    const r = await fetchWithRedirect(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body
    });
    console.log('Final URL:', r.finalUrl);
    console.log('Status:', r.status);
    console.log('Content-Type:', r.headers['content-type']);
    console.log('Content-Length:', r.headers['content-length']);
    console.log('Body length:', r.body.length);
    console.log('Body:');
    console.log(r.body);
  } catch (err) {
    console.error('Error:', err.message, err.code);
  }
})();
