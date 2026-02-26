// playtest.js — Automated playtest: walk around, test features, take screenshots
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const imgDir = path.join(__dirname, '..', 'Images', 'playtest');
if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

let ws;
let msgId = 0;
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
    console.log(`  Screenshot: ${name}.png`);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function move(dir, ms) {
  await evaluate(`remotePlay.move('${dir}', ${ms})`);
  await sleep(ms + 200);
}

async function run() {
  await connect();
  console.log('Connected to CDP\n');

  // Skip tutorial
  await evaluate("TutorialManager.init({completed:true}); window.buddy && window.buddy.saveTutorial && window.buddy.saveTutorial({completed:true})");
  await sleep(500);

  // Get initial state
  const debug = await evaluate("JSON.stringify(remotePlay.debug())");
  console.log('Initial state:', debug);

  // Wait for startup animation to finish
  console.log('\nWaiting for startup animation...');
  await sleep(3000);

  // Screenshot: initial view
  await screenshot('01-initial-view');

  // Test 1: Walk around — square patrol
  console.log('\n=== Test 1: Movement ===');
  const startTile = await evaluate("JSON.stringify(Player.getTile())");
  console.log('Start tile:', startTile);

  await move('right', 2000);
  await screenshot('02-walk-right');
  const afterRight = await evaluate("JSON.stringify(Player.getTile())");
  console.log('After right:', afterRight);

  await move('down', 2000);
  await screenshot('03-walk-down');
  const afterDown = await evaluate("JSON.stringify(Player.getTile())");
  console.log('After down:', afterDown);

  await move('left', 2000);
  await screenshot('04-walk-left');

  await move('up', 2000);
  await screenshot('05-walk-up');
  const afterSquare = await evaluate("JSON.stringify(Player.getTile())");
  console.log('After square:', afterSquare);

  // Test 2: Sprint
  console.log('\n=== Test 2: Sprint ===');
  await evaluate("remotePlay.move('right', 2000)");
  // Hold shift while moving
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Shift', bubbles:true}))");
  await sleep(2200);
  await evaluate("document.dispatchEvent(new KeyboardEvent('keyup', {key:'Shift', bubbles:true}))");
  await screenshot('06-after-sprint');
  const stamina = await evaluate("Player.getStamina()");
  console.log('Stamina after sprint:', stamina);

  // Test 3: Check HUD / debug info
  console.log('\n=== Test 3: Game State ===');
  const tile = await evaluate("JSON.stringify(Player.getTile())");
  const pos = await evaluate("JSON.stringify(Player.getPosition())");
  console.log('Final tile:', tile, 'pos:', pos);

  // Test 4: Check NPCs
  console.log('\n=== Test 4: NPCs ===');
  const npcCount = await evaluate("typeof NPCManager !== 'undefined' ? NPCManager.getNPCs().length : 0");
  console.log('NPC count:', npcCount);

  // Test 5: Check farm state
  console.log('\n=== Test 5: Farm State ===');
  const farmEnergy = await evaluate("typeof IsoFarm !== 'undefined' ? IsoFarm.getEnergy() : 'N/A'");
  console.log('Farm energy:', farmEnergy);

  // Test 6: Walk to different areas and screenshot
  console.log('\n=== Test 6: Explore map ===');

  // Teleport to farm center
  await evaluate("remotePlay.tp(9, 7)");
  await sleep(1000);
  await screenshot('07-farm-center');

  // Walk around farm
  await move('right', 3000);
  await screenshot('08-farm-east');

  await move('down', 3000);
  await screenshot('09-farm-south');

  // Teleport to spawn area
  await evaluate("remotePlay.tp(137, 135)");
  await sleep(1000);
  await screenshot('10-spawn-area');

  // Test 7: Check weather
  console.log('\n=== Test 7: Weather ===');
  const weather = await evaluate("typeof WeatherSystem !== 'undefined' ? WeatherSystem.getCondition() : 'N/A'");
  console.log('Weather:', weather);

  // Test 8: Check time/season
  const season = await evaluate("typeof SeasonSystem !== 'undefined' ? SeasonSystem.getSeason() : 'N/A'");
  console.log('Season:', season);

  // Test 9: UI toggle test (press 'r' for resource panel)
  console.log('\n=== Test 9: UI Panels ===');
  await evaluate("remotePlay.press('r')");
  await sleep(500);
  await screenshot('11-resource-panel');
  await evaluate("remotePlay.press('r')");
  await sleep(300);

  // Test 10: Check achievements
  console.log('\n=== Test 10: Achievements ===');
  const achievements = await evaluate("typeof AchievementSystem !== 'undefined' ? JSON.stringify(AchievementSystem.getUnlocked()) : 'N/A'");
  console.log('Achievements:', achievements);

  // Final panoramic walk
  console.log('\n=== Final: Long exploration walk ===');
  await evaluate("remotePlay.tp(137, 135)");
  await sleep(500);

  for (const dir of ['right', 'down', 'left', 'up', 'right', 'down']) {
    await move(dir, 1500);
  }
  await screenshot('12-exploration-final');

  const finalTile = await evaluate("JSON.stringify(Player.getTile())");
  console.log('Final position:', finalTile);

  console.log('\n=== Playtest Complete ===');
  console.log(`Screenshots saved to: ${imgDir}`);

  ws.close();
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
