'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createCompletionHost } = require('../owl/completion-host.cjs');

// These fakes exercise host behaviour without starting Electron, reading a
// user's timer store, changing a Space, or displaying a real desktop window.
function fixture(options = {}) {
  let time = 1_700_000_000_000;
  let nextTimerId = 0;
  const timers = new Map();
  const service = new EventEmitter();
  const preferences = { reducedMotion: false };
  service.snapshot = () => ({ preferences: { ...preferences } });
  let serviceCloses = 0;
  service.close = () => { serviceCloses++; };
  const ipcMain = new EventEmitter();
  const powerMonitor = new EventEmitter();
  const nativeTheme = new EventEmitter();
  nativeTheme.shouldUseReducedMotion = false;
  const screen = new EventEmitter();
  const primary = { id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 32, width: 1512, height: 894 } };
  const external = { id: 2, bounds: { x: -1920, y: -240, width: 1920, height: 1080 }, workArea: { x: -1920, y: -216, width: 1920, height: 1032 } };
  let displays = [primary, external];
  let cursor = { x: -900, y: 200 };
  screen.getCursorScreenPoint = () => ({ ...cursor });
  screen.getDisplayNearestPoint = point => displays.find(display => point.x >= display.bounds.x && point.x < display.bounds.x + display.bounds.width) || displays[0];
  screen.getPrimaryDisplay = () => displays[0];
  screen.getAllDisplays = () => displays;
  const windows = [];
  class FakeWebContents extends EventEmitter {
    constructor() {
      super();
      this.mainFrame = {};
      this.messages = [];
      this.destroyed = false;
    }
    isDestroyed() { return this.destroyed; }
    send(channel, payload) { this.messages.push({ channel, payload }); }
    setWindowOpenHandler(handler) { this.windowOpenHandler = handler; }
  }
  class FakeWindow extends EventEmitter {
    constructor(config) {
      super();
      this.options = config;
      this.webContents = new FakeWebContents();
      this.destroyed = false;
      this.visible = false;
      this.calls = [];
      this.bounds = { x: config.x, y: config.y, width: config.width, height: config.height };
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    getBounds() { return { ...this.bounds }; }
    setBounds(bounds) { this.bounds = { ...bounds }; this.calls.push(['setBounds', { ...bounds }]); }
    setAlwaysOnTop(...args) { this.calls.push(['setAlwaysOnTop', ...args]); }
    setVisibleOnAllWorkspaces(...args) { this.calls.push(['setVisibleOnAllWorkspaces', ...args]); }
    setIgnoreMouseEvents(...args) { this.calls.push(['setIgnoreMouseEvents', ...args]); }
    setFocusable(...args) { this.calls.push(['setFocusable', ...args]); }
    setSkipTaskbar(...args) { this.calls.push(['setSkipTaskbar', ...args]); }
    loadFile(file) { this.file = file; return Promise.resolve(); }
    showInactive() { this.visible = true; this.calls.push(['showInactive']); }
    show() { this.visible = true; this.calls.push(['show']); }
    focus() { this.calls.push(['focus']); }
    hide() { this.visible = false; this.calls.push(['hide']); }
    close() { this.destroy(); }
    destroy() {
      if (this.destroyed) return;
      this.visible = false;
      this.destroyed = true;
      this.webContents.destroyed = true;
      this.emit('closed');
    }
  }
  const setTimer = (callback, delay) => {
    const id = { value: ++nextTimerId, unref() {} };
    timers.set(id, { callback, at: time + delay });
    return id;
  };
  const clearTimer = id => timers.delete(id);
  const advance = ms => {
    const end = time + ms;
    while (true) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      time = due[1].at;
      due[1].callback();
    }
    time = end;
  };
  const manager = createCompletionHost({ service, BrowserWindow: FakeWindow, ipcMain, screen, powerMonitor, nativeTheme, setTimer, clearTimer, now: () => time, ...options });
  const completed = (id = 'session-1', overrides = {}) => ({ sessionId: id, kind: 'focus', focusMs: 60_000, durationMs: 60_000, startedAt: time - 60_000, completedAt: time, ...overrides });
  const emitCompleted = (id, overrides) => service.emit('completed', completed(id, overrides));
  const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
  const send = (channel, value, win = windows.at(-1), frame = win?.webContents.mainFrame) => ipcMain.emit(channel, { sender: win?.webContents, senderFrame: frame }, value);
  const messages = () => windows.flatMap(win => win.webContents.messages).filter(message => message.channel === 'owl:completion-show');
  return { manager, service, preferences, ipcMain, powerMonitor, nativeTheme, screen, windows, timers, primary, external, completed, emitCompleted, advance, settle, send, messages,
    get serviceCloses() { return serviceCloses; },
    setCursor(point) { cursor = point; },
    setDisplays(value) { displays = value; },
  };
}

