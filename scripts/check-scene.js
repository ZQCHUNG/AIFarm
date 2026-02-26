// Quick CDP check for scene lock and game loop state
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

  // Check SceneManager lock
  const sceneLock = await evaluate(
    'typeof SceneManager !== "undefined" ? SceneManager.isInputLocked() : "no SceneManager"'
  );
  console.log('SceneManager.isInputLocked():', sceneLock);

  // Check IsoFarm startup animation
  const startup = await evaluate(
    'typeof IsoFarm !== "undefined" ? IsoFarm.isStartupAnimating() : "no IsoFarm"'
  );
  console.log('IsoFarm.isStartupAnimating():', startup);

  // Check IsoFarm sceneLocked
  const farmLock = await evaluate(
    'typeof IsoFarm !== "undefined" && IsoFarm.isSceneLocked ? IsoFarm.isSceneLocked() : "no method"'
  );
  console.log('IsoFarm.isSceneLocked():', farmLock);

  // Check tutorial
  const tut = await evaluate(
    'typeof TutorialManager !== "undefined" ? {active: TutorialManager.isActive(), complete: TutorialManager.isComplete()} : "no TutorialManager"'
  );
  console.log('Tutorial:', JSON.stringify(tut));

  // Instrument the game loop to verify it reaches Player.update
  console.log('\nInstrumenting game loop...');
  await evaluate(`
    window._debugPlayerUpdate = 0;
    window._debugPlayerUpdateOrig = Player.update;
    Player.update = function(k) {
      window._debugPlayerUpdate++;
      return window._debugPlayerUpdateOrig.call(this, k);
    };
  `);

  await sleep(2000);
  const updateCount = await evaluate('window._debugPlayerUpdate');
  console.log('Player.update called', updateCount, 'times in 2 seconds');

  // Restore original
  await evaluate('Player.update = window._debugPlayerUpdateOrig');

  // If update count is 0, the game loop is not reaching Player.update
  if (updateCount === 0) {
    console.log('\nGame loop NOT calling Player.update! Checking why...');

    // Check if the game loop function is running at all
    await evaluate(`
      window._debugLoopCount = 0;
    `);

    // Hook into requestAnimationFrame
    await evaluate(`
      window._debugRAFcount = 0;
      var origRAF = window.requestAnimationFrame;
      window.requestAnimationFrame = function(cb) {
        window._debugRAFcount++;
        return origRAF.call(window, cb);
      };
    `);

    await sleep(1000);
    const rafCount = await evaluate('window._debugRAFcount');
    console.log('requestAnimationFrame called', rafCount, 'times in 1 second');

    // Restore
    await evaluate('window.requestAnimationFrame = origRAF');
  } else {
    // Game loop IS calling Player.update, but player isn't moving
    // Let's check what keys the game loop sees
    console.log('\nGame loop IS calling Player.update. Testing with key injection...');

    await evaluate("remotePlay.move('right', 3000)");

    // Instrument to capture keys
    await evaluate(`
      window._debugKeysLog = [];
      window._debugPlayerUpdateOrig2 = Player.update;
      Player.update = function(k) {
        var active = Object.keys(k).filter(function(x){ return k[x]; });
        if (active.length > 0) window._debugKeysLog.push(active.join(','));
        return window._debugPlayerUpdateOrig2.call(this, k);
      };
    `);

    await sleep(1500);
    const keysLog = await evaluate('JSON.stringify(window._debugKeysLog.slice(0, 10))');
    console.log('Keys seen by Player.update:', keysLog);

    const posAfter = await evaluate('Player.getPosition().x + "," + Player.getPosition().y');
    console.log('Position after:', posAfter);

    // Restore
    await evaluate('Player.update = window._debugPlayerUpdateOrig2');
  }

  ws.close();
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
