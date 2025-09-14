// scripts/branded_1mg_playwright.js
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const seeds = [
    'https://www.1mg.com/categories/health-conditions/fever/thermometers-167',
    // add more category URLs here (pain-relief, cold & cough, antibiotics, etc.)
  ];
  const outCsv = path.join(__dirname, 'branded_seed_1mg.csv');

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();

  const rows = [];
  for (const url of seeds) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Pull all JSON-LD blocks and parse Products / ItemList
    const jsonBlocks = await page.$$eval('script[type="application/ld+json"]', els => els.map(e => e.textContent));
    for (const block of jsonBlocks) {
      try {
        const data = JSON.parse(block);
        const arr = Array.isArray(data) ? data : [data];
        for (const node of arr) {
          if (node['@type'] === 'ItemList' && Array.isArray(node.itemListElement)) {
            for (const item of node.itemListElement) {
              const prod = item.item || item; // sometimes nested
              if (prod && (prod['@type'] === 'Product' || prod.name)) {
                const title = (prod.name || '').trim();
                let mrp = '';
                if (prod.offers && (prod.offers.price || (prod.offers[0] && prod.offers[0].price))) {
                  const p = prod.offers.price || (prod.offers[0] && prod.offers[0].price);
                  mrp = String(p).replace(/[,₹]/g, '');
                }
                if (title) rows.push({ source: '1mg', title, mrp, url });
              }
            }
          } else if (node['@type'] === 'Product') {
            const title = (node.name || '').trim();
            let mrp = '';
            if (node.offers && (node.offers.price || (node.offers[0] && node.offers[0].price))) {
              const p = node.offers.price || (node.offers[0] && node.offers[0].price);
              mrp = String(p).replace(/[,₹]/g, '');
            }
            if (title) rows.push({ source: '1mg', title, mrp, url });
          }
        }
      } catch {}
    }
  }

  const csv = [
    'source,title,mrp,url',
    ...rows.map(r => `${r.source},"${(r.title||'').replace(/"/g,'""')}",${r.mrp||''},${r.url}`)
  ].join('\n');
  fs.writeFileSync(outCsv, csv);
  console.log('Saved', outCsv, 'rows:', rows.length);

  await browser.close();
})();
