// check-sprites.js — Check sprite registry and buddy entities
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
  console.log('=== Sprite & Entity Debug ===\n');

  // Check SpriteManager
  const spriteList = await evaluate(`
    (function() {
      if (typeof SpriteManager === 'undefined') return 'No SpriteManager';
      if (!SpriteManager.list) return 'No list method';
      return JSON.stringify(SpriteManager.list());
    })()
  `);
  console.log('Registered sprites:', spriteList);

  // Check buddy entities
  const buddies = await evaluate(`
    (function() {
      if (typeof IsoEntityManager === 'undefined') return 'No IsoEntityManager';
      var ents = IsoEntityManager.getAll ? IsoEntityManager.getAll() : [];
      var chars = ents.filter(function(e) { return e.entityType === 1; }); // TYPE.CHARACTER = 1
      return JSON.stringify(chars.map(function(c) {
        return {
          id: c.id,
          hoodieColor: c.hoodieColor,
          spriteId: c.spriteId,
          gridX: c.gridX ? c.gridX.toFixed(1) : null,
          gridY: c.gridY ? c.gridY.toFixed(1) : null,
          name: c.name,
          direction: c.direction,
          frame: c.frame
        };
      }));
    })()
  `);
  console.log('Character entities:', buddies);

  // Check if spriteId is set on any character
  const spriteCheck = await evaluate(`
    (function() {
      if (typeof IsoEntityManager === 'undefined') return 'No IsoEntityManager';
      var ents = IsoEntityManager.getAll ? IsoEntityManager.getAll() : [];
      var withSprite = ents.filter(function(e) { return e.spriteId; });
      return 'Entities with spriteId: ' + withSprite.length + ' / ' + ents.length;
    })()
  `);
  console.log(spriteCheck);

  // Check SpriteManager.has for any buddy spriteId
  const hasSpriteCheck = await evaluate(`
    (function() {
      if (typeof SpriteManager === 'undefined') return 'No SpriteManager';
      var results = [];
      var ids = ['buddy-blue', 'buddy-red', 'buddy-green', 'buddy-purple', 'char-blue', 'char-default'];
      for (var i = 0; i < ids.length; i++) {
        results.push(ids[i] + ': ' + SpriteManager.has(ids[i]));
      }
      return results.join(', ');
    })()
  `);
  console.log('Sprite has check:', hasSpriteCheck);

  // Check zoom level
  const zoom = await evaluate('IsoEngine.getZoom()');
  console.log('Current zoom:', zoom);

  // Check if buddy AI animation causes size changes
  const buddyAIState = await evaluate(`
    (function() {
      if (typeof BuddyAI === 'undefined') return 'No BuddyAI';
      if (!BuddyAI.getState) return 'No getState';
      return JSON.stringify(BuddyAI.getState());
    })()
  `);
  console.log('BuddyAI state:', buddyAIState);

  ws.close();
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
