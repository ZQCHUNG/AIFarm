// full-playtest.js — Comprehensive playtest: walk, collision check, screenshots, feature test
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const imgDir = path.join(__dirname, '..', 'Images', 'playtest2');
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
          if (r.id && pending.has(r.id)) {
            pending.get(r.id)(r);
            pending.delete(r.id);
          }
        });
        ws.on('error', reject);
      });
    });
  });
}

function send(method, params) {
  return new Promise((resolve) => {
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
    console.log(`  [Screenshot] ${name}.png`);
    return fp;
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function move(dir, ms) {
  await evaluate(`remotePlay.move('${dir}', ${ms})`);
  await sleep(ms + 300);
}

async function tp(col, row) {
  await evaluate(`remotePlay.tp(${col}, ${row})`);
  await sleep(200);
  // Snap camera
  await evaluate(`var pp=Player.getPosition(); IsoEngine.smoothFollow(pp.x,pp.y,1.0)`);
  await sleep(300);
}

async function getTile() {
  const r = await evaluate('JSON.stringify(Player.getTile())');
  return JSON.parse(r);
}

async function getTileType(col, row) {
  return await evaluate(`IsoEngine.getTile(${col}, ${row})`);
}

// Check collision around player
async function checkCollisionGrid(centerCol, centerRow, radius) {
  const result = [];
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      const c = centerCol + dc;
      const r = centerRow + dr;
      const tile = await getTileType(c, r);
      result.push({ col: c, row: r, tile, dc, dr });
    }
  }
  return result;
}

const findings = [];
function log(msg) {
  console.log(msg);
  findings.push(msg);
}

async function run() {
  await connect();
  log('=== AIFarm Full Playtest ===\n');

  // ---- Area 1: Spawn / Home area ----
  log('--- Area 1: Spawn Point ---');
  await tp(137, 135);
  await screenshot('01-spawn-home');
  let t = await getTile();
  log(`Spawn tile: (${t.col}, ${t.row})`);

  // Walk around spawn and document tiles
  log('\nCollision test around spawn:');
  const spawnGrid = await checkCollisionGrid(137, 135, 3);
  const tileTypes = {};
  for (const g of spawnGrid) {
    tileTypes[g.tile] = (tileTypes[g.tile] || 0) + 1;
  }
  log('Tile distribution: ' + JSON.stringify(tileTypes));

  // ---- Area 2: Farm plots ----
  log('\n--- Area 2: Farm Area ---');
  await tp(9, 7);
  await screenshot('02-farm-center');

  // Walk through farm
  await move('right', 2000);
  await screenshot('03-farm-right');

  await move('down', 2000);
  await screenshot('04-farm-south');

  // Check farm tile types
  const farmGrid = await checkCollisionGrid(9, 10, 4);
  const farmTiles = {};
  for (const g of farmGrid) {
    farmTiles[g.tile] = (farmTiles[g.tile] || 0) + 1;
  }
  log('Farm tile distribution: ' + JSON.stringify(farmTiles));

  // ---- Area 3: Water / Fishing ----
  log('\n--- Area 3: Water / Fishing ---');
  await tp(5, 5);
  await screenshot('05-water-area');

  // Try walking into water
  const beforeWater = await getTile();
  await move('left', 1500);
  const afterWater = await getTile();
  log(`Water collision test: before=(${beforeWater.col},${beforeWater.row}) after=(${afterWater.col},${afterWater.row})`);
  await screenshot('06-water-collision');

  // ---- Area 4: Mountain / Forest border ----
  log('\n--- Area 4: Mountain area ---');
  await tp(1, 1);
  await screenshot('07-mountain-topleft');

  const mtGrid = await checkCollisionGrid(1, 1, 3);
  const mtTiles = {};
  for (const g of mtGrid) {
    mtTiles[g.tile] = (mtTiles[g.tile] || 0) + 1;
  }
  log('Mountain tile distribution: ' + JSON.stringify(mtTiles));

  // ---- Area 5: Extended map (chunk border) ----
  log('\n--- Area 5: East exploration ---');
  await tp(150, 135);
  await screenshot('08-east-exploration');

  await move('right', 3000);
  await screenshot('09-east-far');
  t = await getTile();
  log(`East exploration reached: (${t.col}, ${t.row})`);

  // ---- Area 6: South exploration ----
  log('\n--- Area 6: South exploration ---');
  await tp(137, 150);
  await screenshot('10-south-exploration');

  await move('down', 3000);
  await screenshot('11-south-far');
  t = await getTile();
  log(`South exploration reached: (${t.col}, ${t.row})`);

  // ---- Collision inconsistency test ----
  log('\n--- Collision Consistency Test ---');
  // Walk systematically and log every blocked tile
  await tp(137, 135);
  const collisionLog = [];

  // Walk right 20 tiles, logging each step
  for (let i = 0; i < 20; i++) {
    const before = await getTile();
    await move('right', 200);
    const after = await getTile();
    const tileAhead = await getTileType(before.col + 1, before.row);
    if (before.col === after.col) {
      collisionLog.push({ blocked: true, at: `(${before.col+1},${before.row})`, tile: tileAhead });
    }
  }
  if (collisionLog.length > 0) {
    log('Blocked tiles walking right from spawn:');
    for (const c of collisionLog) {
      log(`  BLOCKED at ${c.at} — tile type: "${c.tile}"`);
    }
  } else {
    log('No blocked tiles walking right from spawn (20 tiles)');
  }
  await screenshot('12-after-collision-test');

  // Walk down from current position
  const collisionLogDown = [];
  for (let i = 0; i < 20; i++) {
    const before = await getTile();
    await move('down', 200);
    const after = await getTile();
    const tileAhead = await getTileType(before.col, before.row + 1);
    if (before.row === after.row) {
      collisionLogDown.push({ blocked: true, at: `(${before.col},${before.row+1})`, tile: tileAhead });
    }
  }
  if (collisionLogDown.length > 0) {
    log('Blocked tiles walking down:');
    for (const c of collisionLogDown) {
      log(`  BLOCKED at ${c.at} — tile type: "${c.tile}"`);
    }
  }
  await screenshot('13-after-down-collision');

  // ---- Feature tests ----
  log('\n--- Feature Tests ---');

  // Sprint
  await tp(137, 135);
  const staminaBefore = await evaluate('Player.getStamina()');
  await evaluate("remotePlay.move('right', 2000)");
  await sleep(100);
  // Simulate shift hold
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Shift', bubbles:true}))");
  await sleep(2200);
  await evaluate("document.dispatchEvent(new KeyboardEvent('keyup', {key:'Shift', bubbles:true}))");
  const staminaAfter = await evaluate('Player.getStamina()');
  log(`Sprint: stamina ${staminaBefore} -> ${staminaAfter}`);
  await screenshot('14-after-sprint');

  // NPC check
  const npcInfo = await evaluate(`(function(){
    if (typeof NPCManager === 'undefined') return 'No NPCManager';
    var npcs = NPCManager.getNPCs();
    return JSON.stringify(npcs.map(function(n){ return {name:n.name, col:Math.floor(n.ai.col), row:Math.floor(n.ai.row)}; }));
  })()`);
  log('NPCs: ' + npcInfo);

  // Teleport to NPC location
  try {
    const npcs = JSON.parse(npcInfo);
    if (npcs.length > 0) {
      await tp(npcs[0].col, npcs[0].row);
      await screenshot('15-npc-nearby');
      log(`Visited NPC: ${npcs[0].name} at (${npcs[0].col}, ${npcs[0].row})`);
    }
  } catch(e) {}

  // UI: Tech tree
  await tp(137, 135);
  await evaluate("remotePlay.press('r')");
  await sleep(600);
  await screenshot('16-ui-techtree');
  await evaluate("remotePlay.press('r')");
  await sleep(300);

  // UI: Press E near buildings
  await tp(9, 10);
  await sleep(300);
  await evaluate("remotePlay.press('e')");
  await sleep(600);
  await screenshot('17-ui-interact');
  await evaluate("remotePlay.press('Escape')");
  await sleep(300);

  // HUD info
  const hudInfo = await evaluate(`(function(){
    var r = {};
    r.tile = Player.getTile();
    r.energy = typeof IsoFarm !== 'undefined' ? IsoFarm.getEnergy() : 'N/A';
    r.stamina = Player.getStamina();
    r.moving = Player.isMoving();
    return JSON.stringify(r);
  })()`);
  log('HUD state: ' + hudInfo);

  // Final panoramic
  log('\n--- Final Panoramic Walk ---');
  await tp(137, 135);
  for (const [dir, dur] of [['right',2500],['down',2500],['left',2500],['up',2500]]) {
    await move(dir, dur);
  }
  await screenshot('18-final-position');
  t = await getTile();
  log(`Final tile: (${t.col}, ${t.row})`);

  // ---- Summary ----
  log('\n=== PLAYTEST SUMMARY ===');
  log(`Screenshots: ${imgDir}`);
  log(`Total findings: ${findings.length} lines`);

  // Save findings to file
  const reportPath = path.join(imgDir, 'playtest-report.txt');
  fs.writeFileSync(reportPath, findings.join('\n'));
  log(`Report saved: ${reportPath}`);

  ws.close();
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
