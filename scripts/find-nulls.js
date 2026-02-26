// find-nulls.js — Find all null tiles in the visible map area
const WebSocket = require('ws');
const http = require('http');

let ws, msgId = 0;
const pending = new Map();

function connect() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:9222/json', res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => {
        const wsUrl = JSON.parse(d)[0].webSocketDebuggerUrl;
        ws = new WebSocket(wsUrl);
        ws.on('open', resolve);
        ws.on('message', raw => {
          const r = JSON.parse(raw);
          if (r.id && pending.has(r.id)) { pending.get(r.id)(r); pending.delete(r.id); }
        });
        ws.on('error', reject);
      });
    });
  });
}

function send(method, params) {
  return new Promise(resolve => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r.result && r.result.result) return r.result.result.value;
  if (r.result && r.result.exceptionDetails) {
    return 'ERROR: ' + r.result.exceptionDetails.exception.description;
  }
  return r.result;
}

async function run() {
  await connect();
  console.log('=== Find Null Tiles ===\n');

  // Get chunk info
  const chunkInfo = await evaluate(`
    (function() {
      if (typeof ChunkManager === 'undefined') return 'No ChunkManager';
      var home = ChunkManager.getHomeOffset();
      var bounds = ChunkManager.getWorldBounds();
      return JSON.stringify({home: home, bounds: bounds});
    })()
  `);
  console.log('Chunk info:', chunkInfo);

  // Scan the full map area for null tiles
  const nullScan = await evaluate(`
    (function() {
      var bounds = ChunkManager.getWorldBounds();
      var nulls = [];
      var total = 0;
      for (var r = bounds.minRow; r <= bounds.maxRow; r++) {
        for (var c = bounds.minCol; c <= bounds.maxCol; c++) {
          total++;
          var tile = IsoEngine.getTile(c, r);
          if (tile === null || tile === undefined) {
            nulls.push('(' + c + ',' + r + ')');
          }
        }
      }
      return 'Total tiles: ' + total + ', Null tiles: ' + nulls.length + '\\nFirst 30 nulls: ' + nulls.slice(0, 30).join(', ');
    })()
  `);
  console.log(nullScan);

  // Draw the map as ASCII with null markers
  const mapAscii = await evaluate(`
    (function() {
      var bounds = ChunkManager.getWorldBounds();
      var lines = [];
      for (var r = bounds.minRow; r <= bounds.maxRow; r++) {
        var row = String(r).padStart(3) + '|';
        for (var c = bounds.minCol; c <= bounds.maxCol; c++) {
          var t = IsoEngine.getTile(c, r);
          if (!t) row += '.';
          else row += t[0].toUpperCase();
        }
        lines.push(row);
      }
      return lines.join('\\n');
    })()
  `);
  console.log('\nFull map (. = null):');
  console.log(mapAscii);

  ws.close();
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