test('natural completion creates a transparent non-focusing overlay on the cursor display and dismisses after eight seconds', async t => {
  const f = fixture({ random: () => 0 });
  t.after(() => f.manager.dispose());
  assert.equal(f.windows.length, 0);
  f.emitCompleted();
  await f.settle();
  assert.equal(f.windows.length, 1);
  const win = f.windows[0];
  assert.equal(win.options.transparent, true);
  assert.equal(win.options.focusable, false);
  assert.equal(win.options.frame, false);
  assert.equal(win.options.show, false);
  assert.deepEqual(win.bounds, f.external.workArea);
  assert(win.calls.some(call => call[0] === 'setAlwaysOnTop' && call[1] === true));
  assert(win.calls.some(call => call[0] === 'setVisibleOnAllWorkspaces' && call[1] === true && call[2]?.visibleOnFullScreen === true));
  assert(win.calls.some(call => call[0] === 'setIgnoreMouseEvents' && call[1] === true));
  assert.equal(win.calls.filter(call => call[0] === 'showInactive').length, 1);
  assert.equal(win.calls.filter(call => ['show', 'focus'].includes(call[0])).length, 0);
  const payload = f.messages()[0].payload;
  assert.equal(payload.sessionId, 'session-1');
  assert.equal(payload.durationMs, 60_000);
  assert.equal(payload.kind, 'meteors');
  assert.equal(payload.reducedMotion, false);
  f.advance(7_999);
  assert.equal(win.visible, true);
  f.advance(1);
  assert.equal(win.visible, false);
  assert.equal(win.destroyed, true);
});

test('duplicate delivery of the same completed round never opens a second window or replays after dismissal', async t => {
  const f = fixture();
  t.after(() => f.manager.dispose());
  f.emitCompleted('same-round');
  f.emitCompleted('same-round');
  await f.settle();
  assert.equal(f.messages().length, 1);
  assert.equal(f.windows.length, 1);
  f.advance(8_000);
  f.emitCompleted('same-round');
  await f.settle();
  assert.equal(f.messages().length, 1);
  assert.equal(f.windows.length, 1);
});

test('break, unfinished, and malformed completion payloads never create a desktop reward', async t => {
  const f = fixture();
  t.after(() => f.manager.dispose());
  const invalid = [null, {}, f.completed('break', { kind: 'break' }), f.completed('empty', { sessionId: '' }),
    f.completed('nan', { focusMs: NaN }), f.completed('infinite', { focusMs: Infinity }),
    f.completed('negative', { focusMs: -1 }), f.completed('too-short', { focusMs: 999, durationMs: 999 }),
    f.completed('too-long', { focusMs: 10_800_001, durationMs: 10_800_001 }),
    f.completed('unfinished', { focusMs: 59_000 }), f.completed('fractional', { focusMs: 60_000.5, durationMs: 60_000.5 })];
  for (const payload of invalid) f.service.emit('completed', payload);
  // Other timer outcomes do not become completion events.
  f.service.emit('change', { lastOutcome: { kind: 'focus', outcome: 'ended' } });
  await f.settle();
  assert.equal(f.windows.length, 0);
  assert.equal(f.messages().length, 0);
});

test('random celebrations use all four supported drawings and never repeat adjacent effects', async t => {
  const choices = [0, 0, 0.5, 0.999, 0.999, 0, 0.5, 0];
  let index = 0;
  const f = fixture({ random: () => choices[index++] });
  t.after(() => f.manager.dispose());
  for (let round = 0; round < choices.length; round++) {
    f.emitCompleted(`random-${round}`);
    await f.settle();
    f.advance(8_000);
  }
  const kinds = f.messages().map(message => message.payload.kind);
  assert.deepEqual(new Set(kinds), new Set(['meteors', 'fireworks', 'ribbons', 'flowers']));
  for (let round = 1; round < kinds.length; round++) assert.notEqual(kinds[round], kinds[round - 1]);
});

test('either the saved reduced-motion preference or system preference suppresses animation', async t => {
  const f = fixture();
  t.after(() => f.manager.dispose());
  f.preferences.reducedMotion = true;
  f.emitCompleted('saved-reduced');
  await f.settle();
  assert.equal(f.messages().at(-1).payload.reducedMotion, true);
  f.advance(8_000);
  f.preferences.reducedMotion = false;
  f.nativeTheme.shouldUseReducedMotion = true;
  f.emitCompleted('system-reduced');
  await f.settle();
  assert.equal(f.messages().at(-1).payload.reducedMotion, true);
});

