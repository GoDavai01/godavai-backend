// generateBanner.js
const { createCanvas, registerFont } = require('canvas');
const fs = require('fs');
const path = require('path');

// ========== THEMED BANNER GENERATOR FOR MEDICINE APP ==========

function drawIcon(ctx, icon, x, y, size = 90) {
  ctx.font = `bold ${size}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = 0.2; // semi-transparent for background effect
  ctx.fillText(icon, x, y);
  ctx.globalAlpha = 1;
}

function generateBanner({
  text = 'Get 25% off your next order if late!',
  width = 1000,
  height = 350,
  backgroundColor = '#24b9c7',
  textColor = '#fff',
  fontSize = 72,
  fontFamily = 'sans-serif',
  outFile = './public/images/offer1.png',
  icon = '💊',
  iconX = 150,
  iconY = 175,
  iconSize = 110,
  gradient = null
}) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background
  if (gradient) {
    const grad = ctx.createLinearGradient(0, 0, width, height);
    for (const stop of gradient) {
      grad.addColorStop(stop[0], stop[1]);
    }
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = backgroundColor;
  }
  ctx.fillRect(0, 0, width, height);

  // Draw left-side icon (emoji/pill)
  drawIcon(ctx, icon, iconX, iconY, iconSize);

  // Optional: Add a "shine" effect (subtle white ellipse)
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.beginPath();
  ctx.ellipse(width / 2, height / 2.5, width / 1.7, height / 3, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.restore();

  // Text styles
  ctx.font = `bold ${fontSize}px ${fontFamily}`;
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Wrap text if too long
  const words = text.split(' ');
  let line = '';
  const lines = [];
  const maxWidth = width * 0.70;
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      lines.push(line);
      line = words[n] + ' ';
    } else {
      line = testLine;
    }
  }
  lines.push(line);

  // Draw each line
  const lineHeight = fontSize * 1.12;
  const startY = height / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((l, i) => {
    ctx.shadowColor = '#2228'; // soft shadow
    ctx.shadowBlur = 8;
    ctx.fillText(l.trim(), width / 2 + 50, startY + i * lineHeight); // shift right for icon
    ctx.shadowBlur = 0;
  });

  // Ensure output directory exists
  const outDir = path.dirname(outFile);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // Save to file (production: handle errors)
  const out = fs.createWriteStream(outFile);
  const stream = canvas.createPNGStream();
  stream.pipe(out);
  out.on('finish', () => {
    // Production: minimal output, log only essential info
    // Remove or comment out the below log if you want no console output at all
    // console.log('Banner created:', outFile);
  });
  out.on('error', (err) => {
    // Log errors to file for production (optional)
    fs.appendFileSync('./banner_errors.log', `[${new Date().toISOString()}] Error writing ${outFile}: ${err}\n`);
  });
}

// -------- GENERATE ALL BANNERS --------

generateBanner({
  text: '💊 Get 25% off your next order if late!',
  backgroundColor: '#24b9c7',
  textColor: '#fff',
  fontSize: 68,
  outFile: './public/images/offer1.png',
  icon: '💊',
  iconX: 145,
  iconY: 175,
  iconSize: 110,
  // gradient: [[0, '#20e3b2'], [1, '#24b9c7']]
});

generateBanner({
  text: '🧴 Flat 15% OFF on all health supplements!',
  backgroundColor: '#13C0A2',
  textColor: '#fff',
  fontSize: 60,
  outFile: './public/images/offer2.png',
  icon: '🧴', // bottle emoji
  iconX: 145,
  iconY: 175,
  iconSize: 105,
  // gradient: [[0, '#FFD43B'], [1, '#13C0A2']]
});

generateBanner({
  text: '🚚 Free delivery on orders above ₹499!',
  backgroundColor: '#24b9c7',
  textColor: '#fff',
  fontSize: 62,
  outFile: './public/images/offer3.png',
  icon: '🚚',
  iconX: 135,
  iconY: 175,
  iconSize: 105,
  // gradient: [[0, '#fff9db'], [1, '#FFD43B']]
});

// Run with: node public/generateBanner.js
