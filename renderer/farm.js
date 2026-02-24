// Farm renderer — draws crops, animals, buildings, energy meter.
// Depends on Scene.PX being available globally.
const Farm = (() => {
  const PX = 3; // must match Scene.PX

  // Farm layout (logical Y coordinates)
  const FENCE_Y = 50;
  const FIELD_Y = 53;
  const FIELD_H = 16;  // fields span Y 53-68
  const PASTURE_Y = 69;
  const PASTURE_H = 10; // pasture Y 69-78
  const TOWN_Y = 79;
  const TOWN_H = 15;   // town Y 79-93
  const BOTTOM_Y = 94;

  let farmState = null;
  let usageState = null;

  function setState(s) { farmState = s; }
  function getState() { return farmState; }
  function setUsage(s) { usageState = s; }
  function getUsage() { return usageState; }

  function px(ctx, x, y, c) { ctx.fillStyle = c; ctx.fillRect(x * PX, y * PX, PX, PX); }
  function rect(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x * PX, y * PX, w * PX, h * PX); }

  // ===== Main entry =====

  function drawFarm(ctx, canvasW, tick) {
    if (!farmState) return;
    const logW = Math.ceil(canvasW / PX);

    drawFarmGround(ctx, logW);
    drawFence(ctx, logW, tick);
    drawCropFields(ctx, logW, tick);
    drawAnimals(ctx, logW, tick);
    drawBuildings(ctx, logW, tick);
    drawEnergyMeter(ctx, logW);
    drawUsagePanel(ctx, logW, tick);
  }

  // ===== Ground layers =====

  function drawFarmGround(ctx, logW) {
    // Farm soil (field area)
    rect(ctx, 0, FIELD_Y, logW, FIELD_H, '#8B6B3E');
    rect(ctx, 0, FIELD_Y, logW, 1, '#9A7A4E');

    // Pasture grass
    rect(ctx, 0, PASTURE_Y, logW, PASTURE_H, '#5AAE45');
    rect(ctx, 0, PASTURE_Y, logW, 1, '#6ABD55');

    // Town ground
    rect(ctx, 0, TOWN_Y, logW, TOWN_H, '#C8B898');
    rect(ctx, 0, TOWN_Y, logW, 1, '#D4C4A8');
    // Cobblestone hints
    for (let x = 2; x < logW; x += 5) {
      px(ctx, x, TOWN_Y + 2, '#B8A888');
      px(ctx, x + 2, TOWN_Y + 4, '#B8A888');
    }

    // Bottom fade (deep grass → transparent)
    rect(ctx, 0, BOTTOM_Y, logW, 4, '#4EA040');
    rect(ctx, 0, BOTTOM_Y + 4, logW, 4, '#3E9030');
    rect(ctx, 0, BOTTOM_Y + 8, logW, 4, '#2E8020');
    // Transparent fade
    for (let row = 0; row < 12; row++) {
      const alpha = Math.max(0, 1 - row / 12);
      ctx.fillStyle = `rgba(30, 100, 20, ${alpha.toFixed(2)})`;
      ctx.fillRect(0, (BOTTOM_Y + 12 + row) * PX, logW * PX, PX);
    }
  }

  // ===== Fence =====

  function drawFence(ctx, logW, tick) {
    const y = FENCE_Y;
    // Posts
    for (let x = 3; x < logW - 2; x += 8) {
      rect(ctx, x, y - 1, 1, 3, '#8B6B3E');
      px(ctx, x, y - 2, '#9A7A4E');
    }
    // Rails
    rect(ctx, 0, y, logW, 1, '#C8A060');
    rect(ctx, 0, y + 1, logW, 1, '#B89050');
  }

  // ===== Crop fields =====

  function drawCropFields(ctx, logW, tick) {
    if (!farmState || !farmState.plots) return;

    const totalPlots = farmState.plots.length;
    const plotW = 7;   // logical width per plot
    const plotGap = 2;
    const totalFieldW = totalPlots * (plotW + plotGap);
    const startX = Math.max(2, Math.floor((logW - totalFieldW) / 2));

    for (let i = 0; i < totalPlots; i++) {
      const plot = farmState.plots[i];
      const px_x = startX + i * (plotW + plotGap);
      const px_y = FIELD_Y + 2;

      // Check if plot is unlocked
      const unlocked = isPlotUnlocked(i);
      if (!unlocked) {
        // Locked plot: darker soil with X
        rect(ctx, px_x, px_y, plotW, FIELD_H - 4, '#6B5030');
        px(ctx, px_x + 3, px_y + 5, '#555');
        continue;
      }

      // Tilled soil
      rect(ctx, px_x, px_y, plotW, FIELD_H - 4, '#7A5C32');
      // Soil rows
      for (let row = 0; row < 3; row++) {
        rect(ctx, px_x, px_y + row * 4, plotW, 1, '#6B4E28');
      }

      if (plot.crop && plot.stage > 0) {
        drawCropSprite(ctx, px_x + 1, px_y + 1, plot.crop, plot.stage, tick);
      }
    }
  }

  function isPlotUnlocked(index) {
    if (!farmState) return false;
    const energy = farmState.totalEnergy || 0;
    // Plot unlock thresholds: 0-2 at 0, 3-5 at 500, 6-8 at 1800, 9-11 at 5000
    if (index < 3) return energy >= 50;  // need first milestone
    if (index < 6) return energy >= 500;
    if (index < 9) return energy >= 1800;
    return energy >= 5000;
  }

  // ===== Crop sprites (5 stages per type) =====

  function drawCropSprite(ctx, x, y, type, stage, tick) {
    const flash = stage >= 4 && (tick % 20) < 10;

    switch (type) {
      case 'carrot':    drawCarrot(ctx, x, y, stage, flash); break;
      case 'sunflower': drawSunflower(ctx, x, y, stage, flash, tick); break;
      case 'watermelon':drawWatermelon(ctx, x, y, stage, flash); break;
      case 'tomato':    drawTomato(ctx, x, y, stage, flash); break;
      case 'corn':      drawCorn(ctx, x, y, stage, flash); break;
      case 'pumpkin':   drawPumpkin(ctx, x, y, stage, flash); break;
    }
  }

  function drawCarrot(ctx, x, y, stage, flash) {
    if (stage === 1) {
      // Seed: small dot
      px(ctx, x + 2, y + 8, '#8B6B3E');
    } else if (stage === 2) {
      // Sprout: small green
      px(ctx, x + 2, y + 7, '#5AAE45');
      px(ctx, x + 2, y + 8, '#5AAE45');
    } else if (stage === 3) {
      // Growing: green top, orange hint
      px(ctx, x + 1, y + 5, '#5AAE45');
      px(ctx, x + 2, y + 4, '#6ABD55');
      px(ctx, x + 3, y + 5, '#5AAE45');
      px(ctx, x + 2, y + 6, '#FF8C00');
      px(ctx, x + 2, y + 7, '#FF8C00');
    } else {
      // Mature
      const c = flash ? '#FFF' : '#FF8C00';
      px(ctx, x + 1, y + 3, '#5AAE45');
      px(ctx, x + 2, y + 2, '#6ABD55');
      px(ctx, x + 3, y + 3, '#5AAE45');
      rect(ctx, x + 1, y + 4, 3, 1, '#68C456');
      px(ctx, x + 2, y + 5, c);
      px(ctx, x + 2, y + 6, c);
      px(ctx, x + 2, y + 7, c);
      px(ctx, x + 2, y + 8, '#E07800');
    }
  }

  function drawSunflower(ctx, x, y, stage, flash, tick) {
    if (stage === 1) {
      px(ctx, x + 2, y + 8, '#8B6B3E');
    } else if (stage === 2) {
      px(ctx, x + 2, y + 7, '#5AAE45');
      px(ctx, x + 2, y + 8, '#3E9030');
    } else if (stage === 3) {
      // Stem + bud
      px(ctx, x + 2, y + 5, '#5AAE45');
      px(ctx, x + 2, y + 6, '#5AAE45');
      px(ctx, x + 2, y + 7, '#3E9030');
      px(ctx, x + 2, y + 4, '#C8A000');
    } else {
      // Full sunflower
      const c = flash ? '#FFF' : '#FFD700';
      const sw = Math.sin(tick * 0.03) > 0 ? 0 : 1;
      px(ctx, x + 2, y + 6, '#5AAE45');
      px(ctx, x + 2, y + 7, '#3E9030');
      px(ctx, x + 1 + sw, y + 5, '#5AAE45');
      // Flower head
      px(ctx, x + 1, y + 2, c);
      px(ctx, x + 2, y + 1, c);
      px(ctx, x + 3, y + 2, c);
      px(ctx, x + 2, y + 3, '#8B6800');
      px(ctx, x + 2, y + 2, '#8B6800');
      px(ctx, x + 1, y + 3, c);
      px(ctx, x + 3, y + 3, c);
    }
  }

  function drawWatermelon(ctx, x, y, stage, flash) {
    if (stage === 1) {
      px(ctx, x + 2, y + 8, '#8B6B3E');
    } else if (stage === 2) {
      px(ctx, x + 2, y + 7, '#5AAE45');
      px(ctx, x + 1, y + 8, '#3E9030');
    } else if (stage === 3) {
      px(ctx, x + 1, y + 6, '#5AAE45');
      px(ctx, x + 2, y + 6, '#5AAE45');
      px(ctx, x + 3, y + 7, '#3E9030');
      px(ctx, x + 2, y + 7, '#2E8B57');
    } else {
      const c = flash ? '#FFF' : '#2E8B57';
      // Vine
      px(ctx, x, y + 5, '#5AAE45');
      px(ctx, x + 1, y + 5, '#3E9030');
      // Melon body
      rect(ctx, x + 1, y + 6, 3, 2, c);
      px(ctx, x + 2, y + 8, c);
      // Stripes
      if (!flash) {
        px(ctx, x + 2, y + 6, '#1E6B3E');
        px(ctx, x + 2, y + 7, '#1E6B3E');
      }
    }
  }

  function drawTomato(ctx, x, y, stage, flash) {
    if (stage === 1) {
      px(ctx, x + 2, y + 8, '#8B6B3E');
    } else if (stage === 2) {
      px(ctx, x + 2, y + 7, '#5AAE45');
      px(ctx, x + 2, y + 8, '#3E9030');
    } else if (stage === 3) {
      px(ctx, x + 2, y + 5, '#5AAE45');
      px(ctx, x + 2, y + 6, '#5AAE45');
      px(ctx, x + 2, y + 7, '#3E9030');
      px(ctx, x + 2, y + 4, '#88CC44');
    } else {
      const c = flash ? '#FFF' : '#FF4444';
      px(ctx, x + 2, y + 5, '#5AAE45');
      px(ctx, x + 2, y + 6, '#3E9030');
      // Tomato fruit
      px(ctx, x + 2, y + 3, '#5AAE45');
      px(ctx, x + 1, y + 4, c);
      px(ctx, x + 2, y + 4, c);
      px(ctx, x + 3, y + 4, c);
      px(ctx, x + 1, y + 5, c);
      px(ctx, x + 3, y + 5, c);
    }
  }

  function drawCorn(ctx, x, y, stage, flash) {
    if (stage === 1) {
      px(ctx, x + 2, y + 8, '#8B6B3E');
    } else if (stage === 2) {
      px(ctx, x + 2, y + 7, '#5AAE45');
      px(ctx, x + 2, y + 8, '#5AAE45');
    } else if (stage === 3) {
      px(ctx, x + 2, y + 4, '#5AAE45');
      px(ctx, x + 2, y + 5, '#5AAE45');
      px(ctx, x + 2, y + 6, '#5AAE45');
      px(ctx, x + 2, y + 7, '#3E9030');
      px(ctx, x + 1, y + 5, '#5AAE45');
    } else {
      const c = flash ? '#FFF' : '#F0E68C';
      px(ctx, x + 2, y + 6, '#5AAE45');
      px(ctx, x + 2, y + 7, '#3E9030');
      px(ctx, x + 1, y + 4, '#5AAE45');
      px(ctx, x + 3, y + 4, '#5AAE45');
      // Corn cob
      px(ctx, x + 2, y + 2, c);
      px(ctx, x + 2, y + 3, c);
      px(ctx, x + 2, y + 4, c);
      px(ctx, x + 2, y + 5, c);
      px(ctx, x + 1, y + 3, '#C8B060');
      px(ctx, x + 3, y + 3, '#C8B060');
      // Tassel
      px(ctx, x + 2, y + 1, '#C8A040');
    }
  }

  function drawPumpkin(ctx, x, y, stage, flash) {
    if (stage === 1) {
      px(ctx, x + 2, y + 8, '#8B6B3E');
    } else if (stage === 2) {
      px(ctx, x + 2, y + 7, '#5AAE45');
      px(ctx, x + 1, y + 8, '#3E9030');
    } else if (stage === 3) {
      px(ctx, x + 1, y + 6, '#5AAE45');
      px(ctx, x + 2, y + 6, '#5AAE45');
      px(ctx, x + 2, y + 7, '#C85A00');
      px(ctx, x + 1, y + 7, '#C85A00');
    } else {
      const c = flash ? '#FFF' : '#FF7518';
      px(ctx, x + 2, y + 4, '#5AAE45');
      px(ctx, x + 2, y + 5, '#3E9030');
      // Pumpkin body
      px(ctx, x, y + 6, c);
      rect(ctx, x + 1, y + 6, 3, 3, c);
      px(ctx, x + 4, y + 6, c);
      px(ctx, x, y + 7, c);
      px(ctx, x + 4, y + 7, c);
      // Ridges
      if (!flash) {
        px(ctx, x + 2, y + 7, '#E06810');
      }
    }
  }

  // ===== Animals =====

  function drawAnimals(ctx, logW, tick) {
    if (!farmState || !farmState.animals) return;

    const animalTypes = ['chicken', 'cow', 'pig', 'sheep', 'cat', 'dog'];
    let idx = 0;

    for (const type of animalTypes) {
      const info = farmState.animals[type];
      if (!info || !info.unlocked) continue;

      // Movement: slow wander back and forth
      const speed = type === 'dog' ? 0.04 : type === 'cat' ? 0.01 : 0.02;
      const range = logW - 15;
      const baseX = info.homeX || (10 + idx * 15);
      const wander = Math.sin(tick * speed + idx * 2.5) * 15;
      const ax = Math.max(3, Math.min(range, baseX + wander));
      const ay = PASTURE_Y + 2 + (idx % 3) * 3;
      const frame = ((tick / 20) | 0) % 2;

      drawAnimalSprite(ctx, Math.floor(ax), ay, type, frame, tick);
      idx++;
    }
  }

  function drawAnimalSprite(ctx, x, y, type, frame, tick) {
    switch (type) {
      case 'chicken': drawChicken(ctx, x, y, frame); break;
      case 'cow':     drawCow(ctx, x, y, frame); break;
      case 'pig':     drawPig(ctx, x, y, frame); break;
      case 'sheep':   drawSheep(ctx, x, y, frame); break;
      case 'cat':     drawCat(ctx, x, y, frame, tick); break;
      case 'dog':     drawDog(ctx, x, y, frame, tick); break;
    }
  }

  function drawChicken(ctx, x, y, frame) {
    // Body
    rect(ctx, x + 1, y + 1, 3, 2, '#FFF8E0');
    px(ctx, x + 2, y, '#FFF8E0');
    // Head
    px(ctx, x + 3, y, '#FFF8E0');
    px(ctx, x + 4, y, '#FF4444'); // comb
    px(ctx, x + 4, y + 1, '#FF8800'); // beak
    // Eye
    px(ctx, x + 3, y + 1, '#222');
    // Legs
    if (frame === 0) {
      px(ctx, x + 1, y + 3, '#FF8800');
      px(ctx, x + 3, y + 3, '#FF8800');
    } else {
      px(ctx, x + 2, y + 3, '#FF8800');
    }
    // Tail
    px(ctx, x, y, '#E0D0A0');
  }

  function drawCow(ctx, x, y, frame) {
    // Body
    rect(ctx, x + 1, y + 1, 5, 3, '#FFF');
    // Spots
    px(ctx, x + 2, y + 1, '#333');
    px(ctx, x + 4, y + 2, '#333');
    // Head
    rect(ctx, x + 5, y, 2, 2, '#FFF');
    px(ctx, x + 6, y, '#FFB0B0'); // nose
    px(ctx, x + 6, y + 1, '#222'); // eye
    // Horns
    px(ctx, x + 5, y - 1, '#C8A060');
    // Legs
    const legOff = frame === 0 ? 0 : 1;
    px(ctx, x + 1 + legOff, y + 4, '#CCC');
    px(ctx, x + 3, y + 4, '#CCC');
    px(ctx, x + 5 - legOff, y + 4, '#CCC');
    // Tail
    px(ctx, x, y + 1, '#CCC');
    px(ctx, x, y + 2, '#222');
  }

  function drawPig(ctx, x, y, frame) {
    // Body (pink)
    rect(ctx, x + 1, y + 1, 4, 2, '#FFB0B0');
    px(ctx, x + 2, y, '#FFB0B0');
    px(ctx, x + 3, y, '#FFB0B0');
    // Snout
    px(ctx, x + 5, y + 1, '#FF8888');
    px(ctx, x + 5, y + 2, '#FF8888');
    // Eye
    px(ctx, x + 4, y + 1, '#222');
    // Ears
    px(ctx, x + 3, y - 1 + (frame === 1 ? 1 : 0), '#FF9090');
    // Legs
    px(ctx, x + 1, y + 3, '#FF9090');
    px(ctx, x + 4, y + 3, '#FF9090');
    // Curly tail
    px(ctx, x, y, '#FF9090');
  }

  function drawSheep(ctx, x, y, frame) {
    // Fluffy body
    rect(ctx, x + 1, y, 4, 3, '#F0F0F0');
    px(ctx, x, y + 1, '#F0F0F0');
    px(ctx, x + 5, y + 1, '#F0F0F0');
    // Head
    px(ctx, x + 5, y, '#333');
    px(ctx, x + 5, y + 2, '#333');
    // Eye
    px(ctx, x + 5, y + 1, '#FFF');
    // Legs
    if (frame === 0) {
      px(ctx, x + 1, y + 3, '#333');
      px(ctx, x + 4, y + 3, '#333');
    } else {
      px(ctx, x + 2, y + 3, '#333');
      px(ctx, x + 3, y + 3, '#333');
    }
    // Eating grass
    if (frame === 1) {
      px(ctx, x + 5, y + 3, '#5AAE45');
    }
  }

  function drawCat(ctx, x, y, frame, tick) {
    const sitting = Math.sin(tick * 0.005) > 0.5;
    // Body
    rect(ctx, x + 1, y + 1, 2, 2, '#FF8C44');
    // Head
    px(ctx, x + 1, y, '#FF8C44');
    px(ctx, x + 2, y, '#FF8C44');
    // Ears
    px(ctx, x, y - 1, '#FF8C44');
    px(ctx, x + 3, y - 1, '#FF8C44');
    // Eyes
    px(ctx, x + 1, y + 1, frame === 0 ? '#2E2' : '#222');
    // Tail
    if (sitting) {
      px(ctx, x + 3, y + 2, '#FF8C44');
      px(ctx, x + 3, y + 3, '#FF8C44');
    } else {
      px(ctx, x - 1, y + 1, '#FF8C44');
    }
    // Legs
    px(ctx, x + 1, y + 3, '#E07830');
    px(ctx, x + 2, y + 3, '#E07830');
  }

  function drawDog(ctx, x, y, frame, tick) {
    // Body
    rect(ctx, x + 1, y + 1, 3, 2, '#C88850');
    // Head
    rect(ctx, x + 3, y, 2, 2, '#C88850');
    // Ear
    px(ctx, x + 4, y - 1, '#A06838');
    // Eye
    px(ctx, x + 4, y + 1, '#222');
    // Nose
    px(ctx, x + 4, y, '#333');
    // Legs (running animation)
    if (frame === 0) {
      px(ctx, x + 1, y + 3, '#A06838');
      px(ctx, x + 3, y + 3, '#A06838');
    } else {
      px(ctx, x + 2, y + 3, '#A06838');
      px(ctx, x + 3, y + 3, '#A06838');
    }
    // Tail (wagging)
    const tailUp = ((tick / 8) | 0) % 2 === 0;
    px(ctx, x, y + (tailUp ? 0 : 1), '#C88850');
  }

  // ===== Buildings =====

  function drawBuildings(ctx, logW, tick) {
    if (!farmState || !farmState.buildings) return;

    const buildingDefs = [
      { id: 'well',     draw: drawWell },
      { id: 'barn',     draw: drawBarn },
      { id: 'windmill', draw: drawWindmill },
      { id: 'market',   draw: drawMarket },
      { id: 'clock',    draw: drawClock },
      { id: 'townhall', draw: drawTownhall },
      { id: 'statue',   draw: drawStatue },
    ];

    let bx = 3;
    for (const bld of buildingDefs) {
      if (!farmState.buildings[bld.id]) continue;
      bld.draw(ctx, bx, TOWN_Y + 1, tick);
      bx += getBuildingWidth(bld.id) + 3;
      if (bx >= logW - 5) break;
    }
  }

  function getBuildingWidth(id) {
    const widths = { well: 6, barn: 14, windmill: 10, market: 12, clock: 8, townhall: 16, statue: 5 };
    return widths[id] || 8;
  }

  function drawWell(ctx, x, y, tick) {
    // Stone base
    rect(ctx, x, y + 3, 6, 4, '#A0A0A0');
    rect(ctx, x + 1, y + 3, 4, 3, '#707070');
    // Roof supports
    px(ctx, x, y + 1, '#8B6B3E');
    px(ctx, x + 5, y + 1, '#8B6B3E');
    // Roof
    rect(ctx, x - 1, y, 8, 1, '#B04838');
    rect(ctx, x, y + 1, 6, 1, '#C05848');
    // Water sparkle
    if ((tick / 15 | 0) % 3 === 0) {
      px(ctx, x + 3, y + 4, '#88C0E0');
    }
  }

  function drawBarn(ctx, x, y, tick) {
    // Main body
    rect(ctx, x, y + 3, 14, 7, '#C04040');
    rect(ctx, x + 1, y + 3, 12, 6, '#D05050');
    // Roof
    rect(ctx, x - 1, y, 16, 1, '#8B4040');
    rect(ctx, x, y + 1, 14, 1, '#A04848');
    rect(ctx, x, y + 2, 14, 1, '#B05050');
    // Door
    rect(ctx, x + 5, y + 6, 4, 4, '#8B6B3E');
    px(ctx, x + 8, y + 8, '#FFD700');
    // Windows
    rect(ctx, x + 2, y + 5, 2, 2, '#FFE0A0');
    rect(ctx, x + 10, y + 5, 2, 2, '#FFE0A0');
    // X on door
    px(ctx, x + 5, y + 6, '#6B4E28');
    px(ctx, x + 8, y + 6, '#6B4E28');
    px(ctx, x + 6, y + 7, '#6B4E28');
    px(ctx, x + 7, y + 7, '#6B4E28');
  }

  function drawWindmill(ctx, x, y, tick) {
    // Tower
    rect(ctx, x + 3, y + 4, 4, 8, '#E8D8C0');
    rect(ctx, x + 4, y + 4, 2, 7, '#D8C8B0');
    // Roof
    rect(ctx, x + 2, y + 2, 6, 2, '#B04838');
    px(ctx, x + 4, y + 1, '#B04838');
    px(ctx, x + 5, y + 1, '#B04838');
    // Door
    rect(ctx, x + 4, y + 9, 2, 3, '#8B6B3E');
    // Window
    px(ctx, x + 5, y + 6, '#88C0E0');
    // Rotating blades
    const angle = (tick * 0.03) % (Math.PI * 2);
    const cx = (x + 5) * PX;
    const cy = (y + 4) * PX;
    const bladeLen = 5 * PX;

    ctx.save();
    ctx.strokeStyle = '#8B6B3E';
    ctx.lineWidth = PX;
    for (let i = 0; i < 4; i++) {
      const a = angle + i * Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * bladeLen, cy + Math.sin(a) * bladeLen);
      ctx.stroke();
      // Blade tip
      const tipX = cx + Math.cos(a) * bladeLen;
      const tipY = cy + Math.sin(a) * bladeLen;
      const perpA = a + Math.PI / 2;
      ctx.fillStyle = '#C8A060';
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX + Math.cos(perpA) * PX * 2, tipY + Math.sin(perpA) * PX * 2);
      ctx.lineTo(cx + Math.cos(a) * bladeLen * 0.6, cy + Math.sin(a) * bladeLen * 0.6);
      ctx.fill();
    }
    ctx.restore();
    // Hub
    rect(ctx, x + 4, y + 3, 2, 2, '#666');
  }

  function drawMarket(ctx, x, y, tick) {
    // Counter
    rect(ctx, x, y + 4, 12, 3, '#C8A060');
    rect(ctx, x + 1, y + 4, 10, 1, '#D4B070');
    // Legs
    px(ctx, x, y + 7, '#8B6B3E');
    px(ctx, x + 11, y + 7, '#8B6B3E');
    // Awning (colorful stripes)
    const colors = ['#E84040', '#FFD700', '#4A90D9', '#E84040'];
    for (let i = 0; i < 12; i++) {
      px(ctx, x + i, y + 2, colors[i % colors.length]);
      px(ctx, x + i, y + 3, colors[(i + 1) % colors.length]);
    }
    // Poles
    px(ctx, x, y + 1, '#8B6B3E');
    px(ctx, x + 11, y + 1, '#8B6B3E');
    rect(ctx, x - 1, y + 1, 1, 3, '#8B6B3E');
    rect(ctx, x + 12, y + 1, 1, 3, '#8B6B3E');
    // Goods on counter
    px(ctx, x + 2, y + 3, '#FF8C00');  // carrot
    px(ctx, x + 5, y + 3, '#FF4444');  // tomato
    px(ctx, x + 8, y + 3, '#2E8B57');  // melon
  }

  function drawClock(ctx, x, y, tick) {
    // Tower body
    rect(ctx, x + 1, y + 3, 6, 11, '#D0C0A0');
    rect(ctx, x + 2, y + 3, 4, 10, '#C8B898');
    // Roof
    rect(ctx, x, y, 8, 1, '#8B4040');
    rect(ctx, x + 1, y + 1, 6, 1, '#A05050');
    rect(ctx, x + 2, y + 2, 4, 1, '#B06060');
    // Clock face
    rect(ctx, x + 2, y + 4, 4, 4, '#FFF8E0');
    // Clock border
    px(ctx, x + 2, y + 4, '#666');
    px(ctx, x + 5, y + 4, '#666');
    px(ctx, x + 2, y + 7, '#666');
    px(ctx, x + 5, y + 7, '#666');
    // Clock hands (animated)
    const hourAngle = (tick * 0.002) % (Math.PI * 2);
    const minAngle = (tick * 0.02) % (Math.PI * 2);
    const ccx = (x + 4) * PX;
    const ccy = (y + 6) * PX;
    ctx.save();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ccx, ccy);
    ctx.lineTo(ccx + Math.cos(hourAngle) * PX * 1.2, ccy + Math.sin(hourAngle) * PX * 1.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ccx, ccy);
    ctx.lineTo(ccx + Math.cos(minAngle) * PX * 1.8, ccy + Math.sin(minAngle) * PX * 1.8);
    ctx.stroke();
    ctx.restore();
    // Door
    rect(ctx, x + 3, y + 10, 2, 4, '#8B6B3E');
    // Window
    px(ctx, x + 3, y + 9, '#88C0E0');
    px(ctx, x + 4, y + 9, '#88C0E0');
  }

  function drawTownhall(ctx, x, y, tick) {
    // Main body
    rect(ctx, x, y + 4, 16, 7, '#E8D8C8');
    rect(ctx, x + 1, y + 4, 14, 6, '#D8C8B8');
    // Columns
    for (let col = 0; col < 4; col++) {
      const cx_col = x + 2 + col * 4;
      rect(ctx, cx_col, y + 4, 1, 7, '#C8B8A8');
    }
    // Roof / pediment
    rect(ctx, x - 1, y + 2, 18, 2, '#A08878');
    rect(ctx, x + 2, y + 1, 12, 1, '#B09888');
    rect(ctx, x + 4, y, 8, 1, '#C0A898');
    // Door
    rect(ctx, x + 6, y + 7, 4, 4, '#8B6B3E');
    px(ctx, x + 9, y + 9, '#FFD700');
    // Windows
    rect(ctx, x + 2, y + 6, 3, 2, '#88C0E0');
    rect(ctx, x + 11, y + 6, 3, 2, '#88C0E0');
    // Flag on roof
    const flagWave = ((tick / 10) | 0) % 2;
    px(ctx, x + 8, y - 3, '#8B6B3E');
    px(ctx, x + 8, y - 2, '#8B6B3E');
    px(ctx, x + 8, y - 1, '#8B6B3E');
    rect(ctx, x + 9 + flagWave, y - 3, 3, 2, '#E84040');
  }

  function drawStatue(ctx, x, y, tick) {
    // Pedestal
    rect(ctx, x, y + 5, 5, 3, '#A0A0A0');
    rect(ctx, x + 1, y + 5, 3, 2, '#888');
    // Figure
    px(ctx, x + 2, y + 1, '#C0C0C0'); // head
    rect(ctx, x + 1, y + 2, 3, 3, '#B0B0B0'); // body
    px(ctx, x, y + 3, '#B0B0B0'); // arm left
    px(ctx, x + 4, y + 2, '#B0B0B0'); // arm right (raised)
    px(ctx, x + 4, y + 1, '#B0B0B0');
    // Star/sparkle particles
    if ((tick / 8 | 0) % 4 === 0) {
      px(ctx, x + 4, y, '#FFD700');
    }
    if ((tick / 8 | 0) % 4 === 2) {
      px(ctx, x - 1, y + 2, '#FFD700');
    }
    if ((tick / 8 | 0) % 4 === 1) {
      px(ctx, x + 2, y - 1, '#FFF8D0');
    }
  }

  // ===== Energy meter (top-right) =====

  function drawEnergyMeter(ctx, logW) {
    if (!farmState) return;
    const energy = farmState.totalEnergy || 0;

    // Position: top-right corner
    const meterX = (logW - 28) * PX;
    const meterY = 2 * PX;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(meterX, meterY, 26 * PX, 5 * PX);

    // Lightning bolt icon
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 10px monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('\u26A1', meterX + 3, meterY + 7);

    // Energy number
    ctx.fillStyle = '#FFF';
    ctx.font = 'bold 9px monospace';
    ctx.fillText(formatEnergy(energy), meterX + 14, meterY + 7);

    // Milestone label if any
    if (farmState.milestoneReached > 0) {
      const ms = findMilestone(farmState.milestoneReached);
      if (ms) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.fillRect(meterX, meterY + 5 * PX, 26 * PX, 4 * PX);
        ctx.fillStyle = '#FFD700';
        ctx.font = '8px monospace';
        ctx.fillText(ms.emoji + ' ' + ms.label, meterX + 3, meterY + 5 * PX + 6);
      }
    }
  }

  function formatEnergy(n) {
    if (n >= 10000) return (n / 1000).toFixed(1) + 'k';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }

  function findMilestone(energy) {
    // Find highest matching milestone
    const milestones = [
      { energy: 50,    emoji: '\u{1F955}', label: 'Seed' },
      { energy: 150,   emoji: '\u{1F33B}', label: 'Gardener' },
      { energy: 300,   emoji: '\u{1F349}', label: 'Green' },
      { energy: 500,   emoji: '\u{1F345}', label: 'Farmer' },
      { energy: 800,   emoji: '\u{1F33D}', label: 'Rancher' },
      { energy: 1200,  emoji: '\u{1F383}', label: 'Pioneer' },
      { energy: 1800,  emoji: '\u{1F411}', label: 'Villager' },
      { energy: 2500,  emoji: '\u{1F431}', label: 'Founder' },
      { energy: 3500,  emoji: '\u{1F415}', label: 'Thriving' },
      { energy: 5000,  emoji: '\u{1F550}', label: 'Prosper' },
      { energy: 7500,  emoji: '\u{1F3DB}', label: 'Metro' },
      { energy: 10000, emoji: '\u{1F5FF}', label: 'Legend' },
    ];
    let best = null;
    for (const m of milestones) {
      if (energy >= m.energy) best = m;
    }
    return best;
  }

  // ===== Usage panel (left side, below village) =====

  function drawUsagePanel(ctx, logW, tick) {
    if (!usageState) return;

    const panelX = 2 * PX;
    const panelY = FENCE_Y * PX + 4;
    const panelW = 42 * PX;
    const lineH = 11;

    // Semi-transparent background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(panelX, panelY, panelW, lineH * 5 + 8);

    // Border accent
    ctx.fillStyle = '#E8734A';
    ctx.fillRect(panelX, panelY, 2, lineH * 5 + 8);

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    let y = panelY + 7;

    // Title
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 9px monospace';
    ctx.fillText('\u{1F4CA} Usage', panelX + 5, y);
    y += lineH;

    // Today's output tokens
    ctx.fillStyle = '#88DDFF';
    ctx.font = '8px monospace';
    ctx.fillText('Today: ' + fmtTokens(usageState.todayTokens) + ' tok', panelX + 5, y);
    y += lineH;

    // Today's messages
    ctx.fillStyle = '#AADDAA';
    ctx.fillText('Msgs:  ' + fmtNum(usageState.todayMessages), panelX + 5, y);
    y += lineH;

    // Total all-time output
    ctx.fillStyle = '#CCBBFF';
    ctx.fillText('Total: ' + fmtTokens(usageState.totalOutput) + ' out', panelX + 5, y);
    y += lineH;

    // Live session
    ctx.fillStyle = '#FFB080';
    const liveIcon = ((tick / 30) | 0) % 2 === 0 ? '\u{25CF}' : '\u{25CB}';
    ctx.fillText(liveIcon + ' Live: ' + fmtTokens(usageState.liveOutput), panelX + 5, y);
  }

  function fmtTokens(n) {
    if (!n || n === 0) return '0';
    if (n >= 1000000000) return (n / 1000000000).toFixed(1) + 'B';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }

  function fmtNum(n) {
    if (!n || n === 0) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }

  return { drawFarm, setState, getState, setUsage, getUsage };
})();
