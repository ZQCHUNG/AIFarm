// Viewport / Camera system — enables scrolling across an expanding farm world.
// Uses logical scrolling: canvas stays fixed size, rendering offsets by camera position.
const Viewport = (() => {
  const PX = 3; // must match Scene.PX

  // Camera state
  let cameraX = 0;       // current camera X (logical pixels, always integer)
  let targetX = 0;       // target camera X for smooth movement
  let worldWidth = 0;    // total world width (logical pixels)
  let viewportWidth = 0; // visible viewport width (logical pixels)

  // Smoothing
  const SMOOTH_FACTOR = 0.08; // lerp speed (lower = smoother)
  const SNAP_THRESHOLD = 0.5; // snap to target if within this distance

  // Debug camera pan
  let debugPanActive = false;
  let debugPanX = 0;
  const DEBUG_PAN_SPEED = 0.3; // logical pixels per tick
  let debugPanDirection = 1;

  // ===== Core API =====

  function init(viewW, worldW) {
    viewportWidth = Math.ceil(viewW / PX);
    worldWidth = worldW || viewportWidth;
    cameraX = 0;
    targetX = 0;
  }

  function setWorldWidth(w) {
    worldWidth = w;
  }

  function setViewportWidth(canvasW) {
    viewportWidth = Math.ceil(canvasW / PX);
  }

  // Move camera target to center on a logical X position
  function centerOn(logicalX) {
    targetX = logicalX - viewportWidth / 2;
    _clampTarget();
  }

  // Directly set camera target X
  function setTarget(x) {
    targetX = x;
    _clampTarget();
  }

  // Nudge camera by delta (for manual panning)
  function pan(deltaLogical) {
    targetX += deltaLogical;
    _clampTarget();
  }

  // Update each tick — smooth interpolation toward target
  function update(tick) {
    if (debugPanActive) {
      _updateDebugPan(tick);
      return;
    }

    const diff = targetX - cameraX;
    if (Math.abs(diff) < SNAP_THRESHOLD) {
      cameraX = targetX;
    } else {
      cameraX += diff * SMOOTH_FACTOR;
    }
    // Always snap to integer to prevent pixel jitter (CTO requirement)
    cameraX = Math.round(cameraX);
  }

  // Apply camera transform to a canvas context
  // Call before drawing world content, restore after
  function applyTransform(ctx) {
    ctx.save();
    ctx.translate(-cameraX * PX, 0);
  }

  function restoreTransform(ctx) {
    ctx.restore();
  }

  // Convert screen X (pixel) to world logical X
  function screenToWorld(screenPx) {
    return Math.floor(screenPx / PX) + cameraX;
  }

  // Convert world logical X to screen X (pixel)
  function worldToScreen(logicalX) {
    return (logicalX - cameraX) * PX;
  }

  // Check if a logical X range is visible
  function isVisible(logicalX, width) {
    const right = logicalX + (width || 0);
    return right >= cameraX && logicalX <= cameraX + viewportWidth;
  }

  // ===== Debug Camera Pan =====

  function toggleDebugPan() {
    debugPanActive = !debugPanActive;
    if (debugPanActive) {
      debugPanX = cameraX;
      debugPanDirection = 1;
    } else {
      // Return to normal camera position
      targetX = cameraX;
    }
    return debugPanActive;
  }

  function _updateDebugPan(tick) {
    debugPanX += DEBUG_PAN_SPEED * debugPanDirection;

    // Bounce at boundaries
    const maxX = Math.max(0, worldWidth - viewportWidth);
    if (debugPanX >= maxX) {
      debugPanX = maxX;
      debugPanDirection = -1;
    } else if (debugPanX <= 0) {
      debugPanX = 0;
      debugPanDirection = 1;
    }

    cameraX = Math.round(debugPanX);
  }

  // ===== Internal =====

  function _clampTarget() {
    const maxX = Math.max(0, worldWidth - viewportWidth);
    targetX = Math.max(0, Math.min(maxX, targetX));
  }

  // ===== Getters =====

  function getCameraX() { return cameraX; }
  function getTargetX() { return targetX; }
  function getWorldWidth() { return worldWidth; }
  function getViewportWidth() { return viewportWidth; }
  function isDebugPan() { return debugPanActive; }

  return {
    init,
    setWorldWidth,
    setViewportWidth,
    centerOn,
    setTarget,
    pan,
    update,
    applyTransform,
    restoreTransform,
    screenToWorld,
    worldToScreen,
    isVisible,
    toggleDebugPan,
    getCameraX,
    getTargetX,
    getWorldWidth,
    getViewportWidth,
    isDebugPan,
  };
})();
