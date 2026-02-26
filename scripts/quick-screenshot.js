// quick-screenshot.js <name> — Take a screenshot via CDP
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const name = process.argv[2] || 'screenshot';
const imgDir = path.join(__dirname, '..', 'Images');

http.get('http://localhost:9222/json', res => {
  let d = ''; res.on('data', c => d += c); res.on('end', () => {
    const wsUrl = JSON.parse(d)[0].webSocketDebuggerUrl;
    const ws = new WebSocket(wsUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));
    });
    ws.on('message', raw => {
      const r = JSON.parse(raw);
      if (r.id === 1 && r.result && r.result.data) {
        const fp = path.join(imgDir, `${name}.png`);
        fs.writeFileSync(fp, Buffer.from(r.result.data, 'base64'));
        console.log(`Screenshot: ${fp}`);
        ws.close();
        process.exit(0);
      }
    });
  });
});
