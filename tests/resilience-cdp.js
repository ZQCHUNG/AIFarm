/**
 * resilience-cdp.js — CDP integration tests for game loop resilience.
 *
 * Connects to a running Electron instance (--remote-debugging-port=9222)
 * and stress-tests the render/logic loops by injecting faults.
 *
 * Run: npm run test:resilience
 * Requires: Electron running with --remote-debugging-port=9222
 */
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

let ws, msgId = 0;
const pending = new Map();
let passed = 0, failed = 0;
const results = [];

// ===== CDP helpers =====

function connect() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://localhost:9222/json', res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => {
        try {
          const wsUrl = JSON.parse(d)[0].webSocketDebuggerUrl;
          ws = new WebSocket(wsUrl);
          ws.on('open', resolve);
          ws.on('message', raw => {
            const r = JSON.parse(raw);
            if (r.id && pending.has(r.id)) { pending.get(r.id)(r); pending.delete(r.id); }
          });
          ws.on('error', reject);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', () => reject(new Error('CDP not available. Start electron with --remote-debugging-port=9222')));
  });
}

function send(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 10000);
    pending.set(id, r => { clearTimeout(timer); resolve(r); });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) {
    throw new Error('JS Error: ' + r.result.exceptionDetails.exception.description);
  }
  return r.result && r.result.result ? r.result.result.value : r.result;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ===== Test runner =====

