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

  // Initialize collection UI + listeners
  if (typeof CollectionUI !== 'undefined') {
    CollectionUI.setupListeners();
  }

  // Initialize skill system + EventBus listeners
  if (typeof SkillSystem !== 'undefined') {
    SkillSystem.setupListeners();
  }

  // Initialize audio engine + EventBus listeners
  if (typeof AudioManager !== 'undefined') {
    AudioManager.setupListeners();
  }

  // Initialize player accessories event listeners
  if (typeof PlayerAccessories !== 'undefined') {
    PlayerAccessories.setupListeners();
  }

  // Initialize automation system
  if (typeof Automation !== 'undefined') {
    Automation.init();
  }

  // Initialize pet AI
  if (typeof PetAI !== 'undefined') {
    PetAI.init();
  }

  // Initialize quest board
  if (typeof QuestBoard !== 'undefined') {
    QuestBoard.init();
  }

  // Initialize milestone snapshot v2
  if (typeof SnapshotV2 !== 'undefined') {
    SnapshotV2.init();
  }

  // Initialize resource popup sprites (fly-to-HUD on harvest)
  if (typeof IsoEffects !== 'undefined' && IsoEffects.setupResourceListeners) {
    IsoEffects.setupResourceListeners();
  }

  // Handle shop permit purchases → unlock processing buildings
  if (typeof EventBus !== 'undefined' && typeof Processing !== 'undefined') {
    EventBus.on('SHOP_PURCHASE', (data) => {
      if (data.item === 'mill_permit' || data.item === 'workshop_permit') {
        Processing.handlePermit(data.item);
      }
    });
  }

  // Feed context events to BuddyAI for context-aware social emojis
  if (typeof EventBus !== 'undefined' && typeof BuddyAI !== 'undefined') {
    EventBus.on('CROP_HARVESTED', () => BuddyAI.addContext('harvest', tick));
    EventBus.on('RESOURCE_SOLD', () => BuddyAI.addContext('sell', tick));
  }

  let prevMilestone = 0;  // track for SnapshotV2 milestone detection

  if (window.buddy) {
    window.buddy.onFarmUpdate((state) => {
      Farm.setState(state);
      if (state && state.worldWidth) {
        Viewport.setWorldWidth(state.worldWidth);
      }
      // Initialize NPCs from session history
      if (state && state.sessionHistory && typeof NPCManager !== 'undefined') {
        NPCManager.init(state.sessionHistory);
      }
      // Initialize skills from persisted state (only once)
      if (state && state.skills && typeof SkillSystem !== 'undefined') {
        SkillSystem.init(state.skills);
      }
      // Check passive chunk unlock based on cumulative tokens
      if (state && state.energy && typeof ChunkManager !== 'undefined') {
        ChunkManager.checkPassiveUnlock(state.energy);
      }
      // Sync cumulative energy to landmark generator for rarity scaling
      if (state && state.energy && typeof LandmarkGenerator !== 'undefined') {
        LandmarkGenerator.setCumulativeEnergy(state.energy);
      }
      // Detect new milestone for auto-snapshot
      if (state && state.milestoneReached && state.milestoneReached > prevMilestone) {
        if (prevMilestone > 0 && typeof EventBus !== 'undefined') {
          // Find matching milestone info from MILESTONES config
          const MILESTONES = [
            { energy: 50, emoji: '\u{1F955}', label: 'First Seed' },
            { energy: 150, emoji: '\u{1F33B}', label: 'Gardener' },
            { energy: 300, emoji: '\u{1F349}', label: 'Green Thumb' },
            { energy: 500, emoji: '\u{1F345}', label: 'Farmer' },
            { energy: 800, emoji: '\u{1F33D}', label: 'Rancher' },
            { energy: 1200, emoji: '\u{1F383}', label: 'Pioneer' },
            { energy: 1800, emoji: '\u{1F411}', label: 'Villager' },
            { energy: 2500, emoji: '\u{1F431}', label: 'Town Founder' },
            { energy: 3500, emoji: '\u{1F415}', label: 'Thriving Town' },
            { energy: 5000, emoji: '\u{1F550}', label: 'Prosperous Village' },
            { energy: 7500, emoji: '\u{1F3DB}', label: 'Metropolis' },
            { energy: 10000, emoji: '\u{1F5FF}', label: 'Legend' },
          ];
          const ms = MILESTONES.find(m => m.energy === state.milestoneReached);
          if (ms) {
            EventBus.emit('MILESTONE_UNLOCKED', ms);
          }
        }
        prevMilestone = state.milestoneReached;
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
    // Unlock audio on first click
    if (typeof AudioManager !== 'undefined') AudioManager.unlock();
    if (viewMode !== 'iso' || typeof IsoEngine === 'undefined') return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const grid = IsoEngine.mouseToGrid(mx, my);
    // Bulletin board modal takes priority
    if (typeof IsoUI !== 'undefined' && IsoUI.handleClick(grid.col, grid.row)) {
      return;
    }
    // NPC click handler
    if (typeof NPCManager !== 'undefined' && NPCManager.handleClick(grid.col, grid.row, tick)) {
      return;
    }
    // Tile click available for future interactions
  }

  // Keyboard handler
  const keys = {};
  document.addEventListener('keydown', (e) => {
    keys[e.key] = true;
    // Unlock audio on first user interaction
    if (typeof AudioManager !== 'undefined') AudioManager.unlock();
    // Shop/sell action (E key) — scene manager takes priority, then shop
    if ((e.key === 'e' || e.key === 'E') && !e.ctrlKey && !e.shiftKey) {
      // Scene transition (door enter/exit) takes top priority
      if (typeof SceneManager !== 'undefined' && SceneManager.handleAction()) {
        return;
      }
      if (typeof ShopUI !== 'undefined' && ShopUI.isOpen()) {
        ShopUI.handleKey(e.key, tick);
      } else if (typeof ShopUI !== 'undefined' && ShopUI.isNearShop()) {
        ShopUI.open();
      } else if (typeof IsoFishing !== 'undefined' && IsoFishing.isActive()) {
        IsoFishing.handleAction();
      } else if (typeof IsoFishing !== 'undefined' && IsoFishing.isNearWater()) {
        IsoFishing.startFishing();
      } else if (typeof LandmarkGenerator !== 'undefined' && LandmarkGenerator.getNearbyLandmark()) {
        LandmarkGenerator.handleAction();
      } else if (typeof IsoFarm !== 'undefined' && IsoFarm.sellAllCrops) {
        IsoFarm.sellAllCrops(tick);
      }
      return; // prevent E from falling through to handleKey (which would close the shop)
    }
    // Cooking UI (consumes keys when open)
    if (typeof CookingSystem !== 'undefined' && CookingSystem.isOpen()) {
      if (CookingSystem.handleKey(e.key, tick)) return;
    }
    // Collection UI (C key)
    if (typeof CollectionUI !== 'undefined' && CollectionUI.isOpen()) {
      if (CollectionUI.handleKey(e.key)) return;
    }
    if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.shiftKey) {
      if (typeof CollectionUI !== 'undefined') {
        CollectionUI.toggle();
        return;
      }
    }
    // Quest board (Q key)
    if (typeof QuestBoard !== 'undefined' && QuestBoard.isOpen()) {
      if (QuestBoard.handleKey(e.key, tick)) return;
    }
    if ((e.key === 'q' || e.key === 'Q') && !e.ctrlKey && !e.shiftKey) {
      if (typeof QuestBoard !== 'undefined' && QuestBoard.isNearBoard()) {
        QuestBoard.toggle();
        return;
      }
    }
    // Forward other keys to shop modal when open
    if (typeof ShopUI !== 'undefined' && ShopUI.isOpen()) {
      if (ShopUI.handleKey(e.key, tick)) return;
    }
    // Screenshot to file (F12)
    if (e.key === 'F12') {
      if (window.buddy && window.buddy.captureToFile) {
        window.buddy.captureToFile('D:\\Mine\\claude-buddy\\Images\\screenshot-farm-new.png');
      }
      return;
    }
    // Fullscreen toggle (F11)
    if (e.key === 'F11') {
      if (window.buddy && window.buddy.toggleFullscreen) {
        window.buddy.toggleFullscreen();
      }
      return;
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

    // Overworld-only: farm init, buddy sync, startup camera
    const isOW = typeof SceneManager === 'undefined' || SceneManager.isOverworld();
    if (isOW) {
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
    }

    // Update scene manager (fade transitions)
    if (typeof SceneManager !== 'undefined') {
      SceneManager.update(tick);
    }

    // Player control + camera follow (replaces manual arrow-key panning)
    const sceneLock = (typeof SceneManager !== 'undefined' && SceneManager.isInputLocked());
    const modalLock = (typeof IsoUI !== 'undefined' && IsoUI.isOpen())
      || (typeof ShopUI !== 'undefined' && ShopUI.isOpen())
      || (typeof CollectionUI !== 'undefined' && CollectionUI.isOpen())
      || (typeof QuestBoard !== 'undefined' && QuestBoard.isOpen())
      || (typeof CookingSystem !== 'undefined' && (CookingSystem.isOpen() || CookingSystem.isCooking()));
    if (typeof Player !== 'undefined') {
      // Initialize player at farm center (offset by home chunk in mega-map)
      if (!playerInited) {
        const homeOff = (typeof ChunkManager !== 'undefined' && ChunkManager.getHomeOffset)
          ? ChunkManager.getHomeOffset() : { col: 0, row: 0 };
        Player.init(homeOff.col + 9, homeOff.row + 7, {
          collisionFn: (wx, wy) => {
            const col = Math.floor(wx / IsoEngine.TILE_W);
            const row = Math.floor(wy / IsoEngine.TILE_H);
            const tile = IsoEngine.getTile(col, row);
            // In interior mode, stone tiles are walls
            if (typeof IsoEngine !== 'undefined' && IsoEngine.isInteriorMode()) {
              return tile === 'stone' || tile === null;
            }
            return Player.SOLID_TILES.has(tile);
          },
          dirtParticleFn: (col, row, speed) => {
            if (typeof IsoEffects !== 'undefined') {
              IsoEffects.spawnDirtParticles(col, row, speed);
            }
          },
        });
        playerInited = true;
      }
      if (!modalLock && !sceneLock) {
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

      // Update chunk loading based on player position (overworld only)
      if (isOW && typeof ChunkManager !== 'undefined') {
        const pt = Player.getTile();
        ChunkManager.updatePlayerPosition(pt.col, pt.row);
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

    // Overworld-only game systems
    if (isOW) {
      // Auto-pan idle camera tour (only when player is not moving)
      if (typeof Player !== 'undefined' && Player.isMoving()) {
        // Player is moving — don't auto-pan
      } else if (IsoFarm.updateAutoPan) {
        IsoFarm.updateAutoPan();
      }

      // Update processing buildings (mill, workshop, barn feed)
      if (typeof Processing !== 'undefined') {
        Processing.update();
      }

      // Update fishing mini-game
      if (typeof IsoFishing !== 'undefined') {
        IsoFishing.update(tick);
      }

      // Update wilderness landmarks
      if (typeof LandmarkGenerator !== 'undefined') {
        LandmarkGenerator.update(tick);
      }

      // Update automation (sprinklers, auto-collector)
      if (typeof Automation !== 'undefined') {
        Automation.update(tick);
      }

      // Update pet dog AI
      if (typeof PetAI !== 'undefined') {
        PetAI.update(tick);
        // Add pet entity for rendering
        const petEntity = PetAI.getEntity();
        if (petEntity) {
          IsoEngine.setPet(petEntity);
        }
      }

      // Update monument v2 (stage calculation)
      if (typeof MonumentV2 !== 'undefined') {
        MonumentV2.update(tick);
      }

      // Update milestone snapshot theater
      if (typeof SnapshotV2 !== 'undefined') {
        SnapshotV2.update(tick);
      }

      // Update buddy AI (farming/tending behavior)
      if (typeof BuddyAI !== 'undefined') {
        BuddyAI.update(tick);
      }

      // Update NPC AI (historical session characters)
      if (typeof NPCManager !== 'undefined') {
        NPCManager.update(tick);
      }
    }

    // Overworld-only: quest board proximity
    if (isOW && typeof QuestBoard !== 'undefined') {
      QuestBoard.update(tick);
    }

    // Update cooking system (buffs tick in all scenes)
    if (typeof CookingSystem !== 'undefined') {
      CookingSystem.update(tick);
    }

    // Update entity manager (always — manages interior furniture too)
    IsoEntityManager.update(tick);
    IsoEntityManager.syncToEngine();

    // Clear canvas background
    if (isOW) {
      // Seasonal sky gradient (overworld)
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

      // Seasons system (fireflies, snow, tree palette updates)
      if (typeof IsoSeasons !== 'undefined') {
        IsoSeasons.update(tick, canvas.width, canvas.height);
      }
    } else {
      // Interior: dark wooden floor background
      ctx.fillStyle = '#2A1F14';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Update particles
    IsoEngine.updateParticles();

    // Render tile map + entities
    IsoEngine.drawMap(ctx, canvas.width, canvas.height, tick);

    // Overworld-only render passes
    if (isOW) {
      // Seasonal ground tint overlay (after tiles, before particles)
      if (typeof IsoWeather !== 'undefined') {
        IsoWeather.drawGroundTint(ctx, canvas.width, canvas.height);
      }

      // Winter snow overlay on ground
      if (typeof IsoSeasons !== 'undefined') {
        IsoSeasons.drawSnowOverlay(ctx, canvas.width, canvas.height, tick);
      }
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

    if (isOW) {
      // Weather overlay
      if (typeof IsoWeather !== 'undefined') {
        IsoWeather.draw(ctx, canvas.width, canvas.height, tick);
        // Dynamic weather effects (rain, fog, lightning)
        IsoWeather.drawWeatherEffects(ctx, canvas.width, canvas.height, tick);
        // Dynamic lighting replaces simple night overlay when available
        if (typeof IsoLighting !== 'undefined') {
          IsoLighting.draw(ctx, canvas.width, canvas.height, tick);
        } else {
          IsoWeather.drawNightOverlay(ctx, canvas.width, canvas.height, tick);
        }
      }

      // Summer fireflies (after night overlay, glow on top of darkness)
      if (typeof IsoSeasons !== 'undefined') {
        IsoSeasons.drawFireflies(ctx, canvas.width, canvas.height, tick);
      }

      // Entity tooltips
      if (typeof IsoTooltip !== 'undefined') {
        IsoTooltip.draw(ctx, canvas.width, canvas.height, tick);
      }

      // Fishing visuals (bobber, line, "!" indicator)
      if (typeof IsoFishing !== 'undefined') {
        IsoFishing.draw(ctx, tick);
        IsoFishing.drawPrompt(ctx, canvas.width, canvas.height);
      }

      // Wilderness landmark visuals + prompt
      if (typeof LandmarkGenerator !== 'undefined') {
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.scale(IsoEngine.getZoom(), IsoEngine.getZoom());
        LandmarkGenerator.draw(ctx, tick);
        ctx.restore();
        LandmarkGenerator.drawPrompt(ctx, canvas.width, canvas.height);
      }

      // Automation device visuals (sprinklers, collector)
      if (typeof Automation !== 'undefined') {
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.scale(IsoEngine.getZoom(), IsoEngine.getZoom());
        Automation.draw(ctx, tick);
        ctx.restore();
      }

      // HUD (Harvest Moon style)
      IsoFarm.drawHUD(ctx, canvas.width, canvas.height, tick);

      // Cooking buff HUD icons (visible in overworld too)
      if (typeof CookingSystem !== 'undefined') {
        CookingSystem.draw(ctx, canvas.width, canvas.height, tick);
      }

      // NPC info popup (when clicked)
      if (typeof NPCManager !== 'undefined') {
        NPCManager.draw(ctx, canvas.width, canvas.height, tick);
      }

      // Shop prompt (when near tool shed)
      if (typeof ShopUI !== 'undefined') {
        ShopUI.drawShopPrompt(ctx, canvas.width, canvas.height);
      }

      // Quest board prompt (when near board)
      if (typeof QuestBoard !== 'undefined') {
        QuestBoard.drawPrompt(ctx, canvas.width, canvas.height);
      }

      // Modal overlay (bulletin board daily summary)
      if (typeof IsoUI !== 'undefined') {
        IsoUI.update();
        IsoUI.draw(ctx, canvas.width, canvas.height, tick);
      }

      // Shop modal overlay
      if (typeof ShopUI !== 'undefined') {
        ShopUI.update();
        ShopUI.draw(ctx, canvas.width, canvas.height, tick);
      }

      // Collection UI modal overlay
      if (typeof CollectionUI !== 'undefined') {
        CollectionUI.update();
        CollectionUI.draw(ctx, canvas.width, canvas.height, tick);
      }

      // Quest board modal overlay
      if (typeof QuestBoard !== 'undefined' && QuestBoard.isOpen()) {
        QuestBoard.draw(ctx, canvas.width, canvas.height, tick);
      }
    } else {
      // Interior: draw room name label
      if (typeof SceneManager !== 'undefined') {
        const ai = SceneManager.getActiveInterior();
        if (ai) {
          ctx.font = 'bold 10px monospace';
          ctx.fillStyle = 'rgba(255,255,255,0.7)';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(ai.name, canvas.width / 2, 8);
        }
      }

      // Cooking system (interior only: prompt, menu, cooking anim)
      if (typeof CookingSystem !== 'undefined') {
        CookingSystem.draw(ctx, canvas.width, canvas.height, tick);
      }
    }

    // Scene manager: door prompt + fade overlay (on top of everything)
    if (typeof SceneManager !== 'undefined') {
      SceneManager.drawPrompt(ctx, canvas.width, canvas.height);
      SceneManager.drawFade(ctx, canvas.width, canvas.height);
    }

    // Milestone snapshot theater (cinematic bars, on top of everything)
    if (typeof SnapshotV2 !== 'undefined') {
      SnapshotV2.drawTheater(ctx, canvas.width, canvas.height, tick);
    }
  }

  requestAnimationFrame(loop);
})();
