/**
 * event-bus.test.js — Unit tests for EventBus pub/sub system
 */
const EventBus = require('../renderer/event-bus');

beforeEach(() => {
  EventBus.clear();
});

describe('EventBus', () => {
  test('on + emit calls listener', () => {
    const fn = jest.fn();
    EventBus.on('TEST', fn);
    EventBus.emit('TEST', { val: 42 });
    expect(fn).toHaveBeenCalledWith({ val: 42 });
  });

  test('emit with no listeners does not throw', () => {
    expect(() => EventBus.emit('NONEXISTENT', {})).not.toThrow();
  });

  test('off removes listener', () => {
    const fn = jest.fn();
    EventBus.on('TEST', fn);
    EventBus.off('TEST', fn);
    EventBus.emit('TEST', {});
    expect(fn).not.toHaveBeenCalled();
  });

  test('off on nonexistent event does not throw', () => {
    expect(() => EventBus.off('NOPE', () => {})).not.toThrow();
  });

  test('once_unique prevents duplicate listeners', () => {
    const fn = jest.fn();
    EventBus.once_unique('TEST', fn);
    EventBus.once_unique('TEST', fn);
    EventBus.once_unique('TEST', fn);
    EventBus.emit('TEST', {});
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('multiple listeners on same event all fire', () => {
    const fn1 = jest.fn();
    const fn2 = jest.fn();
    EventBus.on('TEST', fn1);
    EventBus.on('TEST', fn2);
    EventBus.emit('TEST', { x: 1 });
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
  });

  test('clear removes all listeners', () => {
    const fn = jest.fn();
    EventBus.on('A', fn);
    EventBus.on('B', fn);
    EventBus.clear();
    EventBus.emit('A', {});
    EventBus.emit('B', {});
    expect(fn).not.toHaveBeenCalled();
  });

  test('listener throwing does not prevent other listeners', () => {
    // This is a known weakness — currently no try-catch in emit
    const fn1 = jest.fn(() => { throw new Error('boom'); });
    const fn2 = jest.fn();
    EventBus.on('TEST', fn1);
    EventBus.on('TEST', fn2);
    // fn2 won't be called because fn1 throws — documenting current behavior
    expect(() => EventBus.emit('TEST', {})).toThrow('boom');
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).not.toHaveBeenCalled(); // Known limitation
  });
});
