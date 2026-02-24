// Unified village renderer — all buddies in one panoramic scene.
(function () {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');

  let tick = 0;
  const ANIM_SPEED = 14;
  const BLINK_INTERVAL = 200;
  const BLINK_DURATION = 8;
  const SLOT_W = Scene.SLOT_W; // logical slot width (matches main.js SLOT_W / PX... roughly 40)

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
    });
  }

  // Keyboard handler for debug pan mode
  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+D toggles debug camera pan
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      const active = Viewport.toggleDebugPan();
      console.log('[Viewport] Debug pan:', active ? 'ON' : 'OFF');
    }
  });

  function getAnimFrame(state) {
    if (state === 'celebrating') return 0; // stand facing camera
    if (state === 'idle') return (tick % BLINK_INTERVAL) < BLINK_DURATION ? 1 : 0;
    if (state === 'sleeping') return ((tick / (ANIM_SPEED * 2)) | 0) % 4;
    return ((tick / ANIM_SPEED) | 0) % 4;
  }

  function loop() {
    tick++;

    // Update viewport camera
    Viewport.update(tick);

    // Update train animations
    if (typeof Train !== 'undefined') {
      // Activate station once farm has enough energy (500+ = first animals)
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

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
})();
