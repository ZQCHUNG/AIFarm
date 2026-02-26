// collision-test.js — Focused collision and feature playtest
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const imgDir = path.join(__dirname, '..', 'Images', 'playtest3');
if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

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
  return r.result;
}

async function screenshot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (r.result && r.result.data) {
    const fp = path.join(imgDir, `${name}.png`);
    fs.writeFileSync(fp, Buffer.from(r.result.data, 'base64'));
    console.log(`  [Screenshot] ${name}`);
    return fp;
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function tp(col, row) {
  await evaluate(`remotePlay.tp(${col}, ${row})`);
  await sleep(200);
  await evaluate(`var pp=Player.getPosition(); IsoEngine.smoothFollow(pp.x,pp.y,1.0)`);
  await sleep(300);
}

async function getTile() {
  const r = await evaluate('JSON.stringify(Player.getTile())');
  return JSON.parse(r);
}

async function move(dir, ms) {
  await evaluate(`remotePlay.move('${dir}', ${ms})`);
  await sleep(ms + 500);
}

const findings = [];
function log(msg) { console.log(msg); findings.push(msg); }

async function run() {
  await connect();
  log('=== Collision & Feature Playtest ===\n');

  // ---- Test 1: Water collision ----
  log('--- Test 1: Water Collision ---');
  // Water at (144,140) and (145,140) — approach from left
  await tp(143, 140);
  await screenshot('01-before-water');
  let before = await getTile();
  log(`Before: (${before.col},${before.row})`);

  await move('right', 2000);
  let after = await getTile();
  log(`After walking right into water: (${after.col},${after.row})`);
  await screenshot('02-after-water-right');
  log(`Water blocked right: ${after.col < 144}`);

  // Water from top
  await tp(144, 139);
  before = await getTile();
  await move('down', 2000);
  after = await getTile();
  log(`Water from top: (${before.col},${before.row}) -> (${after.col},${after.row})`);
  log(`Water blocked down: ${after.row < 140}`);
  await screenshot('03-water-from-top');

  // Water from below
  await tp(144, 142);
  before = await getTile();
  await move('up', 2000);
  after = await getTile();
  log(`Water from below: (${before.col},${before.row}) -> (${after.col},${after.row})`);
  log(`Water blocked up: ${after.row > 141}`);

  // ---- Test 2: Fence collision ----
  log('\n--- Test 2: Fence Collision ---');
  // Fence at (149,128) — approach from (148,128)
  await tp(148, 128);
  await screenshot('04-before-fence');
  before = await getTile();
  await move('right', 1500);
  after = await getTile();
  log(`Fence right: (${before.col},${before.row}) -> (${after.col},${after.row})`);
  log(`Fence blocked: ${after.col < 149}`);
  await screenshot('05-after-fence');

  // ---- Test 3: Stone vs other tiles ----
  log('\n--- Test 3: Stone Tiles (should NOT be solid) ---');
  // Find stone tiles
  const stoneLocs = await evaluate(`(function(){
    var s=[];
    for(var r=143;r<=145;r++)
      for(var c=125;c<=155;c++)
        if(IsoEngine.getTile(c,r)==='stone') s.push({c:c,r:r});
    return JSON.stringify(s);
  })()`);
  const stones = JSON.parse(stoneLocs);
  log(`Stone tiles found: ${stones.length}`);
  if (stones.length > 0) {
    // Try walking onto a stone tile
    const st = stones[0];
    await tp(st.c - 1, st.r);
    before = await getTile();
    await move('right', 1500);
    after = await getTile();
    log(`Stone walk: (${before.col},${before.row}) -> (${after.col},${after.row}), target=(${st.c},${st.r})`);
    log(`Stone walkable: ${after.col >= st.c}`);
    await screenshot('06-stone-test');
  }

  // ---- Test 4: Long walk collision log ----
  log('\n--- Test 4: Walk Right from Spawn (collision log) ---');
  await tp(137, 135);
  await screenshot('07-walk-start');

  const walkLog = [];
  for (let i = 0; i < 18; i++) {
    before = await getTile();
    const tileAhead = await evaluate(`IsoEngine.getTile(${before.col + 1}, ${before.row})`);
    await move('right', 800);
    after = await getTile();
    const moved = after.col > before.col;
    const entry = moved
      ? `OK (${before.col}->${after.col}) tile=${tileAhead}`
      : `BLOCKED at (${before.col + 1},${before.row}) tile=${tileAhead}`;
    walkLog.push(entry);
  }
  log('Walk right from spawn:');
  for (const l of walkLog) log(`  ${l}`);
  await screenshot('08-walk-right-end');

  // Walk down
  log('\n--- Test 5: Walk Down (collision log) ---');
  const walkDownLog = [];
  for (let i = 0; i < 18; i++) {
    before = await getTile();
    const tileAhead = await evaluate(`IsoEngine.getTile(${before.col}, ${before.row + 1})`);
    await move('down', 800);
    after = await getTile();
    const moved = after.row > before.row;
    const entry = moved
      ? `OK (${before.row}->${after.row}) tile=${tileAhead}`
      : `BLOCKED at (${before.col},${before.row + 1}) tile=${tileAhead}`;
    walkDownLog.push(entry);
  }
  log('Walk down:');
  for (const l of walkDownLog) log(`  ${l}`);
  await screenshot('09-walk-down-end');

  // ---- Test 5: Walk left from east boundary ----
  log('\n--- Test 6: Walk Left from East ---');
  await tp(152, 135);
  for (let i = 0; i < 10; i++) {
    before = await getTile();
    const tileAhead = await evaluate(`IsoEngine.getTile(${before.col - 1}, ${before.row})`);
    await move('left', 800);
    after = await getTile();
    if (after.col >= before.col) {
      log(`  BLOCKED going left at (${before.col - 1},${before.row}) tile=${tileAhead}`);
    }
  }
  await screenshot('10-walk-left');

  // ---- Test 6: Specific grass inconsistency Joe mentioned ----
  log('\n--- Test 7: Grass/DarkGrass Walkability ---');
  // Check if darkgrass blocks or not
  const dgLoc = await evaluate(`(function(){
    for(var r=125;r<=150;r++)
      for(var c=125;c<=155;c++)
        if(IsoEngine.getTile(c,r)==='darkgrass') return JSON.stringify({c:c,r:r});
    return null;
  })()`);
  if (dgLoc) {
    const dg = JSON.parse(dgLoc);
    await tp(dg.c - 1, dg.r);
    before = await getTile();
    await move('right', 1500);
    after = await getTile();
    log(`DarkGrass at (${dg.c},${dg.r}): walked from (${before.col},${before.row}) to (${after.col},${after.row})`);
    log(`DarkGrass walkable: ${after.col >= dg.c}`);
    await screenshot('11-darkgrass-test');
  }

  // ---- Test 7: soilwet ----
  log('\n--- Test 8: SoilWet ---');
  const swLoc = await evaluate(`(function(){
    for(var r=125;r<=150;r++)
      for(var c=125;c<=155;c++)
        if(IsoEngine.getTile(c,r)==='soilwet') return JSON.stringify({c:c,r:r});
    return null;
  })()`);
  if (swLoc) {
    const sw = JSON.parse(swLoc);
    await tp(sw.c - 1, sw.r);
    before = await getTile();
    await move('right', 1500);
    after = await getTile();
    log(`SoilWet at (${sw.c},${sw.r}): walked from (${before.col},${before.row}) to (${after.col},${after.row})`);
    log(`SoilWet walkable: ${after.col >= sw.c}`);
  }

  // ---- Test 8: NPC System ----
  log('\n--- Test 9: NPC System ---');
  const npcInfo = await evaluate(`(function(){
    if(typeof NPCManager==='undefined') return 'No NPCManager';
    var npcs=NPCManager.getNPCs();
    return JSON.stringify(npcs.map(function(n){return{name:n.name,col:Math.floor(n.ai.col),row:Math.floor(n.ai.row)}}));
  })()`);
  log('NPCs: ' + npcInfo);

  if (npcInfo !== 'No NPCManager') {
    try {
      const npcs = JSON.parse(npcInfo);
      if (npcs.length > 0) {
        await tp(npcs[0].col, npcs[0].row);
        await screenshot('12-npc-visit');
        log(`Visited NPC: ${npcs[0].name} at (${npcs[0].col},${npcs[0].row})`);
      }
    } catch(e) {}
  }

  // ---- Test 9: Sprint stamina ----
  log('\n--- Test 10: Sprint Stamina ---');
  await tp(137, 135);
  const stamBefore = await evaluate('Player.getStamina()');
  // Sprint by setting shift in keys
  await evaluate(`(function(){
    remotePlay.move('right', 4000);
  })()`);
  await sleep(200);
  // Try setting sprint via direct key
  await evaluate(`(function(){
    document.dispatchEvent(new KeyboardEvent('keydown', {code:'ShiftLeft', key:'Shift', bubbles:true}));
  })()`);
  await sleep(4200);
  await evaluate(`(function(){
    document.dispatchEvent(new KeyboardEvent('keyup', {code:'ShiftLeft', key:'Shift', bubbles:true}));
  })()`);
  const stamAfter = await evaluate('Player.getStamina()');
  log(`Sprint: stamina ${stamBefore} -> ${stamAfter} (drained: ${stamBefore - stamAfter})`);
  await screenshot('13-sprint');

  // ---- Test 10: UI ----
  log('\n--- Test 11: UI Elements ---');
  await tp(137, 135);
  await sleep(300);

  // Tech tree
  await evaluate("remotePlay.press('r')");
  await sleep(600);
  await screenshot('14-techtree');
  await evaluate("remotePlay.press('r')");
  await sleep(300);

  // Interact near farm buildings
  await tp(136, 131);
  await evaluate("remotePlay.press('e')");
  await sleep(600);
  await screenshot('15-interact');
  await evaluate("remotePlay.press('Escape')");
  await sleep(300);

  // HUD info
  const hud = await evaluate(`(function(){
    var r={};
    r.tile=Player.getTile();
    r.stamina=Player.getStamina();
    r.moving=Player.isMoving();
    r.state=Player.getState();
    return JSON.stringify(r);
  })()`);
  log('HUD: ' + hud);

  // ---- Test 11: Map boundary ----
  log('\n--- Test 12: Map Boundaries ---');
  // East
  await tp(155, 135);
  await move('right', 3000);
  after = await getTile();
  log(`East boundary: ended at (${after.col},${after.row})`);
  await screenshot('16-east-boundary');

  // North
  await tp(137, 125);
  await move('up', 3000);
  after = await getTile();
  log(`North boundary: ended at (${after.col},${after.row})`);

  // South (row 143+ is stone/sand)
  await tp(137, 143);
  await move('down', 3000);
  after = await getTile();
  log(`South boundary: ended at (${after.col},${after.row})`);
  await screenshot('17-south-boundary');

  // ---- Final panoramic ----
  log('\n--- Final: Panoramic Walk ---');
  await tp(137, 135);
  for (const [dir, dur] of [['right',2500],['down',2500],['left',2500],['up',2500]]) {
    await move(dir, dur);
  }
  await screenshot('18-final');
  const finalTile = await getTile();
  log(`Final position: (${finalTile.col},${finalTile.row})`);

  // ---- Summary ----
  log('\n=== PLAYTEST SUMMARY ===');
  log(`Screenshots saved to: ${imgDir}`);

  const report = findings.join('\n');
  const reportPath = path.join(imgDir, 'playtest-report.txt');
  fs.writeFileSync(reportPath, report);
  log(`Report: ${reportPath}`);

  ws.close();
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
