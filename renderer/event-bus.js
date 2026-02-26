/**
 * event-bus.js — Simple pub/sub event bus for decoupling game modules.
 *
 * Usage:
 *   EventBus.on('CROP_HARVESTED', (data) => { ... });
 *   EventBus.emit('CROP_HARVESTED', { crop: 'carrot', amount: 1 });
 *   EventBus.off('CROP_HARVESTED', handler);
 */

const EventBus = (() => {
  const listeners = new Map();

  return {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },

    /** Register listener only if not already registered (prevents duplicate listeners on reinit). */
    once_unique(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      const fns = listeners.get(event);
      if (fns.indexOf(fn) === -1) fns.push(fn);
    },

    off(event, fn) {
      const fns = listeners.get(event);
      if (!fns) return;
      const idx = fns.indexOf(fn);
      if (idx !== -1) fns.splice(idx, 1);
    },

    emit(event, data) {
      const fns = listeners.get(event);
      if (!fns) return;
      for (const fn of fns) fn(data);
    },

    clear() {
      listeners.clear();
    },
  };
})();

if (typeof module !== 'undefined') module.exports = EventBus;
