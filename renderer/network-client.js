/**
 * network-client.js — WebSocket multiplayer client (Sprint 25 P2).
 *
 * Connects to the AIFarm multiplayer server and:
 * - Broadcasts local player position at low frequency (6 Hz)
 * - Receives other players' positions and renders "Ghost Players"
 * - Ghost players rendered with team name labels and semi-transparent
 *
 * Usage:
 *   NetworkClient.connect('ws://localhost:9876', 'MyName', 'Team Ramen');
 *   // In game loop:
 *   NetworkClient.sendPosition(playerX, playerY, dir, frame, state);
 *   NetworkClient.update(tick);
 *   NetworkClient.draw(ctx, tick);
 */
const NetworkClient = (() => {
  let ws = null;
  let myId = null;
  let connected = false;
  let serverUrl = null;
  let playerName = 'Player';
  let teamName = '';

  // Remote players: Map<id, { name, team, x, y, dir, frame, state, lastUpdate, targetX, targetY }>
  const remotePlayers = new Map();

  // Send throttle: broadcast position every 10 ticks (~6 Hz at 60fps)
  const SEND_INTERVAL = 10;
  let lastSendTick = 0;
  let lastSentX = -999;
  let lastSentY = -999;

  // Interpolation speed for smooth remote player movement
  const LERP_SPEED = 0.15;

  // ===== Connection =====

  function connect(url, name, team) {
    if (ws) disconnect();

    serverUrl = url || 'ws://localhost:9876';
    playerName = name || 'Player';
    teamName = team || '';

    try {
      ws = new WebSocket(serverUrl);

      ws.onopen = () => {
        connected = true;
        console.log(`[Network] Connected to ${serverUrl}`);
        // Send join message
        ws.send(JSON.stringify({ type: 'join', name: playerName, team: teamName }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleMessage(msg);
        } catch (e) { /* ignore */ }
      };

      ws.onclose = () => {
        connected = false;
        myId = null;
        console.log('[Network] Disconnected');
        // Auto-reconnect after 5 seconds
        setTimeout(() => {
          if (!connected && serverUrl) {
            console.log('[Network] Attempting reconnect...');
            connect(serverUrl, playerName, teamName);
          }
        }, 5000);
      };

      ws.onerror = () => {
        // onclose will fire after this
      };
    } catch (err) {
      console.warn('[Network] Connection failed:', err.message);
    }
  }

  function disconnect() {
    if (ws) {
      ws.close();
      ws = null;
    }
    connected = false;
    myId = null;
    remotePlayers.clear();
  }

  // ===== Message handling =====

  function handleMessage(msg) {
    switch (msg.type) {
      case 'welcome':
        myId = msg.id;
        console.log(`[Network] My ID: ${myId}, ${msg.players.length} players online`);
        // Add existing players
        for (const p of msg.players) {
          remotePlayers.set(p.id, {
            name: p.name, team: p.team,
            x: p.x, y: p.y, targetX: p.x, targetY: p.y,
            dir: p.dir || 'down', frame: p.frame || 0, state: p.state || 'idle',
            lastUpdate: Date.now(),
          });
        }
        break;

      case 'player_joined':
        if (msg.id === myId) break;
        remotePlayers.set(msg.id, {
          name: msg.name, team: msg.team,
          x: 10, y: 10, targetX: 10, targetY: 10,
          dir: 'down', frame: 0, state: 'idle',
          lastUpdate: Date.now(),
        });
        // Notification
        if (typeof IsoEffects !== 'undefined') {
          IsoEffects.spawnText(10, 8, `${msg.name} joined!`, { color: '#5BEF5B', life: 90, rise: 0.5 });
        }
        break;

      case 'player_moved':
        if (msg.id === myId) break;
        const player = remotePlayers.get(msg.id);
        if (player) {
          player.targetX = msg.x;
          player.targetY = msg.y;
          player.dir = msg.dir || 'down';
          player.frame = msg.frame || 0;
          player.state = msg.state || 'idle';
          player.lastUpdate = Date.now();
        }
        break;

      case 'player_left':
        remotePlayers.delete(msg.id);
        break;

      case 'player_chat':
        // Show chat bubble above remote player
        const chatPlayer = remotePlayers.get(msg.id);
        if (chatPlayer && typeof IsoEffects !== 'undefined') {
          IsoEffects.spawnText(chatPlayer.x, chatPlayer.y - 1.5, msg.text,
            { color: '#FFF', life: 120, rise: 0.2 });
        }
        break;
    }
  }

  // ===== Sending =====

  function sendPosition(x, y, dir, frame, state) {
    if (!connected || !ws) return;

    // Only send if position actually changed
    const dx = x - lastSentX;
    const dy = y - lastSentY;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;

    lastSentX = x;
    lastSentY = y;

    ws.send(JSON.stringify({
      type: 'move', x, y, dir, frame, state,
    }));
  }

  function sendChat(text) {
    if (!connected || !ws) return;
    ws.send(JSON.stringify({ type: 'chat', text }));
  }

  // ===== Game loop integration =====

  function update(tick) {
    // Interpolate remote player positions for smooth movement
    for (const [, p] of remotePlayers) {
      p.x += (p.targetX - p.x) * LERP_SPEED;
      p.y += (p.targetY - p.y) * LERP_SPEED;
    }

    // Throttled position send
    if (tick - lastSendTick >= SEND_INTERVAL) {
      lastSendTick = tick;
      // Position is sent by the caller (renderer.js) via sendPosition()
    }

    // Remove stale players (no update for 30s)
    const now = Date.now();
    for (const [id, p] of remotePlayers) {
      if (now - p.lastUpdate > 30000) {
        remotePlayers.delete(id);
      }
    }
  }

  /**
   * Draw ghost players on the isometric map.
   * Called from the render loop after local entities.
   */
  function draw(ctx, tick) {
    if (remotePlayers.size === 0) return;
    if (typeof IsoEngine === 'undefined') return;

    for (const [id, p] of remotePlayers) {
      // Convert grid coords to screen
      const sx = IsoEngine.gridToScreenX(p.x, p.y);
      const sy = IsoEngine.gridToScreenY(p.x, p.y);

      if (sx === undefined || sy === undefined) continue;

      ctx.save();
      ctx.globalAlpha = 0.6; // Ghost transparency

      // Draw character using procedural fallback (Character module)
      if (typeof Character !== 'undefined') {
        Character.drawCharacter(ctx, sx, sy - 4, p.dir, p.frame, '#8888FF', 3);
      } else {
        // Minimal fallback: colored circle
        ctx.fillStyle = '#8888FF';
        ctx.beginPath();
        ctx.arc(sx, sy - 8, 6, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;

      // Team name label above head
      const label = p.team ? `[${p.team}] ${p.name}` : p.name;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.font = '6px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const textW = ctx.measureText(label).width;
      ctx.fillRect(sx - textW / 2 - 2, sy - 26, textW + 4, 9);
      ctx.fillStyle = '#CFF';
      ctx.fillText(label, sx, sy - 18);

      ctx.restore();
    }
  }

  // ===== Status =====

  function isConnected() { return connected; }
  function getMyId() { return myId; }
  function getRemotePlayers() { return remotePlayers; }
  function getPlayerCount() { return remotePlayers.size; }
  function shouldSend(tick) { return tick - lastSendTick >= SEND_INTERVAL; }

  // ===== Public API =====

  return {
    connect,
    disconnect,
    sendPosition,
    sendChat,
    update,
    draw,
    isConnected,
    getMyId,
    getRemotePlayers,
    getPlayerCount,
    shouldSend,
  };
})();
