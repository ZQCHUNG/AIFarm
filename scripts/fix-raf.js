// fix-raf.js — Force restart the game loop if rAF is paused
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

  // Check if window is visible
  console.log('Checking window state via Electron IPC...');

  // Force visibility by sending CDP Page.bringToFront
  console.log('Bringing page to front...');
  await send('Page.bringToFront', {});
  await sleep(500);

  // Check rAF count
  await evaluate('window._rafC = 0');
  await sleep(1000);
  const rafBefore = await evaluate('window._rafC');
  console.log('rAF count after 1s:', rafBefore);

  // Try using setInterval as fallback game loop
  console.log('\nForcing game loop restart via setInterval fallback...');
  const result = await evaluate(`
    (function() {
      // Check if there's a gameLoop function accessible
      if (typeof gameLoop === 'function') {
        return 'gameLoop function found';
      }
      // Check for startLoop or similar
      if (typeof startGameLoop === 'function') {
        return 'startGameLoop found';
      }
      return 'No game loop function found in global scope';
    })()
  `);
  console.log(result);

  // Force a single rAF to check if it works
  console.log('\nTesting single rAF...');
  const rafWork = await evaluate(`
    new Promise(function(resolve) {
      requestAnimationFrame(function() {
        resolve('rAF fired!');
      });
      setTimeout(function() { resolve('rAF timed out after 2s'); }, 2000);
    })
  `);
  // rAF returns a promise, need to use await
  await sleep(2500);
  const rafResult = await evaluate('window._lastRAFResult || "pending"');

  // Alternative: use the CDP Emulation to unthrottle
  console.log('\nTrying CDP Emulation.setScriptExecutionDisabled(false)...');
  // Just try to reload the page to restart the loop
  console.log('Reloading page to restart game loop...');
  await send('Page.reload', { ignoreCache: true });
  await sleep(5000);

  // Re-check
  const playerReady = await evaluate('typeof Player !== "undefined"');
  console.log('Player exists after reload:', playerReady);

  if (playerReady) {
    // Skip tutorial again
    await evaluate('TutorialManager.init({completed:true})');
    await evaluate('window.buddy.saveTutorial({completed:true})');

    // Check rAF
    await evaluate('window._rafTest = 0');
    await evaluate(`
      (function testRAF() {
        window._rafTest++;
        requestAnimationFrame(testRAF);
      })();
    `);
    await sleep(1000);
    const rafAfter = await evaluate('window._rafTest');
    console.log('rAF calls after reload in 1s:', rafAfter);

    // Check player update
    await evaluate(`
      window._pUpdateCount = 0;
      var orig = Player.update;
      Player.update = function(k) { window._pUpdateCount++; return orig.call(this, k); };
    `);
    await sleep(1000);
    const pCount = await evaluate('window._pUpdateCount');
    console.log('Player.update calls in 1s after reload:', pCount);

    // Test movement
    await evaluate("remotePlay.move('right', 2000)");
    await sleep(2500);
    const pos = await evaluate('Player.getPosition().x');
    console.log('Player X after move:', pos);
  }

  ws.close();
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
