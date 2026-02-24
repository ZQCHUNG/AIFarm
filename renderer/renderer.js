// Unified village renderer — all buddies in one panoramic scene.
// Supports two view modes: classic (2D side-view) and iso (2.5D isometric).
(function () {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');

  let tick = 0;
  const ANIM_SPEED = 14;
  const BLINK_INTERVAL = 200;
  const BLINK_DURATION = 8;
  const SLOT_W = Scene.SLOT_W; // logical slot width (matches main.js SLOT_W / PX... roughly 40)

  // View mode: 'classic' or 'iso'
  let viewMode = 'classic';

  // Load sprites (async, graceful fallback to procedural rendering)
  let spritesLoaded = false;
  if (typeof SpriteManager !== 'undefined') {
    SpriteManager.loadAllFromConfig('.').then(({ loaded, failed }) => {
      spritesLoaded = loaded.length > 0;
      if (loaded.length > 0) {
        console.log(`[Sprites] Loaded ${loaded.length} sprites:`, loaded);
      }
      if (failed.length > 0) {
        console.log(`[Sprites] ${failed.length} sprites not found (using procedural fallback)`);
      }
    });
  }

  // Buddy registry: Map<sessionId, { sm: StateMachine, project: string, slotIndex: number }>
  const buddyMap = new Map();
  let buddyOrder = []; // ordered list of session IDs

  // Initialize viewport with canvas size
  Viewport.init(canvas.width, Math.ceil(canvas.width / Scene.PX));

  if (window.buddy) {
    window.buddy.onFarmUpdate((state) => {
      Farm.setState(state);
      // Sync world width with Viewport
      if (state && state.worldWidth) {
        Viewport.setWorldWidth(state.worldWidth);
      }
    });
    window.buddy.onFarmEnergyTick((pts) => { /* could add flash animation */ });
    window.buddy.onVibeUpdate((vibe) => Farm.setVibe(vibe));
    window.buddy.onUsageUpdate((state) => Farm.setUsage(state));
    window.buddy.onAchievementUnlocked((notif) => {
      Farm.showAchievementNotification(notif);
      // Trigger celebration on all buddies
      for (const [, buddy] of buddyMap) {
        buddy.sm.celebrate();
      }
    });
    window.buddy.onPrestigeEvent((data) => {
      // Generation advancement ceremony
      console.log(`[Prestige] Gen ${data.fromGen} → ${data.toGen}: ${data.label}`);
      Viewport.setWorldWidth(data.worldWidth);
      // Celebrate all buddies
      for (const [, buddy] of buddyMap) {
        buddy.sm.celebrate();
      }
      // Show prestige notification
      Farm.showPrestigeNotification(data);
    });

    window.buddy.onSetBuddies((list) => {
      // Sync buddy list: add new, remove stale, preserve state machines
      const newIds = new Set(list.map(b => b.id));

      // Remove
      for (const id of buddyMap.keys()) {
        if (!newIds.has(id)) buddyMap.delete(id);
      }

      // Add / update order
      buddyOrder = list.map(b => b.id);
      list.forEach((b, i) => {
        if (!buddyMap.has(b.id)) {
          buddyMap.set(b.id, { sm: new StateMachine(), project: b.project, colorIndex: b.colorIndex, slotIndex: i });
          // Queue train arrival animation for new buddy
          if (typeof Train !== 'undefined') {
            Train.queueArrival(b.project, b.colorIndex);
          }
          if (typeof IsoTrain !== 'undefined') {
            IsoTrain.queueArrival(b.project, b.colorIndex);
          }
        } else {
          const existing = buddyMap.get(b.id);
          existing.project = b.project;
          existing.colorIndex = b.colorIndex;
          existing.slotIndex = i;
        }
      });
    });

    window.buddy.onActivityEvent((event) => {
      const buddy = buddyMap.get(event.sessionId);
      if (buddy) buddy.sm.transition(event);
    });

    window.buddy.onResizeCanvas((w, h) => {
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      Viewport.setViewportWidth(w);
    });

    canvas.addEventListener('mousemove', (e) => {
      const pixel = ctx.getImageData(e.offsetX, e.offsetY, 1, 1).data;
      window.buddy.setIgnoreMouseEvents(pixel[3] < 10, { forward: true });
    });
    canvas.addEventListener('mouseleave', () => {
      window.buddy.setIgnoreMouseEvents(true, { forward: true });
      if (typeof IsoEngine !== 'undefined') IsoEngine.setHoverTile(-1, -1);
    });

    // Iso mode: mouse wheel zoom
    canvas.addEventListener('wheel', (e) => {
      if (viewMode !== 'iso' || typeof IsoEngine === 'undefined') return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const delta = e.deltaY < 0 ? 1 : -1;
      IsoEngine.zoom(delta, mx / IsoEngine.getZoom(), my / IsoEngine.getZoom());
    }, { passive: false });

    // Iso mode: mouse move for tile hover highlight
    canvas.addEventListener('mousemove', isoMouseHandler);
    canvas.addEventListener('click', isoClickHandler);
  }

  function isoMouseHandler(e) {
    if (viewMode !== 'iso' || typeof IsoEngine === 'undefined') return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const grid = IsoEngine.mouseToGrid(mx, my);
    IsoEngine.setHoverTile(grid.col, grid.row);
  }

  function isoClickHandler(e) {
    if (viewMode !== 'iso' || typeof IsoEngine === 'undefined') return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const grid = IsoEngine.mouseToGrid(mx, my);
    const tile = IsoEngine.getTile(grid.col, grid.row);
    if (tile) {
      console.log(`[Iso] Click: (${grid.col}, ${grid.row}) = ${tile}`);
    }
  }

  // Keyboard handler for debug pan mode and view toggle
  const isoKeys = {};
  document.addEventListener('keydown', (e) => {
    isoKeys[e.key] = true;
    // Ctrl+Shift+D toggles debug camera pan
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      const active = Viewport.toggleDebugPan();
      console.log('[Viewport] Debug pan:', active ? 'ON' : 'OFF');
    }
    // Ctrl+Shift+I toggles iso/classic view
    if (e.ctrlKey && e.shiftKey && e.key === 'I') {
      viewMode = viewMode === 'classic' ? 'iso' : 'classic';
      console.log('[Renderer] View mode:', viewMode);
      if (viewMode === 'iso' && typeof IsoFarm !== 'undefined') {
        IsoFarm.init();
        IsoFarm.syncState();
      }
    }
  });
  document.addEventListener('keyup', (e) => { isoKeys[e.key] = false; });

  function getAnimFrame(state) {
    if (state === 'celebrating') return 0; // stand facing camera
    if (state === 'idle') return (tick % BLINK_INTERVAL) < BLINK_DURATION ? 1 : 0;
    if (state === 'sleeping') return ((tick / (ANIM_SPEED * 2)) | 0) % 4;
    return ((tick / ANIM_SPEED) | 0) % 4;
  }

  function loop() {
    tick++;

    if (viewMode === 'iso') {
      loopIso();
    } else {
      loopClassic();
    }

    requestAnimationFrame(loop);
  }

  // ===== Classic 2D side-view rendering =====

  function loopClassic() {
    // Update viewport camera
    Viewport.update(tick);

    // Update train animations
    if (typeof Train !== 'undefined') {
      const fs = Farm.getState();
      Train.setStationBuilt(fs && (fs.totalEnergy || 0) >= 200);
      Train.update(tick);
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Shared background (sky, hills) — fixed, no camera offset
    Scene.drawBackground(ctx, canvas.width, tick);

    // 1.5 Farm layers — scrolls with camera
    Viewport.applyTransform(ctx);
    Farm.drawFarm(ctx, canvas.width, tick);
    // 1.6 Train station & train — also in world space
    if (typeof Train !== 'undefined') {
      const logW = Math.ceil(canvas.width / Scene.PX);
      Train.draw(ctx, logW, tick);
    }
    Viewport.restoreTransform(ctx);

    // 2. Per-buddy: station + character + nameplate — fixed (village area)
    const count = buddyOrder.length;
    const logW = Math.ceil(canvas.width / Scene.PX);
    const margin = 15;
    const usable = logW - margin * 2;
    const slotW = count > 0 ? Math.min(40, Math.floor(usable / count)) : 40;

    for (let i = 0; i < buddyOrder.length; i++) {
      const id = buddyOrder[i];
      const buddy = buddyMap.get(id);
      if (!buddy) continue;

      const state = buddy.sm.state;
      const detail = buddy.sm.detail;
      const frame = getAnimFrame(state);

      // Logical X position for this slot
      const slotX = margin + i * slotW;

      // Draw station furniture
      Scene.drawStation(ctx, slotX, state, tick + i * 50);

      // Draw character with unique hoodie color
      const ci = buddy.colorIndex || 0;
      Character.draw(ctx, slotX, state, frame, tick + i * 30, ci);

      // Draw nameplate with matching hoodie color
      const slotCenterPx = (slotX + slotW / 2) * Scene.PX;
      const hc = Character.HOODIE_COLORS[ci % Character.HOODIE_COLORS.length];
      Scene.drawNameplate(ctx, slotCenterPx, buddy.project, hc.o);

      // Speech bubble for working states
      if (detail && state !== 'idle' && state !== 'sleeping' && state !== 'celebrating') {
        const bubbleCX = (slotX + 10) * Scene.PX;
        const bubbleBottom = (Scene.GROUND_Y - 15) * Scene.PX;
        SpeechBubble.draw(ctx, detail, bubbleCX, bubbleBottom);
      }
    }
  }

  // ===== Isometric 2.5D rendering =====

  function loopIso() {
    if (typeof IsoFarm === 'undefined' || typeof IsoEngine === 'undefined' || typeof IsoEntityManager === 'undefined') {
      // Fallback to classic if iso modules not loaded
      loopClassic();
      return;
    }

    // Initialize iso world on first frame
    IsoFarm.init();

    // Sync farm state → iso entities
    IsoFarm.syncState();

    // Sync buddies → iso characters
    for (const [id, buddy] of buddyMap) {
      IsoFarm.syncBuddy(id, buddy.project, buddy.colorIndex || 0, buddy.sm.state);
    }

    // Camera panning (arrow keys)
    const PAN_SPEED = 3;
    if (isoKeys['ArrowLeft']) IsoEngine.moveCamera(PAN_SPEED, 0);
    if (isoKeys['ArrowRight']) IsoEngine.moveCamera(-PAN_SPEED, 0);
    if (isoKeys['ArrowUp']) IsoEngine.moveCamera(0, PAN_SPEED);
    if (isoKeys['ArrowDown']) IsoEngine.moveCamera(0, -PAN_SPEED);

    // Update iso train
    if (typeof IsoTrain !== 'undefined') {
      const fs = Farm.getState();
      IsoTrain.setStationBuilt(fs && (fs.totalEnergy || 0) >= 200);
      IsoTrain.update(tick);
    }

    // Update entity manager (AI, paths, screen positions)
    IsoEntityManager.update(tick);
    IsoEntityManager.syncToEngine();

    // Clear canvas
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Sky gradient
    const skyGrad = ctx.createLinearGradient(0, 0, 0, canvas.height * 0.4);
    skyGrad.addColorStop(0, '#87CEEB');
    skyGrad.addColorStop(1, '#E0F0FF');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height * 0.4);

    // Ground fill
    ctx.fillStyle = '#4A7A3A';
    ctx.fillRect(0, canvas.height * 0.35, canvas.width, canvas.height * 0.65);

    // Update weather particles
    if (typeof IsoWeather !== 'undefined') {
      const vibe = (typeof Farm !== 'undefined') ? Farm.getVibe() : null;
      if (vibe) {
        IsoWeather.setMood(vibe.mood, vibe.vibeScore || 0);
      }
      IsoWeather.update(tick, canvas.width, canvas.height);
    }

    // Render isometric map with all entities
    IsoEngine.drawMap(ctx, canvas.width, canvas.height, tick);

    // Iso train (drawn after map, before HUD)
    if (typeof IsoTrain !== 'undefined') {
      ctx.save();
      ctx.scale(IsoEngine.getZoom(), IsoEngine.getZoom());
      IsoTrain.draw(ctx, tick);
      ctx.restore();
    }

    // Weather particles (drawn over map, under HUD)
    if (typeof IsoWeather !== 'undefined') {
      IsoWeather.draw(ctx, canvas.width, canvas.height, tick);
    }

    // HUD overlay
    IsoFarm.drawHUD(ctx, canvas.width, canvas.height, tick);

    // View mode indicator
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(8, canvas.height - 24, 120, 18);
    ctx.fillStyle = '#6CB0E8';
    ctx.font = '10px monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('ISO 2.5D [Ctrl+Shift+I]', 14, canvas.height - 15);
  }

  requestAnimationFrame(loop);
})();
