const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const seeds = [
    'https://www.1mg.com/categories/health-conditions/fever/thermometers-167',
    'https://www.1mg.com/categories/medical-devices/health-monitors/thermometers-167'
  ];
  const outCsv = path.join(__dirname, 'branded_seed_1mg.csv');

  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-blink-features=AutomationControlled'] });
  const context = await browser.newContext({
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118 Safari/537.36'
  });
  const page = await context.newPage();

  const rows = [];
  for (const url of seeds) {
    console.log('→ Visiting', url);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);

    // 1) Try __NEXT_DATA__ (Next.js boot JSON)
    try {
      const nextJson = await page.$eval('script#__NEXT_DATA__', el => el.textContent);
      if (nextJson) {
        const data = JSON.parse(nextJson);
        const items = JSON.stringify(data);
        // pull "name" + "price" pairs heuristically
        const found = items.match(/"name":"([^"]+)".{0,200}?"price":\s*"?([\d,.]+)"?/g) || [];
        for (const m of found) {
          const name = (m.match(/"name":"([^"]+)"/)||[])[1];
          const price = (m.match(/"price":\s*"?([\d,.]+)"?/)||[])[1];
          if (name) rows.push({ source: '1mg', title: name, mrp: (price||'').replace(/[,₹]/g,''), url });
        }
      }
    } catch {}

    // 2) Try JSON-LD blocks
    try {
      const jsonBlocks = await page.$$eval('script[type="application/ld+json"]', els => els.map(e => e.textContent));
      for (const block of jsonBlocks) {
        try {
          const data = JSON.parse(block);
          const arr = Array.isArray(data) ? data : [data];
          for (const node of arr) {
            if (node['@type'] === 'ItemList' && Array.isArray(node.itemListElement)) {
              for (const item of node.itemListElement) {
                const prod = item.item || item;
                if (!prod) continue;
                const title = (prod.name || '').trim();
                let mrp = '';
                const off = prod.offers;
                if (off) {
                  if (Array.isArray(off) && off[0]?.price) mrp = String(off[0].price);
                  if (!Array.isArray(off) && off.price) mrp = String(off.price);
                }
                if (title) rows.push({ source: '1mg', title, mrp: mrp.replace(/[,₹]/g,''), url });
              }
            } else if (node['@type'] === 'Product') {
              const title = (node.name || '').trim();
              let mrp = '';
              const off = node.offers;
              if (off) {
                if (Array.isArray(off) && off[0]?.price) mrp = String(off[0].price);
                if (!Array.isArray(off) && off.price) mrp = String(off.price);
              }
              if (title) rows.push({ source: '1mg', title, mrp: mrp.replace(/[,₹]/g,''), url });
            }
          }
        } catch {}
      }
    } catch {}

    // 3) Last resort: visible text sniff
    if (!rows.length) {
      const body = await page.evaluate(() => document.body.innerText || '');
      const lines = body.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      for (const ln of lines) {
        if (!/[₹]|MRP/i.test(ln)) continue;
        const title = ln.split(/MRP|₹/i)[0].trim();
        const mrpMatch = ln.match(/(?:MRP\s*)?₹?\s*([\d,]+)/i);
        const mrp = mrpMatch ? mrpMatch[1].replace(/,/g,'') : '';
        if (title) rows.push({ source: '1mg', title: title.slice(0,200), mrp, url });
      }
    }
  }

  const csv = ['source,title,mrp,url', ...rows.map(r => `${r.source},"${(r.title||'').replace(/"/g,'""')}",${r.mrp||''},${r.url}`)].join('\n');
  fs.writeFileSync(outCsv, csv);
  console.log('💾 Saved', outCsv, 'rows:', rows.length);
  await browser.close();
})();
