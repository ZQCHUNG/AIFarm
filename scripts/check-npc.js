// check-npc.js — Investigate why NPCs are empty
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

async function run() {
  await connect();
  console.log('=== NPC Investigation ===\n');

  // 1. Check NPCManager exists
  const exists = await evaluate('typeof NPCManager !== "undefined"');
  console.log('NPCManager exists:', exists);

  // 2. Check NPC count
  const count = await evaluate('NPCManager.getNPCCount()');
  console.log('NPC count:', count);

  // 3. Check if init was called — look at internal state
  const npcs = await evaluate('JSON.stringify(NPCManager.getNPCs().map(function(n){ return {name: n.profile.name, id: n.id}; }))');
  console.log('NPCs:', npcs);

  // 4. Check session history in Farm state
  const sessHist = await evaluate(`
    (function() {
      // The renderer stores Farm state — check if sessionHistory was received
      if (typeof Farm !== 'undefined' && Farm.getState) {
        var state = Farm.getState();
        if (state && state.sessionHistory) {
          return 'sessionHistory: ' + state.sessionHistory.length + ' sessions';
        }
        return 'Farm.getState() has no sessionHistory';
      }
      return 'No Farm or getState';
    })()
  `);
  console.log('Farm sessionHistory:', sessHist);

  // 5. Check the selectNPCs logic
  const selectInfo = await evaluate(`
    (function() {
      // Try to access internal state via the public API
      var tier = NPCManager.getTier ? NPCManager.getTier() : 'no getTier';
      return 'Tier: ' + JSON.stringify(tier);
    })()
  `);
  console.log('NPC tier:', selectInfo);

  // 6. Check the npc-manager.js selectNPCs filtering
  const filterCheck = await evaluate(`
    (function() {
      // Check what the actual sessionHistory looks like
      if (typeof Farm === 'undefined' || !Farm.getState) return 'No Farm';
      var state = Farm.getState();
      var hist = state.sessionHistory || [];
      if (hist.length === 0) return 'Empty history — no sessions recorded yet';

      // Show first 3 sessions
      return JSON.stringify(hist.slice(0, 3).map(function(s) {
        return {
          id: s.id,
          duration: s.duration || s.durationMin,
          project: s.project,
          startTime: s.startTime
        };
      }));
    })()
  `);
  console.log('Session data:', filterCheck);

  // 7. Try manually initializing NPCManager with test data
  console.log('\nManual init test...');
  const manualResult = await evaluate(`
    (function() {
      var testHistory = [
        {
          id: 'test-session-1',
          project: 'claude-buddy',
          durationMin: 120,
          startTime: Date.now() - 86400000,
          endTime: Date.now() - 86400000 + 7200000,
          events: [{type: 'code', count: 50}]
        },
        {
          id: 'test-session-2',
          project: 'stock-trading',
          durationMin: 60,
          startTime: Date.now() - 172800000,
          endTime: Date.now() - 172800000 + 3600000,
          events: [{type: 'code', count: 30}]
        }
      ];
      NPCManager.init(testHistory);
      return 'After manual init: ' + NPCManager.getNPCCount() + ' NPCs';
    })()
  `);
  console.log(manualResult);

  // 8. If NPCs now exist, show them
  if (manualResult.includes('0 NPCs')) {
    console.log('Even manual init created 0 NPCs — checking selectNPCs logic...');
  } else {
    const npcList = await evaluate('JSON.stringify(NPCManager.getNPCs().map(function(n){ return {name: n.profile.name, id: n.id, col: n.ai.col, row: n.ai.row}; }))');
    console.log('NPCs after manual init:', npcList);
  }

  ws.close();
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
