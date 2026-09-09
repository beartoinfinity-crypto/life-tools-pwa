const https = require('https');
const http = require('http');
const { parseLotteryExtreme, parseLotteryHk, parseGitHubData } = require('./parsers');

function fetchUrl(url, options = {}, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, {
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...options.headers
      }
    }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location && maxRedirects > 0) {
        let redirectUrl = res.headers.location;
        if (redirectUrl.startsWith('/')) {
          const parsed = new URL(url);
          redirectUrl = parsed.origin + redirectUrl;
        }
        res.resume();
        return fetchUrl(redirectUrl, options, maxRedirects - 1).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function scrapeLotteryExtreme() {
  try {
    const { status, data: html } = await fetchUrl('https://www.lotteryextreme.com/marksix/results');
    if (status === 200) {
      const draws = parseLotteryExtreme(html);
      if (draws.length > 0) return draws;
    }
  } catch (e) {
    console.log('lotteryextreme.com failed:', e.message);
  }
  return [];
}

async function scrapeLotteryHk(years) {
  const results = [];
  for (const year of years) {
    try {
      const { status, data: html } = await fetchUrl(`https://lottery.hk/en/mark-six/results/${year}`);
      if (status === 200) {
        const draws = parseLotteryHk(html);
        if (draws.length > 0) results.push(...draws);
      }
    } catch (e) {
      console.log(`lottery.hk/${year} failed:`, e.message);
    }
  }
  return results;
}

async function fetchGitHubData() {
  try {
    const { status, data } = await fetchUrl(
      'https://raw.githubusercontent.com/icelam/mark-six-data-visualization/master/data/all.json'
    );
    if (status === 200) return parseGitHubData(JSON.parse(data));
  } catch (e) {
    console.log('GitHub failed:', e.message);
  }
  return [];
}

module.exports = { fetchUrl, scrapeLotteryExtreme, scrapeLotteryHk, fetchGitHubData };
