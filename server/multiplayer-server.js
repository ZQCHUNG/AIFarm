/**
 * multiplayer-server.js — Lightweight WebSocket server for AIFarm multiplayer.
 *
 * Broadcasts player positions and states between connected clients.
 * Run standalone: node server/multiplayer-server.js [port]
 *
 * Protocol (JSON messages):
 *   Client → Server:
 *     { type: "join", name: "Player Name", team: "Team Ramen" }
 *     { type: "move", x: 100.5, y: 50.2, dir: "right", frame: 2, state: "walking" }
 *     { type: "chat", text: "Hello!" }
 *
 *   Server → Client:
 *     { type: "welcome", id: "abc123", players: [...] }
 *     { type: "player_joined", id: "abc123", name: "...", team: "..." }
 *     { type: "player_moved", id: "abc123", x: ..., y: ..., dir: ..., frame: ..., state: ... }
 *     { type: "player_left", id: "abc123" }
 *     { type: "player_chat", id: "abc123", text: "Hello!" }
 */
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.argv[2], 10) || 9876;

// Connected players: Map<ws, PlayerInfo>
const players = new Map();
let nextId = 1;

function generateId() {
  return `p${nextId++}_${Math.random().toString(36).slice(2, 8)}`;
}

// ===== HTTP server (webhook API + upgrade to WS) =====

const httpServer = http.createServer((req, res) => {
  // CORS headers for local dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // POST /api/webhook — receive external events
  if (req.method === 'POST' && req.url === '/api/webhook') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        handleWebhook(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, event: payload.event }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // GET /api/status — server info
  if (req.method === 'GET' && req.url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      players: players.size,
      uptime: process.uptime(),
    }));
    return;
  }

  // 404 for everything else
  res.writeHead(404);
  res.end('Not Found');
});

const wss = new WebSocketServer({ server: httpServer });

httpServer.listen(PORT, () => {
  console.log(`[AIFarm Server] HTTP + WebSocket on port ${PORT}`);
  console.log(`  Webhook:  POST http://localhost:${PORT}/api/webhook`);
  console.log(`  Status:   GET  http://localhost:${PORT}/api/status`);
  console.log(`  WS:       ws://localhost:${PORT}`);
});

// ===== Webhook handler =====

/**
 * Process incoming webhook events and broadcast to all clients.
 *
 * Payload format:
 *   { event: "gold_rain" | "data_crystal" | "announcement",
 *     source: "quant-system" | "ci-cd" | "custom",
 *     message: "Optional text",
 *     data: { ... optional extra data } }
 */
function handleWebhook(payload) {
  const event = payload.event || 'unknown';
  console.log(`[Webhook] Received: ${event} from ${payload.source || 'unknown'}`);

  // Broadcast oracle event to all connected clients
  broadcastAll({
    type: 'oracle_event',
    event,
    source: String(payload.source || 'external').slice(0, 50),
    message: String(payload.message || '').slice(0, 200),
    data: payload.data || {},
    timestamp: Date.now(),
  });
}

wss.on('connection', (ws) => {
  const playerId = generateId();
  const player = {
    id: playerId,
    name: `Player ${nextId - 1}`,
    team: '',
    x: 10,
    y: 10,
    dir: 'down',
    frame: 0,
    state: 'idle',
    lastUpdate: Date.now(),
  };

  players.set(ws, player);
  console.log(`[+] ${playerId} connected (${players.size} total)`);

  // Send welcome with current player list
  const playerList = [];
  for (const [, p] of players) {
    if (p.id !== playerId) {
      playerList.push({
        id: p.id, name: p.name, team: p.team,
        x: p.x, y: p.y, dir: p.dir, frame: p.frame, state: p.state,
      });
    }
  }
  ws.send(JSON.stringify({ type: 'welcome', id: playerId, players: playerList }));

  // Notify others
  broadcast({ type: 'player_joined', id: playerId, name: player.name, team: player.team }, ws);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      const p = players.get(ws);
      if (!p) return;

      switch (msg.type) {
        case 'join':
          p.name = String(msg.name || p.name).slice(0, 32);
          p.team = String(msg.team || '').slice(0, 32);
          broadcast({ type: 'player_joined', id: p.id, name: p.name, team: p.team }, ws);
          break;

        case 'move':
          p.x = Number(msg.x) || 0;
          p.y = Number(msg.y) || 0;
          p.dir = msg.dir || 'down';
          p.frame = Number(msg.frame) || 0;
          p.state = msg.state || 'idle';
          p.lastUpdate = Date.now();
          broadcast({
            type: 'player_moved', id: p.id,
            x: p.x, y: p.y, dir: p.dir, frame: p.frame, state: p.state,
          }, ws);
          break;

        case 'chat':
          broadcast({
            type: 'player_chat', id: p.id,
            text: String(msg.text || '').slice(0, 200),
          }, ws);
          break;

        // Trade protocol: relay trade messages between two players
        case 'trade_request':
        case 'trade_accept':
        case 'trade_reject':
        case 'trade_offer':
        case 'trade_confirm':
        case 'trade_cancel':
          relayToPlayer(msg.targetId, {
            ...msg, fromId: p.id, fromName: p.name,
          });
          break;
      }
    } catch (err) {
      // Ignore malformed messages
    }
  });

  ws.on('close', () => {
    const p = players.get(ws);
    if (p) {
      console.log(`[-] ${p.id} (${p.name}) disconnected`);
      broadcast({ type: 'player_left', id: p.id });
      players.delete(ws);
    }
  });

  ws.on('error', () => {
    players.delete(ws);
  });
});

/**
 * Broadcast a message to all connected clients except the sender.
 */
function broadcast(msg, exclude) {
  const data = JSON.stringify(msg);
  for (const [ws] of players) {
    if (ws !== exclude && ws.readyState === 1) {
      ws.send(data);
    }
  }
}

/**
 * Relay a message to a specific player by ID.
 */
function relayToPlayer(targetId, msg) {
  for (const [ws, p] of players) {
    if (p.id === targetId && ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
      return;
    }
  }
}

/**
 * Broadcast a message to ALL connected clients (no exclusion).
 */
function broadcastAll(msg) {
  const data = JSON.stringify(msg);
  for (const [ws] of players) {
    if (ws.readyState === 1) {
      ws.send(data);
    }
  }
}

// Cleanup: remove stale connections every 30 seconds
setInterval(() => {
  const now = Date.now();
  for (const [ws, p] of players) {
    if (now - p.lastUpdate > 60000) { // 60s timeout
      console.log(`[!] ${p.id} timed out`);
      ws.terminate();
      broadcast({ type: 'player_left', id: p.id });
      players.delete(ws);
    }
  }
}, 30000);
