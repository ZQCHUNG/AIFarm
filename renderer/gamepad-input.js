/**
 * gamepad-input.js — HTML5 Gamepad API integration (Sprint 27 P1).
 *
 * Provides unified input from gamepad controllers:
 *   - Left stick / D-Pad → 8-direction movement (mapped to WASD keys object)
 *   - A button (index 0) → [E] interact/confirm
 *   - B button (index 1) → [Escape] cancel/menu
 *   - X button (index 2) → [C] collection
 *   - Y button (index 3) → [Q] quest board
 *   - RT / R2 (index 7) → Shift (sprint)
 *   - Start (index 9) → [T] trade/token sim
 *
 * Auto-detects gamepad connection, polls every frame.
 * When gamepad input is detected, switches UI prompts to gamepad icons.
 */
const GamepadInput = (() => {
  let gamepadIndex = -1;
  let isActive = false;       // true when last input was from gamepad
  let wasActive = false;      // track changes for prompt switching

  // Deadzone for analog sticks
  const DEADZONE = 0.25;

  // Button state tracking (for edge detection: pressed this frame)
  const prevButtons = new Array(16).fill(false);

  // Virtual key state (merged with keyboard by renderer)
  const virtualKeys = {};

  // Button press events queue (consumed each frame)
  let buttonPresses = []; // [keyName, ...]

  // ===== Connection =====

  function init() {
    window.addEventListener('gamepadconnected', (e) => {
      gamepadIndex = e.gamepad.index;
      console.log(`[Gamepad] Connected: ${e.gamepad.id}`);
    });

    window.addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad.index === gamepadIndex) {
        gamepadIndex = -1;
        isActive = false;
        clearVirtualKeys();
        console.log('[Gamepad] Disconnected');
      }
    });
  }

  // ===== Polling (call each frame) =====

  function poll() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = gamepads[gamepadIndex];
    if (!gp) {
      clearVirtualKeys();
      return;
    }

    // Clear previous virtual keys
    clearVirtualKeys();
    buttonPresses = [];

    let anyInput = false;

    // --- Left stick / D-Pad → movement ---
    const lx = gp.axes[0] || 0;
    const ly = gp.axes[1] || 0;

    // D-Pad buttons (indices 12-15)
    const dUp    = gp.buttons[12] && gp.buttons[12].pressed;
    const dDown  = gp.buttons[13] && gp.buttons[13].pressed;
    const dLeft  = gp.buttons[14] && gp.buttons[14].pressed;
    const dRight = gp.buttons[15] && gp.buttons[15].pressed;

    // Combine stick + dpad
    let moveX = 0, moveY = 0;
    if (Math.abs(lx) > DEADZONE) moveX = lx > 0 ? 1 : -1;
    if (Math.abs(ly) > DEADZONE) moveY = ly > 0 ? 1 : -1;
    if (dLeft) moveX = -1;
    if (dRight) moveX = 1;
    if (dUp) moveY = -1;
    if (dDown) moveY = 1;

    if (moveX < 0) { virtualKeys['a'] = true; virtualKeys['A'] = true; virtualKeys['ArrowLeft'] = true; anyInput = true; }
    if (moveX > 0) { virtualKeys['d'] = true; virtualKeys['D'] = true; virtualKeys['ArrowRight'] = true; anyInput = true; }
    if (moveY < 0) { virtualKeys['w'] = true; virtualKeys['W'] = true; virtualKeys['ArrowUp'] = true; anyInput = true; }
    if (moveY > 0) { virtualKeys['s'] = true; virtualKeys['S'] = true; virtualKeys['ArrowDown'] = true; anyInput = true; }

    // --- Buttons ---
    const buttons = gp.buttons;

    // A (index 0) → E (interact)
    if (buttons[0] && buttons[0].pressed) {
      anyInput = true;
      if (!prevButtons[0]) buttonPresses.push('e');
    }

    // B (index 1) → Escape
    if (buttons[1] && buttons[1].pressed) {
      anyInput = true;
      if (!prevButtons[1]) buttonPresses.push('Escape');
    }

    // X (index 2) → C (collection)
    if (buttons[2] && buttons[2].pressed) {
      anyInput = true;
      if (!prevButtons[2]) buttonPresses.push('c');
    }

    // Y (index 3) → Q (quest board)
    if (buttons[3] && buttons[3].pressed) {
      anyInput = true;
      if (!prevButtons[3]) buttonPresses.push('q');
    }

    // RT / R2 (index 7) → Shift (sprint)
    if (buttons[7] && buttons[7].pressed) {
      virtualKeys['Shift'] = true;
      anyInput = true;
    }

    // Start (index 9) → T (trade)
    if (buttons[9] && buttons[9].pressed) {
      anyInput = true;
      if (!prevButtons[9]) buttonPresses.push('t');
    }

    // Update previous button state
    for (let i = 0; i < 16; i++) {
      prevButtons[i] = buttons[i] ? buttons[i].pressed : false;
    }

    // Track gamepad activity
    wasActive = isActive;
    if (anyInput) isActive = true;
  }

  function clearVirtualKeys() {
    for (const k of Object.keys(virtualKeys)) {
      delete virtualKeys[k];
    }
  }

  // ===== Public API =====

  /** Get virtual key state (merge with keyboard keys object). */
  function getKeys() { return virtualKeys; }

  /** Pop button press events (edge-triggered, for menu navigation). */
  function popPresses() {
    const p = buttonPresses.splice(0);
    return p;
  }

  /** True if gamepad is the active input device (for prompt icon switching). */
  function isGamepadActive() { return isActive; }

  /** True if a gamepad is connected. */
  function isConnected() { return gamepadIndex >= 0; }

  /** Call when keyboard input is detected to switch back to keyboard prompts. */
  function onKeyboardInput() {
    isActive = false;
  }

  /**
   * Get the display label for a key action.
   * Returns gamepad button name if gamepad is active, else keyboard key.
   */
  function getPromptLabel(action) {
    if (!isActive) return null; // use default keyboard labels
    switch (action) {
      case 'interact': return '[A]';
      case 'cancel':   return '[B]';
      case 'collect':  return '[X]';
      case 'quest':    return '[Y]';
      case 'sprint':   return '[RT]';
      case 'trade':    return '[Start]';
      default: return null;
    }
  }

  return {
    init,
    poll,
    getKeys,
    popPresses,
    isGamepadActive,
    isConnected,
    onKeyboardInput,
    getPromptLabel,
  };
})();