test('lock, suspension, and inactive login sessions defer one latest reward until all blockers clear', async t => {
  const f = fixture();
  t.after(() => f.manager.dispose());
  f.powerMonitor.emit('lock-screen');
  f.powerMonitor.emit('suspend');
  f.powerMonitor.emit('user-did-resign-active');
  f.emitCompleted('older-pending');
  f.emitCompleted('latest-pending');
  await f.settle();
  assert.equal(f.windows.length, 0);
  assert.equal(f.manager.inspect().pending, 'latest-pending');
  f.powerMonitor.emit('unlock-screen');
  f.powerMonitor.emit('resume');
  await f.settle();
  assert.equal(f.windows.length, 0);
  f.powerMonitor.emit('user-did-become-active');
  await f.settle();
  assert.equal(f.messages().length, 1);
  assert.equal(f.messages()[0].payload.sessionId, 'latest-pending');
  assert.equal(f.messages()[0].payload.deferred, true);
  f.powerMonitor.emit('resume');
  f.powerMonitor.emit('unlock-screen');
  f.powerMonitor.emit('user-did-become-active');
  await f.settle();
  assert.equal(f.messages().length, 1);
});

test('locking during an existing reward stops the visible overlay and its dismissal timer', async t => {
  const f = fixture();
  t.after(() => f.manager.dispose());
  f.emitCompleted('visible-before-lock');
  await f.settle();
  assert.equal(f.manager.inspect().visible, true);
  f.powerMonitor.emit('lock-screen');
  assert.equal(f.manager.inspect().visible, false);
  assert.equal(f.timers.size, 0);
  f.advance(20_000);
  assert.equal(f.manager.inspect().visible, false);
  f.powerMonitor.emit('unlock-screen');
  await f.settle();
  assert.equal(f.messages().length, 1);
  assert.equal(f.windows.length, 1);
});

test('a round finished while the system is already locked waits for unlock even if no lock event was received', async t => {
  const f = fixture();
  t.after(() => f.manager.dispose());
  let idleState = 'locked';
  f.powerMonitor.getSystemIdleState = () => idleState;
  f.emitCompleted('initially-locked');
  await f.settle();
  assert.equal(f.windows.length, 0);
  assert.equal(f.manager.inspect().pending, 'initially-locked');
  idleState = 'active';
  f.powerMonitor.emit('unlock-screen');
  await f.settle();
  assert.equal(f.messages().length, 1);
  assert.equal(f.messages()[0].payload.deferred, true);
});

test('locking while the page loads prevents its stale window from showing and defers one new presentation', async t => {
  const f = fixture();
  t.after(() => f.manager.dispose());
  f.emitCompleted('load-lock-race');
  const oldWindow = f.windows[0];
  f.powerMonitor.emit('lock-screen');
  await f.settle();
  assert.equal(oldWindow.destroyed, true);
  assert.equal(oldWindow.calls.filter(call => call[0] === 'showInactive').length, 0);
  assert.equal(f.messages().length, 0);
  f.powerMonitor.emit('unlock-screen');
  await f.settle();
  assert.equal(f.messages().length, 1);
  assert.equal(f.messages()[0].payload.sessionId, 'load-lock-race');
  assert.equal(f.messages()[0].payload.deferred, true);
  f.powerMonitor.emit('unlock-screen');
  await f.settle();
  assert.equal(f.messages().length, 1);
});

test('queued rounds cannot make the next visible reward repeat the last actually shown drawing', async t => {
  const f = fixture({ random: () => 0 });
  t.after(() => f.manager.dispose());
  f.emitCompleted('shown-round');
  await f.settle();
  f.powerMonitor.emit('lock-screen');
  f.emitCompleted('superseded-queued-round');
  f.emitCompleted('latest-queued-round');
  f.powerMonitor.emit('unlock-screen');
  await f.settle();
  const shown = f.messages().map(message => message.payload);
  assert.equal(shown.length, 2);
  assert.equal(shown[1].sessionId, 'latest-queued-round');
  assert.notEqual(shown[1].kind, shown[0].kind);
});

test('three-hour completion preserves the actual duration instead of using the legacy two-hour notification cap', async t => {
  const f = fixture();
  t.after(() => f.manager.dispose());
  f.emitCompleted('three-hours', { focusMs: 10_800_000, durationMs: 10_800_000 });
  await f.settle();
  assert.equal(f.messages()[0].payload.durationMs, 10_800_000);
});

