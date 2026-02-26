// reload-page.js — Force reload the page via CDP (ignoring cache)
const WebSocket = require('ws');
const http = require('http');

http.get('http://localhost:9222/json', res => {
  let d = ''; res.on('data', c => d += c); res.on('end', () => {
    const wsUrl = JSON.parse(d)[0].webSocketDebuggerUrl;
    const ws = new WebSocket(wsUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Page.reload', params: { ignoreCache: true } }));
    });
    ws.on('message', raw => {
      const r = JSON.parse(raw);
      if (r.id === 1) {
        console.log('Page reloaded (cache bypassed)');
        ws.close(); process.exit(0);
      }
    });
    setTimeout(() => process.exit(1), 5000);
  });
});
