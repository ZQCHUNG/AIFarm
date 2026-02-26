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
  let cameraSnappedToPlayer = false;
  let savedPlayerPos = null; // { x, y } from farm state for position resume
  let farmStateReceived = false; // wait for farm state before player init
  let _lastCollisionLog = 0; // throttle collision debug logs
  let _blockedTile = null; // { col, row, time } — flash-highlight the tile that blocks the player
  let _blockedTileExpiry = 0;

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

  // Initialize Asset Manager (lazy loading + manifest support)
  if (typeof AssetManager !== 'undefined') {
    AssetManager.init({ basePath: '.', manifestUrl: 'sprites/sprites.json' });
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

  // Initialize construction system + EventBus listeners
  if (typeof ConstructionManager !== 'undefined') {
    ConstructionManager.setupListeners();
  }

  // Initialize oracle effects (webhook event visuals)
  if (typeof OracleEffects !== 'undefined') {
    OracleEffects.setupListeners();
  }

  // Initialize trade UI (player-to-player trading)
  if (typeof TradeUI !== 'undefined') {
    TradeUI.setupListeners();
  }

  // Initialize market economy (dynamic pricing + oracle bull market)
  if (typeof MarketEconomy !== 'undefined') {
    MarketEconomy.setupListeners();
  }

  // Initialize gamepad input
  if (typeof GamepadInput !== 'undefined') {
    GamepadInput.init();
  }

  // Initialize tutorial manager (new player onboarding)
  if (typeof TutorialManager !== 'undefined') {
    TutorialManager.setupListeners();
  }

  // Initialize ambient audio (procedural environmental sounds)
  if (typeof AmbientAudio !== 'undefined') {
    AmbientAudio.init();
  }

  // Initialize friendship system (NPC hearts & gifting)
  if (typeof FriendshipSystem !== 'undefined') {
    FriendshipSystem.setupListeners();
  }

  // Apply global balance pass (speed, economy, crop values)
  if (typeof GlobalBalance !== 'undefined') {
    GlobalBalance.apply();
  }

  // Initialize AI broadcast board (NPC commentary on activities)
  if (typeof AIBroadcast !== 'undefined') {
    AIBroadcast.init();
    AIBroadcast.setupListeners();
  }

  // Note: TechTree.setupListeners() and TradeDiplomacy.setupListeners()
  // are called inside onFarmUpdate AFTER init() to avoid state race conditions.

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
      // Initialize construction from persisted state
      if (typeof ConstructionManager !== 'undefined') {
        ConstructionManager.init(state && state.construction || null);
      }
      // Initialize tutorial from persisted state
      if (typeof TutorialManager !== 'undefined') {
        TutorialManager.init(state && state.tutorial || null);
      }
      // Initialize friendship system from persisted state
      if (typeof FriendshipSystem !== 'undefined') {
        FriendshipSystem.init(state && state.friendship || null);
      }
      // Initialize victory monument from persisted state
      if (typeof VictoryMonument !== 'undefined') {
        VictoryMonument.init(state && state.victory || null);
      }
      // Initialize tech tree from persisted state (setupListeners after init to avoid race)
      if (typeof TechTree !== 'undefined') {
        TechTree.init(state && state.techTree || null);
        if (!TechTree._listenersReady) { TechTree.setupListeners(); TechTree._listenersReady = true; }
      }
      // Initialize house customizer from persisted state
      if (typeof HouseCustomizer !== 'undefined') {
        HouseCustomizer.init(state && state.houseCustom || null);
      }
      // Initialize AI broadcast from persisted state (only once)
      if (typeof AIBroadcast !== 'undefined' && state && state.broadcast && !AIBroadcast._stateLoaded) {
        AIBroadcast.loadState(state.broadcast);
        AIBroadcast._stateLoaded = true;
      }
      // Initialize trade diplomacy from persisted state (setupListeners after init to avoid race)
      if (typeof TradeDiplomacy !== 'undefined') {
        TradeDiplomacy.init(state && state.tradeDiplo || null);
        if (!TradeDiplomacy._listenersReady) { TradeDiplomacy.setupListeners(); TradeDiplomacy._listenersReady = true; }
      }
      // Restore saved player position (before player init)
      if (state && state.playerPosition) {
        savedPlayerPos = state.playerPosition;
      }
      farmStateReceived = true;
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
    window.buddy.onFarmEnergyTick((pts) => {
      // Route energy ticks to construction system as token burns
      if (typeof EventBus !== 'undefined' && pts > 0) {
        EventBus.emit('TOKEN_BURNED', { amount: pts });
      }
      // Notify HUD token burning indicator
      if (typeof IsoFarm !== 'undefined' && IsoFarm.notifyEnergyTick) {
        IsoFarm.notifyEnergyTick(pts);
      }
    });
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
    // UGC custom sprite registration
    window.buddy.onUGCSpriteAdded((config) => {
      console.log(`[UGC] Custom sprite registered: ${config.id}`);
      if (typeof AssetManager !== 'undefined') {
        AssetManager.registerDynamic(config.id, {
          src: config.path,
          frameW: config.width,
          frameH: config.height,
          frames: config.frames,
          category: config.category,
        });
      }
    });
    window.buddy.onUGCSpriteRemoved((spriteId) => {
      console.log(`[UGC] Custom sprite removed: ${spriteId}`);
      // AssetManager doesn't have remove — just log for now
    });

    window.buddy.onSpritesReload((data) => {
      console.log(`[Sprites] Hot-reload triggered by: ${data.trigger}`);
      if (typeof SpriteManager !== 'undefined') {
        SpriteManager.reloadAll('.').then(({ loaded, failed }) => {
          console.log(`[Sprites] Reloaded: ${loaded.length} loaded, ${failed.length} failed`);
        });
      }
    });
    // F3 debug dashboard toggle via global shortcut (bypasses Chromium)
    if (window.buddy.onToggleDebugDashboard) {
      window.buddy.onToggleDebugDashboard(() => {
        if (typeof DebugDashboard !== 'undefined') DebugDashboard.toggle();
      });
    }
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
      // Scale zoom proportionally to canvas height (baseline: 351px → 1.8x)
      if (viewMode === 'iso' && typeof IsoEngine !== 'undefined') {
        const idealZoom = 1.8 * (h / 351);
        const actualZoom = Math.max(1.0, Math.min(5.0, idealZoom));
        IsoEngine.setZoom(actualZoom);
        // Compensate player speed if zoom was capped
        if (typeof Player !== 'undefined') {
          Player.setSpeedMultiplier(idealZoom / actualZoom);
        }
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      const pixel = ctx.getImageData(e.offsetX, e.offsetY, 1, 1).data;
      // Use alpha threshold of 20 to avoid edge jitter (Bug B fix)
      window.buddy.setIgnoreMouseEvents(pixel[3] < 20);
    });
    canvas.addEventListener('mouseleave', () => {
      window.buddy.setIgnoreMouseEvents(true);
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
    // Ensure window has keyboard focus on click
    if (window.buddy && window.buddy.focusWindow) window.buddy.focusWindow();
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

  // Remote play API — allows external control via CDP/executeJavaScript
  const KEY_MAP = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' };
  window.remotePlay = {
    // Move in a direction for ms milliseconds. e.g. remotePlay.move('up', 500)
    // Sets the closure `keys` object directly so the game loop's Player.update(keys) picks it up.
    // Requires backgroundThrottling:false in main.js so rAF keeps running when unfocused.
    move(dir, ms) {
      const key = KEY_MAP[dir];
      if (!key) return `Unknown dir: ${dir}. Use left/right/up/down`;
      if (typeof Player === 'undefined') return 'No Player';
      const duration = ms || 300;
      keys[key] = true;
      setTimeout(() => { keys[key] = false; }, duration);
      return `Moving ${dir} for ${duration}ms`;
    },
    // Press a key (for menus). e.g. remotePlay.press('r')
    press(key) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      setTimeout(() => {
        document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
      }, 50);
      return `Pressed ${key}`;
    },
    // Get player position (tile coords)
    pos() {
      if (typeof Player !== 'undefined') return Player.getPosition();
      return null;
    },
    // Get player tile
    tile() {
      if (typeof Player !== 'undefined') return Player.getTile();
      return null;
    },
    // Teleport player to tile (col, row)
    tp(col, row) {
      if (typeof Player !== 'undefined') {
        Player.setPosition(col * 32 + 16, row * 32 + 16);
        return `Teleported to (${col}, ${row})`;
      }
      return 'No Player';
    },
    // Debug: expose closure state for diagnosing movement issues
    debug() {
      const ml = (typeof IsoUI !== 'undefined' && IsoUI.isOpen())
        || (typeof ShopUI !== 'undefined' && ShopUI.isOpen())
        || (typeof CollectionUI !== 'undefined' && CollectionUI.isOpen())
        || (typeof QuestBoard !== 'undefined' && QuestBoard.isOpen())
        || (typeof CookingSystem !== 'undefined' && (CookingSystem.isOpen() || CookingSystem.isCooking()))
        || (typeof TradeUI !== 'undefined' && TradeUI.isOpen())
        || (typeof CreditsScreen !== 'undefined' && CreditsScreen.isOpen())
        || (typeof TechTree !== 'undefined' && TechTree.isOpen())
        || (typeof HouseCustomizer !== 'undefined' && HouseCustomizer.isOpen())
        || (typeof AIBroadcast !== 'undefined' && AIBroadcast.isOpen());
      const sl = (typeof SceneManager !== 'undefined' && SceneManager.isInputLocked());
      const ta = (typeof TutorialManager !== 'undefined' && TutorialManager.isActive());
      return {
        modalLock: ml, sceneLock: sl, tutActive: ta,
        activeKeys: Object.keys(keys).filter(k => keys[k]),
        tile: typeof Player !== 'undefined' ? Player.getTile() : null,
        pos: typeof Player !== 'undefined' ? Player.getPosition() : null,
      };
    },
  };

  document.addEventListener('keydown', (e) => {
    keys[e.key] = true;
    // Switch to keyboard mode when typing
    if (typeof GamepadInput !== 'undefined') GamepadInput.onKeyboardInput();
    // Unlock audio on first user interaction
    if (typeof AudioManager !== 'undefined') AudioManager.unlock();
    if (typeof AmbientAudio !== 'undefined') AmbientAudio.unlock();
    // Tutorial consumes certain keys when active
    if (typeof TutorialManager !== 'undefined' && TutorialManager.isActive()) {
      if (TutorialManager.handleKey(e.key)) return;
    }
    // Post-processing filter cycle (F9)
    if (e.key === 'F9') {
      if (typeof PostProcessing !== 'undefined') PostProcessing.cycleFilter();
      return;
    }
    // Credits screen (F1)
    if (e.key === 'F1') {
      if (typeof CreditsScreen !== 'undefined') {
        if (CreditsScreen.isOpen()) {
          CreditsScreen.handleKey(e.key);
        } else {
          CreditsScreen.toggleCredits();
        }
      }
      return;
    }
    // Debug dashboard toggle (F3)
    if (e.key === 'F3') {
      e.preventDefault(); // Prevent Chromium's "Find Next"
      if (typeof DebugDashboard !== 'undefined') DebugDashboard.toggle();
      return;
    }
    // Save export (F4)
    if (e.key === 'F4') {
      if (typeof CreditsScreen !== 'undefined') CreditsScreen.exportSave();
      return;
    }
    // Gift to nearby NPC (G key)
    if ((e.key === 'g' || e.key === 'G') && !e.ctrlKey && !e.shiftKey) {
      if (typeof FriendshipSystem !== 'undefined') {
        FriendshipSystem.tryGift(tick);
      }
      return;
    }
    // Tech tree menu (R key)
    if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.shiftKey) {
      if (typeof TechTree !== 'undefined') {
        if (TechTree.isOpen()) {
          TechTree.handleKey(e.key);
        } else {
          TechTree.toggle();
        }
      }
      return;
    }
    // House customizer (H key, near house)
    if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.shiftKey) {
      if (typeof HouseCustomizer !== 'undefined') {
        if (HouseCustomizer.isOpen()) {
          HouseCustomizer.handleKey(e.key);
        } else {
          HouseCustomizer.toggle();
        }
      }
      return;
    }
    // AI broadcast board (B key)
    if ((e.key === 'b' || e.key === 'B') && !e.ctrlKey && !e.shiftKey) {
      if (typeof AIBroadcast !== 'undefined') {
        if (AIBroadcast.isOpen()) {
          AIBroadcast.handleKey(e.key);
        } else {
          AIBroadcast.toggle();
        }
      }
      return;
    }
    // Shop/sell action (E key) — scene manager takes priority, then shop
    if ((e.key === 'e' || e.key === 'E') && !e.ctrlKey && !e.shiftKey) {
      // Trade diplomacy amount adjustment when open
      if (typeof TradeDiplomacy !== 'undefined' && TradeDiplomacy.isOpen()) {
        TradeDiplomacy.handleKey(e.key);
        return;
      }
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
      } else if (typeof WorldEvents !== 'undefined' && WorldEvents.hasActiveEvent()) {
        WorldEvents.tryInteract();
      } else if (typeof IsoFarm !== 'undefined' && IsoFarm.sellAllCrops) {
        IsoFarm.sellAllCrops(tick);
      }
      return; // prevent E from falling through to handleKey (which would close the shop)
    }
    // Tech tree (consumes keys when open)
    if (typeof TechTree !== 'undefined' && TechTree.isOpen()) {
      if (TechTree.handleKey(e.key)) return;
    }
    // House customizer (consumes keys when open)
    if (typeof HouseCustomizer !== 'undefined' && HouseCustomizer.isOpen()) {
      if (HouseCustomizer.handleKey(e.key)) return;
    }
    // AI broadcast (consumes keys when open)
    if (typeof AIBroadcast !== 'undefined' && AIBroadcast.isOpen()) {
      if (AIBroadcast.handleKey(e.key)) return;
    }
    // Trade diplomacy (consumes keys when open)
    if (typeof TradeDiplomacy !== 'undefined' && TradeDiplomacy.isOpen()) {
      if (TradeDiplomacy.handleKey(e.key)) return;
    }
    // Credits screen (consumes keys when open)
    if (typeof CreditsScreen !== 'undefined' && CreditsScreen.isOpen()) {
      if (CreditsScreen.handleKey(e.key)) return;
    }
    // Trade UI (consumes keys when open)
    if (typeof TradeUI !== 'undefined' && TradeUI.isOpen()) {
      if (TradeUI.handleKey(e.key, tick)) return;
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
    // Quest board (Q key) — TradeDiplomacy consumes Q for amount decrease when open
    if ((e.key === 'q' || e.key === 'Q') && typeof TradeDiplomacy !== 'undefined' && TradeDiplomacy.isOpen()) {
      TradeDiplomacy.handleKey(e.key);
      return;
    }
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
    // [T] key — trade with nearby player, or token burn simulator
    if ((e.key === 't' || e.key === 'T') && !e.ctrlKey && !e.shiftKey) {
      // Trade UI consumes key when open
      if (typeof TradeUI !== 'undefined' && TradeUI.isOpen()) {
        TradeUI.handleKey(e.key, tick);
        return;
      }
      // Try to open trade with nearby player
      if (typeof TradeUI !== 'undefined' && TradeUI.getNearbyPlayer()) {
        TradeUI.requestTrade();
        return;
      }
      // Trade diplomacy (cross-village trade routes)
      if (typeof TradeDiplomacy !== 'undefined') {
        TradeDiplomacy.toggle();
        return;
      }
      // Fallback: token burn simulator for construction testing
      if (typeof ConstructionManager !== 'undefined' && !modalLock) {
        ConstructionManager.setSimulating(true);
      }
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
  document.addEventListener('keyup', (e) => {
    keys[e.key] = false;
    // Stop token simulator on T release
    if ((e.key === 't' || e.key === 'T') && typeof ConstructionManager !== 'undefined') {
      ConstructionManager.setSimulating(false);
    }
  });

  function getAnimFrame(state) {
    if (state === 'celebrating') return 0;
    if (state === 'idle') return (tick % BLINK_INTERVAL) < BLINK_DURATION ? 1 : 0;
    if (state === 'sleeping') return ((tick / (ANIM_SPEED * 2)) | 0) % 4;
    return ((tick / ANIM_SPEED) | 0) % 4;
  }

  // ---------- Interaction indicator ----------
  // Shows a bouncing [E] above the player when near an interactable entity
  // that doesn't already have its own prompt.
  function drawInteractionIndicator(ctx, canvasW, canvasH, tick) {
    if (typeof Player === 'undefined' || typeof IsoEngine === 'undefined') return;

    // Check if any interaction-specific prompt is already showing
    const shopOpen = typeof ShopUI !== 'undefined' && (ShopUI.isOpen() || ShopUI.isNearShop());
    const fishingNear = typeof IsoFishing !== 'undefined' && (IsoFishing.isNearWater() || IsoFishing.isActive());
    const landmarkNear = typeof LandmarkGenerator !== 'undefined' && LandmarkGenerator.getNearbyLandmark();
    const worldEventNear = typeof WorldEvents !== 'undefined' && WorldEvents.hasActiveEvent();
    // If a specific module is already showing its prompt, skip
    if (shopOpen || fishingNear || landmarkNear || worldEventNear) return;

    // Check for sell action (near shipping bin)
    const pt = Player.getTile();
    const homeOff = (typeof ChunkManager !== 'undefined' && ChunkManager.getHomeOffset)
      ? ChunkManager.getHomeOffset() : { col: 0, row: 0 };
    const SHIPPING_COL = homeOff.col + 12;
    const SHIPPING_ROW = homeOff.row + 9;
    const nearShip = Math.abs(pt.col - SHIPPING_COL) <= 2 && Math.abs(pt.row - SHIPPING_ROW) <= 2;

    // Check for NPC gifting (G key)
    const nearNPC = typeof NPCManager !== 'undefined' && NPCManager.getNearestNPC && NPCManager.getNearestNPC();

    if (!nearShip && !nearNPC) return;

    // Draw floating prompt above player
    const pp = Player.getPosition();
    const screenPos = IsoEngine.gridToScreen(pp.x / 32, pp.y / 32);
    const zoom = IsoEngine.getZoom();
    const sx = screenPos.x * zoom + 16 * zoom;
    const sy = screenPos.y * zoom - 8 * zoom;
    const bounce = Math.sin(tick * 0.12) * 3;

    let text, key;
    if (nearShip) { text = 'Sell'; key = 'E'; }
    else if (nearNPC) { text = 'Gift'; key = 'G'; }

    // Background pill
    ctx.save();
    ctx.font = 'bold 8px monospace';
    const tw = ctx.measureText(`[${key}] ${text}`).width;
    const px = sx - tw / 2 - 6;
    const py = sy - 20 + bounce;
    ctx.fillStyle = 'rgba(20, 20, 40, 0.85)';
    ctx.beginPath();
    const r = 5;
    const w = tw + 12, h = 16;
    ctx.moveTo(px + r, py);
    ctx.arcTo(px + w, py, px + w, py + h, r);
    ctx.arcTo(px + w, py + h, px, py + h, r);
    ctx.arcTo(px, py + h, px, py, r);
    ctx.arcTo(px, py, px + w, py, r);
    ctx.closePath();
    ctx.fill();

    // Key highlight
    ctx.fillStyle = '#5BEF5B';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`[${key}] ${text}`, sx, py + h / 2);
    ctx.restore();
  }

  // ---------- Separated logic / render architecture ----------
  // Logic runs on setInterval (guaranteed 60Hz even when rAF pauses).
  // Render runs on requestAnimationFrame (smooth drawing, can pause safely).
  let lastRenderTick = 0;

  function logicTick() {
    tick++;
    try {
      if (viewMode === 'iso') {
        logicTopDown();
      }
    } catch (e) {
      console.error('[Renderer] logic error:', e.message, e.stack);
      if (typeof DebugDashboard !== 'undefined') DebugDashboard.logError('logic', e.message);
    }
  }

  function loop() {
    try {
      if (viewMode === 'iso') {
        renderTopDown();
      } else {
        loopClassic();
      }
    } catch (e) {
      // Never let the render loop die — log and continue next frame
      console.error('[Renderer] render error:', e.message, e.stack);
      if (typeof DebugDashboard !== 'undefined') DebugDashboard.logError('render', e.message);
    }
    lastRenderTick = tick;
    requestAnimationFrame(loop);
  }

  // Start logic at ~60Hz via setInterval (immune to rAF throttling)
  setInterval(logicTick, 1000 / 60);

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

  // ===== logicTopDown — game state updates (runs via setInterval, immune to rAF pause) =====
  function logicTopDown() {
    if (typeof IsoFarm === 'undefined' || typeof IsoEngine === 'undefined' || typeof IsoEntityManager === 'undefined') {
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

    // Poll gamepad and merge virtual keys
    if (typeof GamepadInput !== 'undefined') {
      GamepadInput.poll();
      const gpKeys = GamepadInput.getKeys();
      for (const k of Object.keys(gpKeys)) {
        if (gpKeys[k]) keys[k] = true;
      }
      // Process gamepad button presses as keyboard events
      const presses = GamepadInput.popPresses();
      for (const key of presses) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      }
    }

    // Player control + camera follow
    const sceneLock = (typeof SceneManager !== 'undefined' && SceneManager.isInputLocked());
    const modalLock = (typeof IsoUI !== 'undefined' && IsoUI.isOpen())
      || (typeof ShopUI !== 'undefined' && ShopUI.isOpen())
      || (typeof CollectionUI !== 'undefined' && CollectionUI.isOpen())
      || (typeof QuestBoard !== 'undefined' && QuestBoard.isOpen())
      || (typeof CookingSystem !== 'undefined' && (CookingSystem.isOpen() || CookingSystem.isCooking()))
      || (typeof TradeUI !== 'undefined' && TradeUI.isOpen())
      || (typeof CreditsScreen !== 'undefined' && CreditsScreen.isOpen())
      || (typeof TechTree !== 'undefined' && TechTree.isOpen())
      || (typeof HouseCustomizer !== 'undefined' && HouseCustomizer.isOpen())
      || (typeof AIBroadcast !== 'undefined' && AIBroadcast.isOpen())
      || (typeof TradeDiplomacy !== 'undefined' && TradeDiplomacy.isOpen());
    if (typeof Player !== 'undefined') {
      // Initialize player at farm center (offset by home chunk in mega-map)
      // Wait for farm state so we can restore saved position
      if (!playerInited && farmStateReceived) {
        const homeOff = (typeof ChunkManager !== 'undefined' && ChunkManager.getHomeOffset)
          ? ChunkManager.getHomeOffset() : { col: 0, row: 0 };
        Player.init(homeOff.col + 9, homeOff.row + 7, {
          collisionFn: (wx, wy) => {
            // Sub-tile circular collision: tree/water use radius-based checks
            // so players can walk along tile edges without hitting invisible walls.
            // Mountain/fence/empty keep full-tile collision.
            const TW = IsoEngine.TILE_W;
            const TH = IsoEngine.TILE_H;
            const col = Math.floor(wx / TW);
            const row = Math.floor(wy / TH);

            // In interior mode, stone tiles are walls (full-tile)
            if (typeof IsoEngine !== 'undefined' && IsoEngine.isInteriorMode()) {
              const tile = IsoEngine.getTile(col, row);
              return tile === 'stone' || tile === null;
            }

            // Collision radii for sub-tile types (squared for fast comparison)
            const TREE_R2 = 10 * 10;   // 10px radius
            const WATER_R2 = 14 * 14;  // 14px radius

            // Check current tile + 4 neighbors (radius can extend across tile borders)
            const offsets = [[0,0], [-1,0], [1,0], [0,-1], [0,1]];
            for (let i = 0; i < offsets.length; i++) {
              const c = col + offsets[i][0];
              const r = row + offsets[i][1];
              const tile = IsoEngine.getTile(c, r);
              if (!Player.SOLID_TILES.has(tile)) continue;

              // Full-tile collision for mountain/fence/empty/null
              if (tile === 'mountain' || tile === 'fence' || tile === 'empty' || tile === null) {
                // Only block if (wx, wy) is actually inside this tile
                if (c === col && r === row) {
                  _blockedTile = { col: c, row: r };
                  _blockedTileExpiry = Date.now() + 800;
                  return true;
                }
                continue;
              }

              // Sub-tile circular collision for tree/water
              const cx = c * TW + TW / 2;
              const cy = r * TH + TH / 2;
              const dx = wx - cx;
              const dy = wy - cy;
              const distSq = dx * dx + dy * dy;
              const radiusSq = tile === 'water' ? WATER_R2 : TREE_R2;

              if (distSq < radiusSq) {
                _blockedTile = { col: c, row: r };
                _blockedTileExpiry = Date.now() + 800;
                if (Date.now() - _lastCollisionLog > 500) {
                  _lastCollisionLog = Date.now();
                  console.log(`[Collision] Blocked at (${c},${r}) tile=${tile} dist=${Math.sqrt(distSq).toFixed(1)}`);
                }
                return true;
              }
            }
            return false;
          },
          dirtParticleFn: (col, row, speed) => {
            if (typeof IsoEffects !== 'undefined') {
              IsoEffects.spawnDirtParticles(col, row, speed);
            }
          },
        });
        // Restore saved position if available (resume from last session)
        // Validate: only restore if within reasonable distance of farm
        if (savedPlayerPos && savedPlayerPos.x && savedPlayerPos.y) {
          const ho = (typeof ChunkManager !== 'undefined' && ChunkManager.getHomeOffset)
            ? ChunkManager.getHomeOffset() : { col: 0, row: 0 };
          const dx = Math.abs(savedPlayerPos.x - (ho.col + 10));
          const dy = Math.abs(savedPlayerPos.y - (ho.row + 9));
          // Only restore if within 30 tiles of farm center (prevent spawning in mountains)
          if (dx < 30 && dy < 30) {
            Player.setPosition(savedPlayerPos.x, savedPlayerPos.y);
          } else {
            console.log('[Player] Saved position too far from farm (' + dx + ',' + dy + '), using default spawn');
          }
        }
        // Bump feedback: screen shake + dust particles + thud sound on wall collision
        Player.setBumpFn((wx, wy, dx, dy) => {
          if (typeof IsoEngine !== 'undefined' && IsoEngine.shake) {
            IsoEngine.shake(2.5);
          }
          if (typeof IsoEngine !== 'undefined' && IsoEngine.spawnBumpParticles) {
            IsoEngine.spawnBumpParticles(wx, wy, dx, dy);
          }
          if (typeof AudioManager !== 'undefined') AudioManager.playBump();
        });
        playerInited = true;
      }
      if (!modalLock && !sceneLock) {
        const anyMove = keys['ArrowLeft'] || keys['ArrowRight'] || keys['ArrowUp'] || keys['ArrowDown']
          || keys['a'] || keys['A'] || keys['d'] || keys['D']
          || keys['w'] || keys['W'] || keys['s'] || keys['S'];
        if (anyMove && IsoFarm.interruptAutoPan) IsoFarm.interruptAutoPan();
        Player.update(keys);
        // Footstep sounds (rate-limited: every 12 frames while walking, 8 while sprinting)
        if (Player.isMoving() && typeof AudioManager !== 'undefined') {
          const stepInterval = Player.isSprinting() ? 8 : 12;
          if (tick % stepInterval === 0) AudioManager.playFootstep();
        }
      }
      // Camera smoothly follows player (after startup animation finishes)
      if (!IsoFarm.isStartupAnimating()) {
        const pp = Player.getPosition();
        // On first frame after startup anim, snap camera instantly to player
        if (!cameraSnappedToPlayer) {
          IsoEngine.smoothFollow(pp.x, pp.y, 1.0);
          cameraSnappedToPlayer = true;
        } else {
          IsoEngine.smoothFollow(pp.x, pp.y, 0.08);
        }
      }

      // Update chunk loading based on player position (overworld only)
      if (isOW && typeof ChunkManager !== 'undefined') {
        const pt = Player.getTile();
        ChunkManager.updatePlayerPosition(pt.col, pt.row);
      }

      // Save player position every 5 seconds (300 ticks at 60Hz)
      if (tick % 300 === 0 && window.buddy && window.buddy.savePlayerPosition) {
        const pp = Player.getPosition();
        window.buddy.savePlayerPosition({ x: pp.x, y: pp.y });
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
      // Auto-pan idle camera tour — disabled when player character exists
      if (typeof Player === 'undefined' && IsoFarm.updateAutoPan) {
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
        const petEntity = PetAI.getEntity();
        if (petEntity) {
          IsoEngine.setPet(petEntity);
        }
      }

      // Update monument v2 (stage calculation)
      if (typeof MonumentV2 !== 'undefined') {
        MonumentV2.update(tick);
      }

      // Update construction system (progressive building)
      if (typeof ConstructionManager !== 'undefined') {
        ConstructionManager.update(tick);
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

      // Update oracle effects (gold rain, announcements)
      if (typeof OracleEffects !== 'undefined') {
        OracleEffects.update(tick);
      }

      // Update market economy (price fluctuation)
      if (typeof MarketEconomy !== 'undefined') {
        MarketEconomy.update(tick);
      }

      // Update world events (meteor, merchant, fairy ring)
      if (typeof WorldEvents !== 'undefined') {
        WorldEvents.update(tick);
      }

      // Update tutorial manager
      if (typeof TutorialManager !== 'undefined') {
        TutorialManager.update(tick);
      }

      // Update ambient audio (crossfade layers based on environment)
      if (typeof AmbientAudio !== 'undefined') {
        AmbientAudio.update(tick);
      }

      // Update weather hazards (lightning, drought, cozy buff)
      if (typeof WeatherLogicV2 !== 'undefined') {
        WeatherLogicV2.update(tick);
      }

      // Update friendship system (gift animations, dialogue timers)
      if (typeof FriendshipSystem !== 'undefined') {
        FriendshipSystem.update(tick);
      }

      // Update debug dashboard (FPS counter)
      if (typeof DebugDashboard !== 'undefined') {
        DebugDashboard.update(tick);
      }

      // Update victory monument (ascension check)
      if (typeof VictoryMonument !== 'undefined') {
        VictoryMonument.update(tick);
      }

      // Update AI broadcast board (random announcements)
      if (typeof AIBroadcast !== 'undefined') {
        AIBroadcast.update(tick);
      }

      // Update trade diplomacy (caravan events)
      if (typeof TradeDiplomacy !== 'undefined') {
        TradeDiplomacy.update(tick);
      }

      // Update network client (ghost player interpolation)
      if (typeof NetworkClient !== 'undefined') {
        NetworkClient.update(tick);
        if (NetworkClient.isConnected() && NetworkClient.shouldSend(tick)) {
          if (typeof Player !== 'undefined') {
            const pp = Player.getPosition();
            const pd = Player.getDirection ? Player.getDirection() : 'down';
            const pf = Player.getFrame ? Player.getFrame() : 0;
            const ps = Player.isSprinting && Player.isSprinting() ? 'sprint' : 'walk';
            NetworkClient.sendPosition(pp.x, pp.y, pd, pf, ps);
          }
        }
      }
    }

    // Overworld-only: quest board proximity
    if (isOW && typeof QuestBoard !== 'undefined') {
      QuestBoard.update(tick);
    }

    // Update credits screen (splash timer)
    if (typeof CreditsScreen !== 'undefined') {
      CreditsScreen.update(tick);
    }

    // Update cooking system (buffs tick in all scenes)
    if (typeof CookingSystem !== 'undefined') {
      CookingSystem.update(tick);
    }

    // Update entity manager (always — manages interior furniture too)
    IsoEntityManager.update(tick);
    IsoEntityManager.syncToEngine();

    // Clear gamepad-injected keys after logic tick
    if (typeof GamepadInput !== 'undefined') {
      const gpKeys = GamepadInput.getKeys();
      for (const k of Object.keys(gpKeys)) {
        delete keys[k];
      }
    }
  }

  // ===== renderTopDown — drawing only (runs via rAF, can pause without breaking game state) =====
  function renderTopDown() {
    if (typeof IsoFarm === 'undefined' || typeof IsoEngine === 'undefined' || typeof IsoEntityManager === 'undefined') {
      loopClassic();
      return;
    }

    const isOW = typeof SceneManager === 'undefined' || SceneManager.isOverworld();

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

    // Debug: flash-highlight the tile that blocked the player (bright red border)
    if (_blockedTile && Date.now() < _blockedTileExpiry) {
      const z = IsoEngine.getZoom();
      const cam = IsoEngine.getCameraState();
      const bx = Math.round(_blockedTile.col * IsoEngine.TILE_W + cam.x);
      const by = Math.round(_blockedTile.row * IsoEngine.TILE_H + cam.y);
      ctx.save();
      ctx.scale(z, z);
      const alpha = 0.4 + 0.3 * Math.sin(Date.now() * 0.01); // pulse
      ctx.strokeStyle = `rgba(255,0,0,${alpha.toFixed(2)})`;
      ctx.lineWidth = 3;
      ctx.strokeRect(bx + 1, by + 1, IsoEngine.TILE_W - 2, IsoEngine.TILE_H - 2);
      ctx.fillStyle = `rgba(255,0,0,${(alpha * 0.3).toFixed(2)})`;
      ctx.fillRect(bx, by, IsoEngine.TILE_W, IsoEngine.TILE_H);
      ctx.restore();
    } else {
      _blockedTile = null;
    }

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

      // Ghost players (network multiplayer)
      if (typeof NetworkClient !== 'undefined') {
        NetworkClient.draw(ctx, tick);
      }

      // Market ticker board (in zoomed space)
      if (typeof MarketEconomy !== 'undefined') {
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.scale(IsoEngine.getZoom(), IsoEngine.getZoom());
        MarketEconomy.draw(ctx, tick);
        ctx.restore();
      }

      // World events (meteor, merchant, fairy ring — in zoomed space)
      if (typeof WorldEvents !== 'undefined') {
        WorldEvents.draw(ctx, tick);
      }

      // Oracle effects overlay (gold rain tint, announcement banner, crystal HUD)
      if (typeof OracleEffects !== 'undefined') {
        OracleEffects.draw(ctx, canvas.width, canvas.height);
      }

      // Trade prompt (when near ghost player)
      if (typeof TradeUI !== 'undefined') {
        TradeUI.update();
        TradeUI.drawPrompt(ctx, canvas.width, canvas.height);
      }

      // Shop prompt (when near tool shed)
      if (typeof ShopUI !== 'undefined') {
        ShopUI.drawShopPrompt(ctx, canvas.width, canvas.height);
      }

      // Quest board prompt (when near board)
      if (typeof QuestBoard !== 'undefined') {
        QuestBoard.drawPrompt(ctx, canvas.width, canvas.height);
      }

      // Unified interaction indicator — bouncing [E] above player
      // when near ANY interactable (if no specific prompt is already shown)
      drawInteractionIndicator(ctx, canvas.width, canvas.height, tick);

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

      // Trade UI modal overlay
      if (typeof TradeUI !== 'undefined' && TradeUI.isOpen()) {
        TradeUI.draw(ctx, canvas.width, canvas.height, tick);
      }

      // Victory monument overlay (golden glow, ceremony fireworks)
      if (typeof VictoryMonument !== 'undefined') {
        VictoryMonument.draw(ctx, canvas.width, canvas.height, tick);
      }

      // Weather hazards overlay (lightning flash, drought tint)
      if (typeof WeatherLogicV2 !== 'undefined') {
        WeatherLogicV2.draw(ctx, canvas.width, canvas.height, tick);
      }

      // Friendship system (gift prompt, heart indicators, animations)
      if (typeof FriendshipSystem !== 'undefined') {
        FriendshipSystem.draw(ctx, canvas.width, canvas.height, tick);
      }

      // Tech tree modal overlay
      if (typeof TechTree !== 'undefined') {
        TechTree.draw(ctx, canvas.width, canvas.height, tick);
      }

      // House customizer overlay
      if (typeof HouseCustomizer !== 'undefined') {
        HouseCustomizer.draw(ctx, canvas.width, canvas.height, tick);
      }

      // AI broadcast board overlay
      if (typeof AIBroadcast !== 'undefined') {
        AIBroadcast.draw(ctx, canvas.width, canvas.height, tick);
      }

      // Trade diplomacy overlay
      if (typeof TradeDiplomacy !== 'undefined') {
        TradeDiplomacy.draw(ctx, canvas.width, canvas.height, tick);
      }

      // Tutorial overlay (dialog box + bouncing arrows, on top of modals)
      if (typeof TutorialManager !== 'undefined') {
        TutorialManager.draw(ctx, canvas.width, canvas.height, tick);
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

    // Post-processing filter (CRT scanlines, warm sunset — absolute last layer)
    if (typeof PostProcessing !== 'undefined') {
      PostProcessing.draw(ctx, canvas.width, canvas.height, tick);
    }

    // Debug dashboard (on top of everything, including filters)
    if (typeof DebugDashboard !== 'undefined') {
      DebugDashboard.draw(ctx, canvas.width, canvas.height, tick);
    }

    // Credits screen + startup splash (absolute final overlay)
    if (typeof CreditsScreen !== 'undefined') {
      CreditsScreen.draw(ctx, canvas.width, canvas.height, tick);
    }

  }

  requestAnimationFrame(loop);

  // Safety net: request fresh farm state after all modules initialized.
  // Fixes NPC disappearance when did-finish-load fires before listeners are ready.
  if (window.buddy && window.buddy.requestFarmSync) {
    setTimeout(() => window.buddy.requestFarmSync(), 500);
  }
})();
