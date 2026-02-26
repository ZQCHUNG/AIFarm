// verify-fixes.js — Verify bug fixes: buddy size, null tiles, corner-assist
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
  console.log('=== Verify Bug Fixes ===\n');

  // Skip tutorial if active
  await evaluate(`
    if (typeof TutorialManager !== 'undefined' && TutorialManager.isActive()) {
      TutorialManager.init({completed: true});
      if (window.buddy) window.buddy.saveTutorial({completed: true});
    }
  `);
  await sleep(500);

  // 1. Check SOLID_TILES — null should NOT be in it
  const solidCheck = await evaluate(`
    (function() {
      var hasNull = Player.SOLID_TILES.has(null);
      var hasUndef = Player.SOLID_TILES.has(undefined);
      var entries = [];
      Player.SOLID_TILES.forEach(function(v) { entries.push(String(v)); });
      return JSON.stringify({hasNull: hasNull, hasUndefined: hasUndef, entries: entries});
    })()
  `);
  console.log('1. SOLID_TILES check:', solidCheck);
  const solid = JSON.parse(solidCheck);
  console.log('   null removed:', !solid.hasNull ? 'PASS ✓' : 'FAIL ✗');

  // 2. Check entity rendering priority (draw before spriteId)
  const entityCheck = await evaluate(`
    (function() {
      var ent = Player.getEntity();
      return JSON.stringify({hasDraw: typeof ent.draw === 'function', spriteId: ent.spriteId});
    })()
  `);
  console.log('2. Entity draw check:', entityCheck);

  // 3. Test walking in all 4 directions (should work smoothly)
  console.log('\n3. Movement test (walk + reverse):');
  const startPos = await evaluate('Player.getTile().col + "," + Player.getTile().row');
  console.log('   Start:', startPos);

  for (const [dir, opp] of [['right','left'], ['down','up'], ['left','right'], ['up','down']]) {
    // Walk in direction
    await evaluate(`remotePlay.move('${dir}', 800)`);
    await sleep(1000);
    const after = await evaluate('Player.getTile().col + "," + Player.getTile().row');
    // Walk back
    await evaluate(`remotePlay.move('${opp}', 800)`);
    await sleep(1000);
    const back = await evaluate('Player.getTile().col + "," + Player.getTile().row');
    const returned = back === startPos;
    console.log(`   ${dir} → ${after}, back → ${back} ${returned ? 'RETURN OK ✓' : 'STUCK? ✗ (might be OK if near wall)'}`);
  }

  // 4. Corner-assist test: walk diagonally toward a fence, then reverse
  console.log('\n4. Corner-assist test (diagonal near fence):');
  // Walk toward top-right (likely toward a fence or boundary)
  await evaluate(`remotePlay.move('up', 2000)`);
  await sleep(2500);
  const upPos = await evaluate('Player.getTile().col + "," + Player.getTile().row');
  console.log('   After walking up 2s:', upPos);

  // Now walk down (this was the reported stuck direction)
  await evaluate(`remotePlay.move('down', 2000)`);
  await sleep(2500);
  const downPos = await evaluate('Player.getTile().col + "," + Player.getTile().row');
  console.log('   After walking down 2s:', downPos);
  console.log('   Movement reversed:', upPos !== downPos ? 'PASS ✓' : 'MIGHT BE STUCK ✗');

  // 5. Take screenshot to visually verify null tile visualization
  await screenshot('verify-fixes');

  // 6. Check null tile rendering (should see dark dirt overlay)
  const nullTileInfo = await evaluate(`
    (function() {
      var bounds = ChunkManager.getWorldBounds();
      var nullCount = 0;
      var total = 0;
      for (var r = bounds.minRow; r <= bounds.maxRow; r++) {
        for (var c = bounds.minCol; c <= bounds.maxCol; c++) {
          total++;
          var tile = IsoEngine.getTile(c, r);
          if (tile === null || tile === undefined) nullCount++;
        }
      }
      return 'Null tiles: ' + nullCount + ' / ' + total;
    })()
  `);
  console.log('\n5. Null tile count:', nullTileInfo);

  console.log('\n=== All checks complete ===');
  ws.close();
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
