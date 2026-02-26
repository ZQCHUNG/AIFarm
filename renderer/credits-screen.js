/**
 * credits-screen.js — Startup Splash & Credits Screen (Sprint 30 P2).
 *
 * Provides ceremony and polish for the 3.0 release:
 *   - Startup splash: "AIFarm 3.0" pixel-art title with fade-in animation
 *   - Credits page: accessible via [F1], shows development journey
 *   - Save export: [F4] triggers SQLite backup download
 *
 * The splash screen plays once on startup, then fades out.
 */
const CreditsScreen = (() => {
  // Splash state
  let splashActive = true;
  let splashTimer = 0;
  const SPLASH_DURATION = 180; // 3 seconds
  const SPLASH_FADE_IN = 30;
  const SPLASH_FADE_OUT = 30;

  // Credits state
  let creditsOpen = false;
  let scrollY = 0;
  const SCROLL_SPEED = 0.5;

  // Development timeline
  const CREDITS = [
    { type: 'title', text: 'AIFarm 3.0' },
    { type: 'subtitle', text: '"The Infinite Horizon"' },
    { type: 'spacer' },
    { type: 'header', text: 'Development Team' },
    { type: 'role', name: 'Joe', role: 'Decision Maker & Creative Director' },
    { type: 'role', name: 'Claude', role: 'Lead Developer & Engineer' },
    { type: 'role', name: 'Gemini CTO', role: 'Architecture & Code Review' },
    { type: 'role', name: 'Gemini PM', role: 'Sprint Planning & Feature Design' },
    { type: 'spacer' },
    { type: 'header', text: 'Development Journey' },
    { type: 'entry', text: 'Sprint 11-13: Foundation & Atmosphere' },
    { type: 'entry', text: 'Sprint 14-15: Economy & NPCs' },
    { type: 'entry', text: 'Sprint 16-17: Infinite World & Industry' },
    { type: 'entry', text: 'Sprint 18-19: Ecology & Exploration' },
    { type: 'entry', text: 'Sprint 20-21: Automation & Seasons' },
    { type: 'entry', text: 'Sprint 22-23: The Grand Repair & Mastery' },
    { type: 'entry', text: 'Sprint 24-25: Building & Infrastructure' },
    { type: 'entry', text: 'Sprint 26-27: Oracle & Wall Street' },
    { type: 'entry', text: 'Sprint 28-29: The Grand Gala & Final Horizon' },
    { type: 'entry', text: 'Sprint 30: The Grand Finale' },
    { type: 'spacer' },
    { type: 'header', text: 'Technology' },
    { type: 'entry', text: 'Electron + Canvas 2D' },
    { type: 'entry', text: 'Web Audio API (procedural synthesis)' },
    { type: 'entry', text: 'SQLite (WAL mode persistence)' },
    { type: 'entry', text: 'WebSocket (multiplayer prototype)' },
    { type: 'spacer' },
    { type: 'footer', text: 'Built with AI collaboration' },
    { type: 'footer', text: '2024-2026' },
  ];

  // ===== Splash =====

  function updateSplash() {
    if (!splashActive) return;
    splashTimer++;
    if (splashTimer >= SPLASH_DURATION) {
      splashActive = false;
    }
  }

  function drawSplash(ctx, canvasW, canvasH, tick) {
    if (!splashActive) return;

    // Calculate alpha
    let alpha = 1;
    if (splashTimer < SPLASH_FADE_IN) {
      alpha = splashTimer / SPLASH_FADE_IN;
    } else if (splashTimer > SPLASH_DURATION - SPLASH_FADE_OUT) {
      alpha = (SPLASH_DURATION - splashTimer) / SPLASH_FADE_OUT;
    }

    ctx.save();
    ctx.globalAlpha = alpha;

    // Black background
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Title
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // "AIFarm" in gold pixel font
    ctx.font = 'bold 18px monospace';
    ctx.fillStyle = '#FFD700';
    ctx.fillText('AIFarm', canvasW / 2, canvasH / 2 - 20);

    // "3.0" subtitle
    ctx.font = '12px monospace';
    ctx.fillStyle = '#FFF';
    ctx.fillText('3.0', canvasW / 2, canvasH / 2);

    // Tagline (pulsing)
    const tagAlpha = Math.sin(tick * 0.06) * 0.3 + 0.7;
    ctx.globalAlpha = alpha * tagAlpha;
    ctx.font = '7px monospace';
    ctx.fillStyle = '#AAA';
    ctx.fillText('The Infinite Horizon', canvasW / 2, canvasH / 2 + 18);

    // Decorative stars
    ctx.globalAlpha = alpha * 0.6;
    ctx.font = '5px monospace';
    ctx.fillStyle = '#FFD700';
    const starCount = 8;
    for (let i = 0; i < starCount; i++) {
      const angle = (tick * 0.01) + (i / starCount) * Math.PI * 2;
      const radius = 40 + Math.sin(tick * 0.03 + i) * 5;
      const sx = canvasW / 2 + Math.cos(angle) * radius;
      const sy = canvasH / 2 + Math.sin(angle) * radius * 0.5;
      ctx.fillText('\u{2B50}', sx, sy);
    }

    ctx.restore();
  }

  function isSplashActive() { return splashActive; }

  // ===== Credits =====

  function toggleCredits() {
    creditsOpen = !creditsOpen;
    if (creditsOpen) scrollY = 0;
  }

  function isOpen() { return creditsOpen; }

  function handleKey(key) {
    if (!creditsOpen) return false;
    if (key === 'Escape' || key === 'F1') {
      creditsOpen = false;
      return true;
    }
    if (key === 'ArrowDown' || key === 's' || key === 'S') {
      scrollY += 20;
      return true;
    }
    if (key === 'ArrowUp' || key === 'w' || key === 'W') {
      scrollY = Math.max(0, scrollY - 20);
      return true;
    }
    return false;
  }

  function drawCredits(ctx, canvasW, canvasH, tick) {
    if (!creditsOpen) return;

    ctx.save();

    // Dark overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Scroll content
    ctx.textAlign = 'center';
    let y = 30 - scrollY;

    for (const item of CREDITS) {
      if (y > canvasH + 20) break;

      switch (item.type) {
        case 'title':
          ctx.font = 'bold 16px monospace';
          ctx.fillStyle = '#FFD700';
          ctx.fillText(item.text, canvasW / 2, y);
          y += 24;
          break;

        case 'subtitle':
          ctx.font = '10px monospace';
          ctx.fillStyle = '#AAA';
          ctx.fillText(item.text, canvasW / 2, y);
          y += 16;
          break;

        case 'header':
          ctx.font = 'bold 9px monospace';
          ctx.fillStyle = '#4FC3F7';
          ctx.fillText('--- ' + item.text + ' ---', canvasW / 2, y);
          y += 16;
          break;

        case 'role':
          ctx.font = 'bold 8px monospace';
          ctx.fillStyle = '#FFF';
          ctx.fillText(item.name, canvasW / 2, y);
          y += 12;
          ctx.font = '7px monospace';
          ctx.fillStyle = '#888';
          ctx.fillText(item.role, canvasW / 2, y);
          y += 14;
          break;

        case 'entry':
          ctx.font = '7px monospace';
          ctx.fillStyle = '#CCC';
          ctx.fillText(item.text, canvasW / 2, y);
          y += 12;
          break;

        case 'footer':
          ctx.font = '8px monospace';
          ctx.fillStyle = '#FFD700';
          ctx.fillText(item.text, canvasW / 2, y);
          y += 14;
          break;

        case 'spacer':
          y += 16;
          break;
      }
    }

    // Navigation hint
    ctx.font = '6px monospace';
    ctx.fillStyle = '#666';
    ctx.fillText('[W/S] Scroll  [ESC] Close', canvasW / 2, canvasH - 8);

    ctx.restore();

    // Auto-scroll
    scrollY += SCROLL_SPEED;
  }

  // ===== Save Export =====

  function exportSave() {
    if (window.buddy && window.buddy.exportSave) {
      window.buddy.exportSave();
      if (typeof IsoEffects !== 'undefined') {
        const pp = (typeof Player !== 'undefined') ? Player.getPosition() : { x: 10, y: 10 };
        IsoEffects.spawnText(pp.x, pp.y - 1, '\u{1F4BE} Save exported!',
          { color: '#4FC3F7', life: 60, rise: 0.3 });
      }
    } else {
      if (typeof IsoEffects !== 'undefined') {
        const pp = (typeof Player !== 'undefined') ? Player.getPosition() : { x: 10, y: 10 };
        IsoEffects.spawnText(pp.x, pp.y - 1, 'Export not available', { color: '#FF6666', life: 60, rise: 0.3 });
      }
    }
  }

  // ===== Update & Draw =====

  function update(tick) {
    updateSplash();
  }

  function draw(ctx, canvasW, canvasH, tick) {
    // Splash on top of everything at startup
    drawSplash(ctx, canvasW, canvasH, tick);
    // Credits overlay
    drawCredits(ctx, canvasW, canvasH, tick);
  }

  return {
    update,
    draw,
    toggleCredits,
    isOpen,
    handleKey,
    exportSave,
    isSplashActive,
  };
})();
