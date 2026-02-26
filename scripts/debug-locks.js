// debug-locks.js — Check all movement lock conditions via CDP
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
    console.error('JS Error:', r.result.exceptionDetails.text);
  }
  return r.result;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  await connect();

  console.log('=== Movement Debug ===\n');

  // Check locks
  const locks = await evaluate(`(function(){
    var r = {};
    r.modalLock = false;
    if (typeof TechTree !== 'undefined' && TechTree.isOpen()) r.modalLock = true;
    if (typeof MarketUI !== 'undefined' && MarketUI.isOpen()) r.modalLock = true;
    if (typeof BuildingInterior !== 'undefined' && BuildingInterior.isOpen()) r.modalLock = true;
    r.sceneLock = typeof IsoFarm !== 'undefined' && IsoFarm.isSceneLocked && IsoFarm.isSceneLocked();
    r.tutActive = typeof TutorialManager !== 'undefined' && TutorialManager.isActive();
    r.tutComplete = typeof TutorialManager !== 'undefined' && TutorialManager.isComplete();
    r.playerExists = typeof Player !== 'undefined';
    return JSON.stringify(r);
  })()`);
  console.log('Locks:', locks);

  // Check player state
  const pState = await evaluate(`(function(){
    var r = {};
    var p = Player.getPosition();
    r.px = p.x;
    r.py = p.y;
    r.tile = Player.getTile();
    r.moving = Player.isMoving();
    r.state = Player.getState();
    r.stamina = Player.getStamina();
    return JSON.stringify(r);
  })()`);
  console.log('Player:', pState);

  // Test movement — set key and check position after
  console.log('\nStarting movement test...');
  await evaluate("remotePlay.move('right', 3000)");
  console.log('Key set. Checking activeKeys...');

  const debug1 = await evaluate("JSON.stringify(remotePlay.debug())");
  console.log('Debug:', debug1);

  // Wait and check position every 500ms
  for (let i = 0; i < 6; i++) {
    await sleep(500);
    const pos = await evaluate("Player.getPosition().x + ',' + Player.getPosition().y + ' moving=' + Player.isMoving()");
    console.log(`  t=${(i+1)*500}ms: ${pos}`);
  }

  // Check if rAF is actually running
  console.log('\nChecking rAF...');
  await evaluate("window._testFrame = 0; window._origRAF = window._origRAF || window.requestAnimationFrame");
  await sleep(100);
  const rafTest = await evaluate(`(function(){
    var count = 0;
    function tick() { count++; if (count < 5) requestAnimationFrame(tick); }
    requestAnimationFrame(tick);
    return 'rAF test started';
  })()`);
  console.log(rafTest);
  await sleep(200);

  // Try direct Player.update call
  console.log('\nDirect Player.update test:');
  const before = await evaluate("Player.getPosition().x");
  await evaluate("Player.update({ArrowRight: true})");
  const after = await evaluate("Player.getPosition().x");
  console.log(`Before: ${before}, After: ${after}, Moved: ${after - before}px`);

  // Try 10 direct updates
  for (let i = 0; i < 30; i++) {
    await evaluate("Player.update({ArrowRight: true})");
  }
  const after30 = await evaluate("Player.getPosition().x");
  console.log(`After 30 direct updates: ${after30}, Total moved: ${after30 - before}px`);

  ws.close();
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
