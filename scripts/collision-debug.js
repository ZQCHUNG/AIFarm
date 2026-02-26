// collision-debug.js — Diagnose collision issues around player
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

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

async function screenshot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (r.result && r.result.data) {
    const fp = path.join(__dirname, '..', 'Images', `${name}.png`);
    fs.writeFileSync(fp, Buffer.from(r.result.data, 'base64'));
    console.log(`  [Screenshot] ${name}`);
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  await connect();
  console.log('=== Collision Debug ===\n');

  // Get player position
  const pos = await evaluate(`
    (function() {
      var p = Player.getPosition();
      var t = Player.getTile();
      return JSON.stringify({px: p.x, py: p.y, col: t.col, row: t.row});
    })()
  `);
  const player = JSON.parse(pos);
  console.log(`Player at pixel (${player.px}, ${player.py}), tile (${player.col}, ${player.row})`);

  // Get 15x15 tile grid around player with null detection
  const gridResult = await evaluate(`
    (function() {
      var t = Player.getTile();
      var cc = t.col, cr = t.row;
      var lines = [];
      var nullCount = 0;
      for (var r = cr - 7; r <= cr + 7; r++) {
        var row = [];
        for (var c = cc - 7; c <= cc + 7; c++) {
          var tile = IsoEngine.getTile(c, r);
          if (tile === null || tile === undefined) {
            row.push('.');
            nullCount++;
          } else if (tile === 'grass') row.push('G');
          else if (tile === 'darkgrass') row.push('D');
          else if (tile === 'dirt') row.push('d');
          else if (tile === 'sand') row.push('s');
          else if (tile === 'path') row.push('P');
          else if (tile === 'water') row.push('W');
          else if (tile === 'fence') row.push('F');
          else if (tile === 'stone') row.push('S');
          else if (tile === 'mountain') row.push('M');
          else if (tile === 'soilwet') row.push('~');
          else if (tile === 'empty') row.push('E');
          else row.push('?');
        }
        lines.push(String(r).padStart(3) + '|' + row.join(''));
      }
      lines.push('    ' + '0123456789ABCDE');
      lines.push('Null tiles: ' + nullCount + ' / ' + (15*15));
      return lines.join('\\n');
    })()
  `);
  console.log('\nTile grid (. = null/blocking, G=grass, d=dirt, s=sand, F=fence, W=water):');
  console.log(gridResult);

  // Test walking in each direction and identify which tile blocks
  console.log('\n--- Movement test in 4 directions ---');
  for (const dir of ['right', 'left', 'up', 'down']) {
    const before = await evaluate('Player.getTile().col + "," + Player.getTile().row');
    await evaluate(`remotePlay.move('${dir}', 1000)`);
    await sleep(1500);
    const after = await evaluate('Player.getTile().col + "," + Player.getTile().row');
    const blocked = before === after;
    console.log(`  ${dir}: ${before} -> ${after} ${blocked ? 'BLOCKED' : 'OK'}`);
    // Return to original position
    if (!blocked) {
      const opp = dir === 'right' ? 'left' : dir === 'left' ? 'right' : dir === 'up' ? 'down' : 'up';
      await evaluate(`remotePlay.move('${opp}', 1000)`);
      await sleep(1500);
    }
  }

  // Check collision function directly around player
  console.log('\n--- Direct collision check (hitbox corners) ---');
  const collisionGrid = await evaluate(`
    (function() {
      var p = Player.getPosition();
      var results = [];
      // Check each pixel position in a 5-tile radius
      for (var dy = -2; dy <= 2; dy++) {
        var row = [];
        for (var dx = -2; dx <= 2; dx++) {
          var testX = p.x + dx * 32;
          var testY = p.y + dy * 32;
          var col = Math.floor(testX / 32);
          var rowN = Math.floor(testY / 32);
          var tile = IsoEngine.getTile(col, rowN);
          var solid = Player.SOLID_TILES.has(tile);
          row.push(solid ? 'X' : (tile ? tile[0] : '.'));
        }
        results.push(row.join(' '));
      }
      return results.join('\\n');
    })()
  `);
  console.log('Collision grid (X=solid, .=null/solid):');
  console.log(collisionGrid);

  // Check map bounds
  const mapInfo = await evaluate(`
    (function() {
      var size = IsoEngine.getMapSize ? IsoEngine.getMapSize() : null;
      var chunkInfo = typeof ChunkManager !== 'undefined' ? {
        homeOffset: ChunkManager.getHomeOffset(),
        loaded: ChunkManager.getLoadedChunks ? ChunkManager.getLoadedChunks() : 'no method'
      } : 'No ChunkManager';
      return JSON.stringify({mapSize: size, chunkInfo: chunkInfo});
    })()
  `);
  console.log('\nMap info:', mapInfo);

  await screenshot('collision-debug');

  ws.close();
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
