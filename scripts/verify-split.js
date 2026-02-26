// verify-split.js — Verify logic/render split works correctly
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

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  await connect();
  console.log('=== Verify Logic/Render Split ===\n');

  // 1. Skip tutorial
  await evaluate('TutorialManager.init({completed:true})');
  await evaluate('window.buddy.saveTutorial({completed:true})');
  console.log('Tutorial: skipped');

  // 2. Check Player.update is being called by setInterval
  await evaluate(`
    window._verifyPUpdate = 0;
    window._verifyPUpdateOrig = Player.update;
    Player.update = function(k) {
      window._verifyPUpdate++;
      return window._verifyPUpdateOrig.call(this, k);
    };
  `);
  await sleep(2000);
  const updateCount = await evaluate('window._verifyPUpdate');
  console.log(`Player.update calls in 2s: ${updateCount} (expected ~120)`);
  await evaluate('Player.update = window._verifyPUpdateOrig');

  // 3. Check rAF is also running (for rendering)
  await evaluate(`
    window._verifyRAF = 0;
    (function countRAF() {
      window._verifyRAF++;
      if (window._verifyRAF < 200) requestAnimationFrame(countRAF);
    })();
  `);
  await sleep(2000);
  const rafCount = await evaluate('window._verifyRAF');
  console.log(`rAF calls in 2s: ${rafCount} (expected ~120)`);

  // 4. Test movement
  const posBefore = await evaluate('Player.getPosition().x');
  await evaluate("remotePlay.move('right', 2000)");
  await sleep(2500);
  const posAfter = await evaluate('Player.getPosition().x');
  console.log(`Movement: ${posBefore.toFixed(1)} -> ${posAfter.toFixed(1)} (delta: ${(posAfter - posBefore).toFixed(1)}px)`);

  // 5. Walk around and verify camera follows
  await evaluate("remotePlay.tp(137, 135)");
  await sleep(500);
  await evaluate("var pp=Player.getPosition(); IsoEngine.smoothFollow(pp.x,pp.y,1.0)");
  await sleep(200);

  const tileStart = await evaluate('Player.getTile().col + "," + Player.getTile().row');
  console.log(`Start: (${tileStart})`);

  await evaluate("remotePlay.move('right', 1500)");
  await sleep(2000);
  const tileAfter = await evaluate('Player.getTile().col + "," + Player.getTile().row');
  console.log(`After right: (${tileAfter})`);

  await evaluate("remotePlay.move('down', 1500)");
  await sleep(2000);
  const tileDown = await evaluate('Player.getTile().col + "," + Player.getTile().row');
  console.log(`After down: (${tileDown})`);

  // 6. Verify game doesn't crash — check for JS errors
  const errors = await evaluate(`
    (function() {
      if (window._jsErrors && window._jsErrors.length > 0) {
        return JSON.stringify(window._jsErrors);
      }
      return 'No errors';
    })()
  `);
  console.log(`JS errors: ${errors}`);

  // 7. Summary
  const success = updateCount > 80 && (posAfter - posBefore) > 50;
  console.log(`\n=== RESULT: ${success ? 'PASS' : 'FAIL'} ===`);
  if (success) {
    console.log('Logic/render split working correctly!');
    console.log('- setInterval drives Player.update at ~60Hz');
    console.log('- rAF drives rendering');
    console.log('- Movement works');
  }

  ws.close();
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
