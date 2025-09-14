// scripts/convert_jana_xlsx_to_csv.js
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const inXlsx = path.join(__dirname, 'janaushadhi_products.xlsx');
const outCsv = path.join(__dirname, 'janaushadhi_products.csv');

const wb = XLSX.readFile(inXlsx);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

const headers = Object.keys(rows[0] || {});
const csv = [headers.join(','), ...rows.map(r => headers.map(h => `"${String(r[h]).replace(/"/g,'""')}"`).join(','))].join('\n');

fs.writeFileSync(outCsv, csv);
console.log('💾 Saved', outCsv, 'rows:', rows.length);
