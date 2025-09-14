// scripts/janaushadhi_scrape.js
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const urls = [
    'https://janaushadhi.gov.in/productportfolio/ProductmrpList',
    'https://janaushadhi.gov.in/productportfolio/Productmrp'
  ];
  const outCsv = path.join(__dirname, 'janaushadhi_products.csv');

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--disable-blink-features=AutomationControlled']
  });
  const context = await browser.newContext({
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118 Safari/537.36'
  });
  const page = await context.newPage();

  const collected = [];
  const jsonBuckets = [];

  // Intercept JSON responses and capture the largest arrays
  page.on('response', async (resp) => {
    try {
      const u = resp.url();
      const ct = resp.headers()['content-type'] || '';
      if (!u.includes('janaushadhi.gov.in')) return;
      if (!/application\/json/i.test(ct)) return;
      const json = await resp.json();

      // Walk the JSON and extract arrays; keep the biggest ones
      const arrays = [];
      const stack = [json];
      while (stack.length) {
        const cur = stack.pop();
        if (Array.isArray(cur)) arrays.push(cur);
        else if (cur && typeof cur === 'object') for (const k in cur) stack.push(cur[k]);
      }
      const biggest = arrays.sort((a,b)=>b.length-a.length)[0];
      if (biggest && biggest.length >= 100) jsonBuckets.push(biggest);
    } catch {}
  });

  // helper: try to paginate a lot (different frameworks use different selectors)
  async function exhaustPagination() {
    const nextSelectors = [
      'button:has-text("Next")',
      'a:has-text("Next")',
      '[aria-label="Next"]',
      '.paginate_button.next',
      '.pagination .next',
    ];
    for (let tries = 0; tries < 400; tries++) {
      let clicked = false;
      for (const sel of nextSelectors) {
        const el = await page.$(sel);
        if (el) {
          const disabled = await el.getAttribute('disabled');
          if (disabled) continue;
          await el.click().catch(()=>{});
          clicked = true;
          await page.waitForTimeout(800);
          break;
        }
      }
      if (!clicked) break;
    }
  }

  // helper: auto-scroll to trigger lazy loading
  async function autoScroll() {
    await page.evaluate(async () => {
      await new Promise(resolve => {
        let prev = 0, sameTicks = 0;
        const tick = () => {
          window.scrollBy(0, 2000);
          const h = document.documentElement.scrollHeight;
          if (h === prev) sameTicks++;
          else sameTicks = 0;
          prev = h;
          if (sameTicks >= 10) return resolve();
          setTimeout(tick, 200);
        };
        tick();
      });
    });
  }

  for (const url of urls) {
    console.log('→ Visiting', url);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1500);

    // Let the app fire some initial XHRs
    await page.waitForTimeout(2500);

    // Try to load as much as possible
    await autoScroll();
    await page.waitForTimeout(1000);
    await exhaustPagination();
    await page.waitForTimeout(1000);

    // Fallback: grab whatever is visible as text
    const lines = await page.evaluate(() => (document.body.innerText || '')
      .split(/\r?\n/).map(s => s.trim()).filter(Boolean));
    for (const ln of lines) {
      const nums = ln.match(/\d+(?:\.\d+)?/g); // last number on the line
      if (!nums) continue;
      const mrp = nums[nums.length - 1];
      const name = ln.replace(/^\d+[\.\)]\s*/, '').replace(/\s·\s.*$/, '').trim();
      if (name && mrp) collected.push([name, mrp]);
    }
  }

  // Prefer JSON buckets if present
  let jsonRows = [];
  for (const arr of jsonBuckets) {
    for (const item of arr) {
      const name = item.product_name || item.ProductName || item.name || item.title || '';
      const mrp  = item.mrp || item.MRP || item.price || item.Price || '';
      if (name) jsonRows.push([String(name), String(mrp)]);
    }
  }

  const all = [...jsonRows, ...collected];
  const seen = new Set();
  const uniq = all.filter(r => {
    const key = `${String(r[0]||'').toLowerCase()}|${String(r[1]||'')}`;
    if (seen.has(key)) return false; seen.add(key); return true;
  });

  const csv = ['name,mrp', ...uniq.map(([n,m]) => `"${n.replace(/"/g,'""')}",${m}`)].join('\n');
  fs.writeFileSync(outCsv, csv);
  console.log(`💾 Saved ${outCsv} rows: ${uniq.length}`);

  await browser.close();
})();
