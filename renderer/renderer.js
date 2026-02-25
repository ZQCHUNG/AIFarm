// Unified village renderer — all buddies in one panoramic scene.
// Default view: top-down 3/4 perspective (Harvest Moon style).
// Toggle: Ctrl+Shift+I switches between top-down and classic 2D side-view.
(function () {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');

  let tick = 0;
  const ANIM_SPEED = 14;
  const BLINK_INTERVAL = 200;
  const BLINK_DURATION = 8;
  const SLOT_W = Scene.SLOT_W;

  // View mode: 'iso' (top-down, default) or 'classic' (2D side-view)
  let viewMode = 'iso';

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

  // Buddy registry
  const buddyMap = new Map();
  let buddyOrder = [];

  // Initialize viewport with canvas size
  Viewport.init(canvas.width, Math.ceil(canvas.width / Scene.PX));

  // Initialize top-down farm on startup
  if (typeof IsoFarm !== 'undefined' && typeof IsoEngine !== 'undefined' && typeof IsoEntityManager !== 'undefined') {
    IsoFarm.init();
    IsoFarm.syncState();
  }

  if (window.buddy) {
    window.buddy.onFarmUpdate((state) => {
      Farm.setState(state);
      if (state && state.worldWidth) {
        Viewport.setWorldWidth(state.worldWidth);
      }
    });
    window.buddy.onFarmEnergyTick((pts) => { /* could add flash animation */ });
    window.buddy.onVibeUpdate((vibe) => Farm.setVibe(vibe));
    window.buddy.onUsageUpdate((state) => Farm.setUsage(state));
    window.buddy.onAchievementUnlocked((notif) => {
      Farm.showAchievementNotification(notif);
      for (const [, buddy] of buddyMap) {
        buddy.sm.celebrate();
      }
    });
    window.buddy.onPrestigeEvent((data) => {
      console.log(`[Prestige] Gen ${data.fromGen} → ${data.toGen}: ${data.label}`);
      Viewport.setWorldWidth(data.worldWidth);
      for (const [, buddy] of buddyMap) {
        buddy.sm.celebrate();
      }
      Farm.showPrestigeNotification(data);
    });

    window.buddy.onSetBuddies((list) => {
      const newIds = new Set(list.map(b => b.id));
      for (const id of buddyMap.keys()) {
        if (!newIds.has(id)) buddyMap.delete(id);
      }
      buddyOrder = list.map(b => b.id);
      list.forEach((b, i) => {
        if (!buddyMap.has(b.id)) {
          buddyMap.set(b.id, { sm: new StateMachine(), project: b.project, colorIndex: b.colorIndex, slotIndex: i });
          if (typeof Train !== 'undefined') Train.queueArrival(b.project, b.colorIndex);
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

    // Mouse wheel zoom (top-down mode)
    canvas.addEventListener('wheel', (e) => {
      if (viewMode !== 'iso' || typeof IsoEngine === 'undefined') return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const delta = e.deltaY < 0 ? 1 : -1;
      IsoEngine.zoom(delta, mx / IsoEngine.getZoom(), my / IsoEngine.getZoom());
    }, { passive: false });

    // Tile hover + click
    canvas.addEventListener('mousemove', topdownMouseHandler);
    canvas.addEventListener('click', topdownClickHandler);
  }

  function topdownMouseHandler(e) {
    if (viewMode !== 'iso' || typeof IsoEngine === 'undefined') return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const grid = IsoEngine.mouseToGrid(mx, my);
    IsoEngine.setHoverTile(grid.col, grid.row);
    if (typeof IsoTooltip !== 'undefined') {
      IsoTooltip.updateHover(grid.col, grid.row, buddyMap, buddyOrder);
    }
  }

  function topdownClickHandler(e) {
    if (viewMode !== 'iso' || typeof IsoEngine === 'undefined') return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const grid = IsoEngine.mouseToGrid(mx, my);
    const tile = IsoEngine.getTile(grid.col, grid.row);
    if (tile) {
      console.log(`[TopDown] Click: (${grid.col}, ${grid.row}) = ${tile}`);
    }
  }

  // Keyboard handler
  const keys = {};
  document.addEventListener('keydown', (e) => {
    keys[e.key] = true;
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      const active = Viewport.toggleDebugPan();
      console.log('[Viewport] Debug pan:', active ? 'ON' : 'OFF');
    }
    if (e.ctrlKey && e.shiftKey && e.key === 'I') {
      // Save camera state before switching away from iso
      if (viewMode === 'iso' && typeof IsoEngine !== 'undefined') {
        IsoEngine.saveViewportState();
      }
      viewMode = viewMode === 'classic' ? 'iso' : 'classic';
      console.log('[Renderer] View mode:', viewMode);
      if (viewMode === 'iso' && typeof IsoFarm !== 'undefined') {
        IsoFarm.init();
        IsoFarm.syncState();
        // Restore previous camera position if available
        if (typeof IsoEngine !== 'undefined' && IsoEngine.hasSavedViewport()) {
          IsoEngine.restoreViewportState();
        }
      }
    }
  });
  document.addEventListener('keyup', (e) => { keys[e.key] = false; });

  function getAnimFrame(state) {
    if (state === 'celebrating') return 0;
    if (state === 'idle') return (tick % BLINK_INTERVAL) < BLINK_DURATION ? 1 : 0;
    if (state === 'sleeping') return ((tick / (ANIM_SPEED * 2)) | 0) % 4;
    return ((tick / ANIM_SPEED) | 0) % 4;
  }

  function loop() {
    tick++;
    if (viewMode === 'iso') {
      loopTopDown();
    } else {
      loopClassic();
    }
    requestAnimationFrame(loop);
  }

  // ===== Classic 2D side-view rendering =====

  function loopClassic() {
    Viewport.update(tick);
    if (typeof Train !== 'undefined') {
      const fs = Farm.getState();
      Train.setStationBuilt(fs && (fs.totalEnergy || 0) >= 200);
      Train.update(tick);
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    Scene.drawBackground(ctx, canvas.width, tick);

    Viewport.applyTransform(ctx);
    Farm.drawFarm(ctx, canvas.width, tick);
    if (typeof Train !== 'undefined') {
      const logW = Math.ceil(canvas.width / Scene.PX);
      Train.draw(ctx, logW, tick);
    }
    Viewport.restoreTransform(ctx);

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
      const slotX = margin + i * slotW;

      Scene.drawStation(ctx, slotX, state, tick + i * 50);
      const ci = buddy.colorIndex || 0;
      Character.draw(ctx, slotX, state, frame, tick + i * 30, ci);

      const slotCenterPx = (slotX + slotW / 2) * Scene.PX;
      const hc = Character.HOODIE_COLORS[ci % Character.HOODIE_COLORS.length];
      Scene.drawNameplate(ctx, slotCenterPx, buddy.project, hc.o);

      if (detail && state !== 'idle' && state !== 'sleeping' && state !== 'celebrating') {
        const bubbleCX = (slotX + 10) * Scene.PX;
        const bubbleBottom = (Scene.GROUND_Y - 15) * Scene.PX;
        SpeechBubble.draw(ctx, detail, bubbleCX, bubbleBottom);
      }
    }
  }

  // ===== Top-Down 3/4 rendering (Harvest Moon style) =====

  function loopTopDown() {
    if (typeof IsoFarm === 'undefined' || typeof IsoEngine === 'undefined' || typeof IsoEntityManager === 'undefined') {
      loopClassic();
      return;
    }

    // Initialize farm world
    IsoFarm.init();
    IsoFarm.syncState();

    // Sync buddies
    for (const [id, buddy] of buddyMap) {
      IsoFarm.syncBuddy(id, buddy.project, buddy.colorIndex || 0, buddy.sm.state);
    }

    // Camera panning (arrow keys)
    const PAN_SPEED = 4;
    if (keys['ArrowLeft']) IsoEngine.moveCamera(PAN_SPEED, 0);
    if (keys['ArrowRight']) IsoEngine.moveCamera(-PAN_SPEED, 0);
    if (keys['ArrowUp']) IsoEngine.moveCamera(0, PAN_SPEED);
    if (keys['ArrowDown']) IsoEngine.moveCamera(0, -PAN_SPEED);

    // Update entity manager
    IsoEntityManager.update(tick);
    IsoEntityManager.syncToEngine();

    // Clear canvas with warm sky gradient (Harvest Moon feel)
    const skyGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    skyGrad.addColorStop(0, '#87CEEB');
    skyGrad.addColorStop(0.3, '#B8E0F0');
    skyGrad.addColorStop(0.5, '#6EBF4E');
    skyGrad.addColorStop(1, '#4E9E38');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Weather particles (behind tiles)
    if (typeof IsoWeather !== 'undefined') {
      const vibe = (typeof Farm !== 'undefined') ? Farm.getVibe() : null;
      if (vibe) IsoWeather.setMood(vibe.mood, vibe.vibeScore || 0);
      IsoWeather.update(tick, canvas.width, canvas.height);
    }

    // Update particles
    IsoEngine.updateParticles();

    // Render tile map + entities
    IsoEngine.drawMap(ctx, canvas.width, canvas.height, tick);

    // Draw particles + floating effects (in zoomed space)
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.scale(IsoEngine.getZoom(), IsoEngine.getZoom());
    IsoEngine.drawParticles(ctx);
    if (typeof IsoEffects !== 'undefined') {
      IsoEffects.update();
      IsoEffects.draw(ctx, canvas.width / IsoEngine.getZoom(), canvas.height / IsoEngine.getZoom());
    }
    ctx.restore();

    // Weather overlay
    if (typeof IsoWeather !== 'undefined') {
      IsoWeather.draw(ctx, canvas.width, canvas.height, tick);
    }

    // Entity tooltips
    if (typeof IsoTooltip !== 'undefined') {
      IsoTooltip.draw(ctx, canvas.width, canvas.height, tick);
    }

    // HUD (Harvest Moon style)
    IsoFarm.drawHUD(ctx, canvas.width, canvas.height, tick);
  }

  requestAnimationFrame(loop);
})();
