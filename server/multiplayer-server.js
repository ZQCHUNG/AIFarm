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
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.argv[2], 10) || 9876;

// Connected players: Map<ws, PlayerInfo>
const players = new Map();
let nextId = 1;

function generateId() {
  return `p${nextId++}_${Math.random().toString(36).slice(2, 8)}`;
}

const wss = new WebSocketServer({ port: PORT });

console.log(`[AIFarm Server] Listening on ws://localhost:${PORT}`);

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
