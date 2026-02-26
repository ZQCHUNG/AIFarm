// cdp-screenshot.js — Take screenshot via CDP without triggering save dialog
// Usage: node scripts/cdp-screenshot.js [filename]
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const name = process.argv[2] || `screenshot-${Date.now()}`;
const outPath = path.join(__dirname, '..', 'Images', `${name}.png`);

http.get('http://localhost:9222/json', res => {
  let d = ''; res.on('data', c => d += c); res.on('end', () => {
    const wsUrl = JSON.parse(d)[0].webSocketDebuggerUrl;
    const ws = new WebSocket(wsUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));
    });
    ws.on('message', raw => {
      const r = JSON.parse(raw);
      if (r.id === 1 && r.result) {
        fs.writeFileSync(outPath, Buffer.from(r.result.data, 'base64'));
        console.log(outPath);
        ws.close(); process.exit(0);
      }
    });
    setTimeout(() => process.exit(1), 5000);
  });
});