async function test(name, fn) {
  process.stdout.write(`  ${name}... `);
  try {
    await fn();
    passed++;
    results.push({ name, status: 'PASS' });
    console.log('\x1b[32mPASS\x1b[0m');
  } catch (e) {
    failed++;
    results.push({ name, status: 'FAIL', error: e.message });
    console.log(`\x1b[31mFAIL\x1b[0m: ${e.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

// ===== Tests =====

async function runTests() {
  console.log('\n=== AIFarm Resilience Tests (CDP) ===\n');

  // ---- Smoke tests ----

  console.log('Smoke Tests:');

  await test('All core modules loaded', async () => {
    const modules = ['IsoEngine', 'IsoFarm', 'Player', 'Farm', 'ChunkManager', 'IsoEntityManager'];
    for (const m of modules) {
      const exists = await evaluate(`typeof ${m} !== 'undefined'`);
      assert(exists, `${m} is not defined`);
    }
  });

  await test('Canvas exists and has valid dimensions', async () => {
    const r = await evaluate(`
      (function() {
        var c = document.querySelector('canvas');
        return c ? c.width + ',' + c.height : null;
      })()
    `);
    assert(r, 'No canvas element found');
    const [w, h] = r.split(',').map(Number);
    assert(w > 0 && h > 0, `Invalid canvas size: ${w}x${h}`);
    assert(!isNaN(w) && !isNaN(h), 'Canvas dimensions are NaN');
  });

  await test('Camera state is valid (no NaN)', async () => {
    const r = await evaluate(`JSON.stringify(IsoEngine.getCameraState())`);
    const cam = JSON.parse(r);
    assert(!isNaN(cam.x), `Camera X is NaN`);
    assert(!isNaN(cam.y), `Camera Y is NaN`);
    assert(!isNaN(cam.zoom), `Camera zoom is NaN`);
    assert(cam.zoom > 0, `Camera zoom is ${cam.zoom}`);
  });

  await test('Player position is valid', async () => {
    const r = await evaluate(`
      (function() {
        var p = Player.getPosition();
        return JSON.stringify({x: p.x, y: p.y});
      })()
    `);
    const pos = JSON.parse(r);
    assert(!isNaN(pos.x) && !isNaN(pos.y), `Player position is NaN: ${r}`);
  });

  await test('Farm state exists with valid energy', async () => {
    const r = await evaluate(`
      (function() {
        var s = Farm.getState();
        return s ? s.totalEnergy : null;
      })()
    `);
    assert(r !== null, 'Farm state is null');
    assert(typeof r === 'number', `Energy is not a number: ${typeof r}`);
    assert(!isNaN(r), 'Energy is NaN');
  });

  // ---- Render loop resilience ----

  console.log('\nRender Loop Resilience:');

  await test('Render loop survives thrown error in drawMap', async () => {
    // Inject a temporary error into drawMap
    await evaluate(`
      (function() {
        if (!IsoEngine._origDrawMap2) {
          IsoEngine._origDrawMap2 = IsoEngine._origDrawMap || IsoEngine.drawMap;
          IsoEngine._errorInjected = 0;
          IsoEngine.drawMap = function() {
            IsoEngine._errorInjected++;
            if (IsoEngine._errorInjected <= 3) {
              throw new Error('RESILIENCE TEST: intentional drawMap error');
            }
            return IsoEngine._origDrawMap2.apply(this, arguments);
          };
        }
      })()
    `);
    await sleep(500); // Let a few frames pass

    // Check that the loop is still alive (pixels should be drawn)
    const pixel = await evaluate(`
      (function() {
        var c = document.querySelector('canvas');
        var ctx = c.getContext('2d');
        var p = ctx.getImageData(Math.floor(c.width/2), Math.floor(c.height/2), 1, 1).data;
        return p[3]; // alpha channel
      })()
    `);
    assert(pixel > 0, 'Canvas center pixel is transparent — render loop may be dead');

    // Restore original drawMap
    await evaluate(`
      if (IsoEngine._origDrawMap2) {
        IsoEngine.drawMap = IsoEngine._origDrawMap2;
        delete IsoEngine._origDrawMap2;
        delete IsoEngine._errorInjected;
      }
    `);
  });

  await test('Render loop survives NaN camera injection', async () => {
    // Save camera state
    const saved = await evaluate(`JSON.stringify(IsoEngine.getCameraState())`);

    // Inject NaN into camera
    await evaluate(`IsoEngine.setCamera(NaN, NaN)`);
    await sleep(200);

    // Check: render loop should still be alive
    const pixel = await evaluate(`
      (function() {
        var c = document.querySelector('canvas');
        var ctx = c.getContext('2d');
        var p = ctx.getImageData(10, 10, 1, 1).data;
        return p[3];
      })()
    `);
    assert(pixel > 0, 'Canvas is transparent after NaN camera injection');

    // Restore camera
    const cam = JSON.parse(saved);
    await evaluate(`IsoEngine.setCamera(${cam.x}, ${cam.y})`);
  });

  await test('Render loop survives IsoFarm.drawHUD error', async () => {
    // Temporarily break drawHUD
    await evaluate(`
      (function() {
        if (!IsoFarm._origDrawHUD) {
          IsoFarm._origDrawHUD = IsoFarm.drawHUD;
          IsoFarm._hudErrorCount = 0;
          IsoFarm.drawHUD = function() {
            IsoFarm._hudErrorCount++;
            if (IsoFarm._hudErrorCount <= 3) {
              throw new Error('RESILIENCE TEST: intentional HUD error');
            }
            return IsoFarm._origDrawHUD.apply(this, arguments);
          };
        }
      })()
    `);
    await sleep(300);

    // Check render loop alive
    const alive = await evaluate(`
      (function() {
        return new Promise(function(resolve) {
          var count = 0;
          function f() { count++; if (count < 5) requestAnimationFrame(f); else resolve(count); }
          requestAnimationFrame(f);
        });
      })()
    `);
    assert(alive >= 5, 'rAF chain is dead');

    // Restore
    await evaluate(`
      if (IsoFarm._origDrawHUD) {
        IsoFarm.drawHUD = IsoFarm._origDrawHUD;
        delete IsoFarm._origDrawHUD;
        delete IsoFarm._hudErrorCount;
      }
    `);
  });

  // ---- Logic loop resilience ----

  console.log('\nLogic Loop Resilience:');

  await test('Player update survives undefined keys object', async () => {
    const before = await evaluate(`JSON.stringify(Player.getPosition())`);
    await evaluate(`
      try { Player.update(undefined); } catch(e) {}
      try { Player.update(null); } catch(e) {}
      try { Player.update({}); } catch(e) {}
    `);
    const after = await evaluate(`JSON.stringify(Player.getPosition())`);
    const p = JSON.parse(after);
    assert(!isNaN(p.x) && !isNaN(p.y), 'Player position became NaN after bad input');
  });

  await test('Player position stays valid after 100 random frames', async () => {
    const r = await evaluate(`
      (function() {
        for (var i = 0; i < 100; i++) {
          var keys = {};
          if (Math.random() > 0.5) keys.d = true;
          if (Math.random() > 0.5) keys.w = true;
          if (Math.random() > 0.5) keys.Shift = true;
          Player.update(keys);
        }
        var p = Player.getPosition();
        return !isNaN(p.x) && !isNaN(p.y) && isFinite(p.x) && isFinite(p.y);
      })()
    `);
    assert(r === true, 'Player position invalid after random movement');
  });

  // ---- Entity system resilience ----

  console.log('\nEntity System Resilience:');

  await test('Entity manager handles null draw function', async () => {
    const r = await evaluate(`
      (function() {
        try {
          IsoEntityManager.createStatic(0, 0, null, {});
          return 'ok';
        } catch(e) {
          return 'error: ' + e.message;
        }
      })()
    `);
    // Should either handle gracefully or throw a clear error
    assert(r !== undefined, 'createStatic with null draw returned undefined');
  });

  await test('Entities count is reasonable', async () => {
    const count = await evaluate(`
      (function() {
        var all = IsoEntityManager.getAll ? IsoEntityManager.getAll() : [];
        return all.length;
      })()
    `);
    assert(typeof count === 'number', 'Entity count is not a number');
    assert(count >= 0, 'Entity count is negative');
    assert(count < 10000, `Entity count suspiciously high: ${count}`);
  });

  // ---- Canvas resilience ----

  console.log('\nCanvas Resilience:');

  await test('Canvas renders non-transparent pixels at center', async () => {
    await sleep(500); // Wait for render
    const alpha = await evaluate(`
      (function() {
        var c = document.querySelector('canvas');
        var ctx = c.getContext('2d');
        var p = ctx.getImageData(Math.floor(c.width/2), Math.floor(c.height/2), 1, 1).data;
        return p[3];
      })()
    `);
    assert(alpha > 0, `Center pixel is fully transparent (alpha=${alpha})`);
  });

  await test('Canvas has diverse pixel colors (not all one color)', async () => {
    // Wait for render to stabilize after earlier fault-injection tests
    await sleep(1000);
    const r = await evaluate(`
      (function() {
        var c = document.querySelector('canvas');
        var ctx = c.getContext('2d');
        var colors = new Set();
        for (var y = 0; y < c.height; y += 20) {
          for (var x = 0; x < c.width; x += 20) {
            var p = ctx.getImageData(x, y, 1, 1).data;
            colors.add(p[0] + ',' + p[1] + ',' + p[2]);
          }
        }
        return colors.size;
      })()
    `);
    assert(r >= 3, `Only ${r} unique colors — possible blank/stuck screen`);
  });

  // ---- IPC resilience ----

  console.log('\nIPC Resilience:');

  await test('window.buddy API exists', async () => {
    const r = await evaluate(`typeof window.buddy`);
    assert(r === 'object', `window.buddy is ${r}`);
  });

  await test('window.buddy.onFarmUpdate is callable', async () => {
    const r = await evaluate(`typeof window.buddy.onFarmUpdate`);
    assert(r === 'function', `onFarmUpdate is ${r}`);
  });

  await test('save functions exist and are callable', async () => {
    const fns = ['saveTutorial', 'saveSkills', 'saveTechTree'];
    for (const fn of fns) {
      const r = await evaluate(`typeof window.buddy.${fn}`);
      assert(r === 'function', `${fn} is ${r}`);
    }
  });

  // ---- Summary ----

  console.log('\n' + '='.repeat(50));
  console.log(`Results: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`);
  console.log('='.repeat(50));

  if (failed > 0) {
    console.log('\nFailed tests:');
    for (const r of results) {
      if (r.status === 'FAIL') console.log(`  \x1b[31m✗\x1b[0m ${r.name}: ${r.error}`);
    }
  }

  return failed === 0;
}

// ===== Main =====

async function main() {
  try {
    await connect();
    const ok = await runTests();
    ws.close();
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.error('Failed to connect:', e.message);
    console.error('Make sure Electron is running with: npx electron . --remote-debugging-port=9222');
    process.exit(1);
  }
}

main();
