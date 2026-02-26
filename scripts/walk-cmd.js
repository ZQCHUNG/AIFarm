// walk-cmd.js — Send walk commands via CDP
// Usage: node scripts/walk-cmd.js <direction> [duration_ms]
// Directions: left, right, up, down

const WebSocket = require('ws');
const dir = (process.argv[2] || 'right').toLowerCase();
const duration = parseInt(process.argv[3]) || 3000;
const frames = Math.floor(duration / 16);

const KEY_MAP = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' };
const key = KEY_MAP[dir];
if (!key) { console.error('Unknown direction:', dir); process.exit(1); }

// Get WS URL
const http = require('http');
http.get('http://localhost:9222/json', res => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const wsUrl = JSON.parse(data)[0].webSocketDebuggerUrl;
    const ws = new WebSocket(wsUrl);
    ws.on('open', () => {
      const code = `(function(){var c=0;var t=setInterval(function(){Player.update({${key}:true});var p=Player.getPosition();IsoEngine.smoothFollow(p.x,p.y,0.08);IsoEngine.setPlayer(Player.getEntity());c++;if(c>=${frames})clearInterval(t);},16);return 'Walking ${dir} for ${duration}ms (${frames} frames)';})()`;
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: code, returnByValue: true } }));
    });
    ws.on('message', d => {
      const r = JSON.parse(d);
      if (r.id === 1) {
        console.log(r.result.value || JSON.stringify(r.result));
        ws.close();
        process.exit(0);
      }
    });
    setTimeout(() => process.exit(1), 5000);
  });
});
