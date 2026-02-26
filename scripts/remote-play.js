/**
 * remote-play.js — Send game commands via Chrome DevTools Protocol.
 * Usage: node scripts/remote-play.js <command> [args...]
 *   move <dir> <ms>   — move player (left/right/up/down) for ms
 *   press <key>       — press a key (r, b, t, c, Escape, Enter, etc.)
 *   pos               — get player position
 *   screenshot        — take screenshot
 *   eval <js>         — evaluate arbitrary JS in renderer
 */
const WebSocket = require('ws');
const http = require('http');

async function getWsUrl() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json', (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        const pages = JSON.parse(data);
        const page = pages.find(p => p.type === 'page');
        if (page) resolve(page.webSocketDebuggerUrl);
        else reject(new Error('No page found'));
      });
    }).on('error', reject);
  });
}

async function sendCommand(js) {
  const wsUrl = await getWsUrl();
  const ws = new WebSocket(wsUrl);
  return new Promise((resolve, reject) => {
    ws.on('open', () => {
      const msg = JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression: js, returnByValue: true },
      });
      ws.send(msg);
    });
    ws.on('message', (data) => {
      const resp = JSON.parse(data.toString());
      if (resp.id === 1) {
        if (resp.result && resp.result.result) {
          console.log(JSON.stringify(resp.result.result.value, null, 2));
        } else {
          console.log(JSON.stringify(resp, null, 2));
        }
        ws.close();
        resolve();
      }
    });
    ws.on('error', reject);
    setTimeout(() => { ws.close(); reject(new Error('Timeout')); }, 5000);
  });
}

const [,, cmd, ...args] = process.argv;

switch (cmd) {
  case 'move':
    sendCommand(`remotePlay.move('${args[0]}', ${args[1] || 300})`);
    break;
  case 'press':
    sendCommand(`remotePlay.press('${args[0]}')`);
    break;
  case 'pos':
    sendCommand(`JSON.stringify(remotePlay.pos())`);
    break;
  case 'screenshot':
    // Use CDP Page.captureScreenshot directly (no user interaction needed)
    (async () => {
      const wsUrl = await getWsUrl();
      const ws = new WebSocket(wsUrl);
      ws.on('open', () => {
        ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));
      });
      ws.on('message', (data) => {
        const r = JSON.parse(data.toString());
        if (r.id === 1 && r.result) {
          const fs = require('fs');
          const file = args[0] || 'Images/screenshot-remote.png';
          fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
          console.log(`Screenshot saved to ${file}`);
          ws.close();
        }
      });
    })();
    break;
  case 'eval':
    sendCommand(args.join(' '));
    break;
  default:
    console.log('Usage: node remote-play.js <move|press|pos|screenshot|eval> [args]');
}