test('only the overlay main frame may dismiss the reward or enable its close-button hit area', async t => {
  const f = fixture();
  t.after(() => f.manager.dispose());
  f.emitCompleted('ipc-round');
  await f.settle();
  const win = f.windows[0];
  const originalCalls = win.calls.length;
  f.ipcMain.emit('owl:completion-interactive', { sender: {}, senderFrame: win.webContents.mainFrame }, true);
  f.send('owl:completion-interactive', true, win, {});
  f.ipcMain.emit('owl:completion-interactive', { sender: win.webContents }, true);
  f.send('owl:completion-interactive', 'true');
  f.ipcMain.emit('owl:completion-dismiss', { sender: {}, senderFrame: win.webContents.mainFrame });
  f.send('owl:completion-dismiss', undefined, win, {});
  assert.equal(win.calls.length, originalCalls);
  assert.equal(win.visible, true);
  f.send('owl:completion-interactive', true);
  assert(win.calls.some(call => call[0] === 'setIgnoreMouseEvents' && call[1] === false));
  f.send('owl:completion-interactive', false);
  assert.equal(win.calls.at(-1)[0], 'setIgnoreMouseEvents');
  assert.equal(win.calls.at(-1)[1], true);
  f.send('owl:completion-dismiss');
  assert.equal(win.destroyed, true);
  assert.equal(f.timers.size, 0);
});

test('the overlay blocks navigation and new windows and cleans up after a renderer crash', async t => {
  const f = fixture();
  t.after(() => f.manager.dispose());
  f.emitCompleted('renderer-round');
  await f.settle();
  const win = f.windows[0];
  assert.deepEqual(win.webContents.windowOpenHandler({ url: 'https://example.invalid/' }), { action: 'deny' });
  let prevented = false;
  win.webContents.emit('will-navigate', { preventDefault() { prevented = true; } }, 'https://example.invalid/');
  assert.equal(prevented, true);
  win.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(win.destroyed, true);
  assert.equal(f.timers.size, 0);
});

test('display geometry changes and unplugging a display move a visible overlay into a valid work area', async t => {
  const f = fixture();
  t.after(() => f.manager.dispose());
  f.emitCompleted('display-round');
  await f.settle();
  const win = f.windows[0];
  const resized = { ...f.external, workArea: { x: -1600, y: -100, width: 1600, height: 900 }, bounds: { x: -1600, y: -124, width: 1600, height: 950 } };
  f.setDisplays([f.primary, resized]);
  f.screen.emit('display-metrics-changed', {}, resized, ['bounds', 'workArea']);
  assert.deepEqual(win.bounds, resized.workArea);
  f.setDisplays([f.primary]);
  f.setCursor({ x: 100, y: 100 });
  f.screen.emit('display-removed', {}, resized);
  assert.deepEqual(win.bounds, f.primary.workArea);
  assert.equal(f.manager.inspect().displayId, 1);
});

test('dispose cancels pending work, removes its listeners, and destroys the overlay without closing the timer service', async () => {
  const f = fixture();
  const foreignCompletion = () => {};
  const foreignDismiss = () => {};
  f.service.on('completed', foreignCompletion);
  f.ipcMain.on('owl:completion-dismiss', foreignDismiss);
  f.emitCompleted('dispose-round');
  await f.settle();
  const win = f.windows[0];
  f.manager.dispose();
  f.manager.dispose();
  assert.equal(win.destroyed, true);
  assert.equal(f.timers.size, 0);
  assert.equal(f.serviceCloses, 0);
  assert.deepEqual(f.service.listeners('completed'), [foreignCompletion]);
  assert.deepEqual(f.ipcMain.listeners('owl:completion-dismiss'), [foreignDismiss]);
  assert.equal(f.ipcMain.listenerCount('owl:completion-interactive'), 0);
  for (const channel of ['lock-screen', 'unlock-screen', 'suspend', 'resume', 'user-did-resign-active', 'user-did-become-active']) assert.equal(f.powerMonitor.listenerCount(channel), 0);
  for (const channel of ['display-added', 'display-removed', 'display-metrics-changed']) assert.equal(f.screen.listenerCount(channel), 0);
  f.emitCompleted('after-dispose');
  f.powerMonitor.emit('unlock-screen');
  f.advance(20_000);
  await f.settle();
  assert.equal(f.windows.length, 1);
});

test('disposing while the page is loading prevents its late resolution from showing a stale overlay', async () => {
  const f = fixture();
  f.emitCompleted('load-race');
  const win = f.windows[0];
  f.manager.dispose();
  await f.settle();
  assert.equal(win.destroyed, true);
  assert.equal(win.visible, false);
  assert.equal(win.calls.filter(call => call[0] === 'showInactive').length, 0);
  assert.equal(f.timers.size, 0);
});
