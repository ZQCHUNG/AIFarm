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

  // Player initialization flag
  let playerInited = false;

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

  // Initialize resource inventory + event bus listeners
  if (typeof ResourceInventory !== 'undefined') {
    ResourceInventory.init();
    ResourceInventory.setupListeners();
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
      // GOAT: trigger golden train on next arrival
      if (notif.id === 'goat' && typeof IsoTrain !== 'undefined') {
        IsoTrain.setNextTrainGolden(true);
      }
    });
    window.buddy.onSpritesReload((data) => {
      console.log(`[Sprites] Hot-reload triggered by: ${data.trigger}`);
      if (typeof SpriteManager !== 'undefined') {
        SpriteManager.reloadAll('.').then(({ loaded, failed }) => {
          console.log(`[Sprites] Reloaded: ${loaded.length} loaded, ${failed.length} failed`);
        });
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
      // BuddyAI: drive farming/tending behavior from activity events
      if (typeof BuddyAI !== 'undefined' && viewMode === 'iso') {
        BuddyAI.onActivity(event.sessionId, event.type);
      }
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
      if (typeof IsoUI !== 'undefined' && IsoUI.isOpen()) return;
      e.preventDefault();
      if (typeof IsoFarm !== 'undefined' && IsoFarm.interruptAutoPan) IsoFarm.interruptAutoPan();
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
    // Suppress hover when modal is open
    if (typeof IsoUI !== 'undefined' && IsoUI.isOpen()) return;
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
    // Bulletin board modal takes priority
    if (typeof IsoUI !== 'undefined' && IsoUI.handleClick(grid.col, grid.row)) {
      return;
    }
    // Tile click available for future interactions
  }

  // Keyboard handler
  const keys = {};
  document.addEventListener('keydown', (e) => {
    keys[e.key] = true;
    // Shipping bin sell action (E key)
    if ((e.key === 'e' || e.key === 'E') && !e.ctrlKey && !e.shiftKey) {
      if (typeof IsoFarm !== 'undefined' && IsoFarm.sellAllCrops) {
        IsoFarm.sellAllCrops(tick);
      }
    }
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
      // Notify BuddyAI of state changes
      if (typeof BuddyAI !== 'undefined') {
        BuddyAI.onStateChange(id, buddy.sm.state);
      }
    }

    // Startup camera animation (train station → farm center pan)
    IsoFarm.updateStartupAnimation();

    // Player control + camera follow (replaces manual arrow-key panning)
    const modalLock = typeof IsoUI !== 'undefined' && IsoUI.isOpen();
    if (typeof Player !== 'undefined') {
      // Initialize player once at farm center (col 9, row 7)
      if (!playerInited) {
        Player.init(9, 7, {
          spriteKey: 'char_blue',
          collisionFn: (wx, wy) => {
            const col = Math.floor(wx / IsoEngine.TILE_W);
            const row = Math.floor(wy / IsoEngine.TILE_H);
            const tile = IsoEngine.getTile(col, row);
            return Player.SOLID_TILES.has(tile);
          },
        });
        playerInited = true;
      }
      if (!modalLock) {
        const anyMove = keys['ArrowLeft'] || keys['ArrowRight'] || keys['ArrowUp'] || keys['ArrowDown']
          || keys['a'] || keys['A'] || keys['d'] || keys['D']
          || keys['w'] || keys['W'] || keys['s'] || keys['S'];
        if (anyMove && IsoFarm.interruptAutoPan) IsoFarm.interruptAutoPan();
        Player.update(keys);
      }
      // Camera smoothly follows player (after startup animation finishes)
      if (!IsoFarm.isStartupAnimating()) {
        const pp = Player.getPosition();
        IsoEngine.smoothFollow(pp.x, pp.y, 0.08);
      }

      // Update persistent player entity for rendering
      IsoEngine.setPlayer(Player.getEntity());
    } else {
      // Fallback: manual camera panning if Player module not loaded
      const PAN_SPEED = 4;
      if (!modalLock) {
        const anyArrow = keys['ArrowLeft'] || keys['ArrowRight'] || keys['ArrowUp'] || keys['ArrowDown'];
        if (anyArrow && IsoFarm.interruptAutoPan) IsoFarm.interruptAutoPan();
        if (keys['ArrowLeft']) IsoEngine.moveCamera(PAN_SPEED, 0);
        if (keys['ArrowRight']) IsoEngine.moveCamera(-PAN_SPEED, 0);
        if (keys['ArrowUp']) IsoEngine.moveCamera(0, PAN_SPEED);
        if (keys['ArrowDown']) IsoEngine.moveCamera(0, -PAN_SPEED);
      }
    }

    // Auto-pan idle camera tour (only when player is not moving)
    if (typeof Player !== 'undefined' && Player.isMoving()) {
      // Player is moving — don't auto-pan
    } else if (IsoFarm.updateAutoPan) {
      IsoFarm.updateAutoPan();
    }

    // Update buddy AI (farming/tending behavior)
    if (typeof BuddyAI !== 'undefined') {
      BuddyAI.update(tick);
    }

    // Update entity manager
    IsoEntityManager.update(tick);
    IsoEntityManager.syncToEngine();

    // Clear canvas with seasonal sky gradient
    const sky = (typeof IsoWeather !== 'undefined') ? IsoWeather.getSkyGradient() : {};
    const skyGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    skyGrad.addColorStop(0, sky.skyTop || '#87CEEB');
    skyGrad.addColorStop(0.3, sky.skyMid || '#B8E0F0');
    skyGrad.addColorStop(0.5, sky.grassTop || '#6EBF4E');
    skyGrad.addColorStop(1, sky.grassBot || '#4E9E38');
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

    // Seasonal ground tint overlay (after tiles, before particles)
    if (typeof IsoWeather !== 'undefined') {
      IsoWeather.drawGroundTint(ctx, canvas.width, canvas.height);
    }

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
      IsoWeather.drawNightOverlay(ctx, canvas.width, canvas.height, tick);
    }

    // Entity tooltips
    if (typeof IsoTooltip !== 'undefined') {
      IsoTooltip.draw(ctx, canvas.width, canvas.height, tick);
    }

    // HUD (Harvest Moon style)
    IsoFarm.drawHUD(ctx, canvas.width, canvas.height, tick);

    // Modal overlay (bulletin board daily summary)
    if (typeof IsoUI !== 'undefined') {
      IsoUI.update();
      IsoUI.draw(ctx, canvas.width, canvas.height, tick);
    }
  }

  requestAnimationFrame(loop);
})();
