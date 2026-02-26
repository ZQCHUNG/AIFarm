// cdp-eval.js — Evaluate JS expression via CDP
// Usage: node scripts/cdp-eval.js "expression"

const WebSocket = require('ws');
const expr = process.argv[2];
if (!expr) { console.error('Usage: node cdp-eval.js "expression"'); process.exit(1); }

const http = require('http');
http.get('http://localhost:9222/json', res => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const wsUrl = JSON.parse(data)[0].webSocketDebuggerUrl;
    const ws = new WebSocket(wsUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
    });
    ws.on('message', d => {
      const r = JSON.parse(d);
      if (r.id === 1) {
        if (r.result && r.result.result) {
          console.log(r.result.result.value !== undefined ? r.result.result.value : JSON.stringify(r.result.result));
        } else {
          console.log(JSON.stringify(r));
        }
        ws.close();
        process.exit(0);
      }
    });
    setTimeout(() => { console.log('timeout'); process.exit(1); }, 5000);
  });
});
