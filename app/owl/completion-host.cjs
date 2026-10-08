'use strict';
const path = require('node:path');

const EFFECTS = Object.freeze(['meteors', 'fireworks', 'ribbons', 'flowers', 'petals', 'paper-stars', 'blooms']);

// A presentation consumer only: never starts a timer, writes focus data or awards items.
function createCompletionHost({ service, BrowserWindow, ipcMain, screen, powerMonitor, nativeTheme,
  setTimer = setTimeout, clearTimer = clearTimeout, displayMs = 8000, random = Math.random }) {
  let win = null, current = null, pending = null, timer = null, disposed = false;
  let locked = false, sleeping = false, inactive = false, lastKind = null, displayId = null;
  const seen = new Set();
  const bindings = [];
  const bind = (emitter, name, listener) => {
    emitter.on(name, listener); bindings.push(() => emitter.removeListener(name, listener));
  };
  const systemLocked = () => {
    try { return powerMonitor.getSystemIdleState(1) === 'locked'; } catch { return false; }
  };
  const blocked = () => locked || sleeping || inactive || systemLocked();
  const owns = event => Boolean(win && !win.isDestroyed() && event?.senderFrame && event?.sender === win.webContents
    && event.senderFrame === win.webContents.mainFrame);

  function dismiss() {
    clearTimer(timer); timer = null; current = null;
    const previous = win; win = null;
    if (previous && !previous.isDestroyed()) previous.destroy();
  }
  function park() {
    if (current && !win?.isVisible()) pending = { ...current, deferred: true };
    dismiss();
  }
  function locate(target) {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    displayId = display.id;
    target.setBounds(display.workArea);
  }
  function flush() {
    if (disposed || !pending || blocked()) return;
    const choices = EFFECTS.filter(kind => kind !== lastKind);
    const index = Math.min(choices.length - 1, Math.max(0, Math.floor(random() * choices.length)));
    const entry = { ...pending, kind: choices[index] }; pending = null; dismiss(); current = entry;
    let target;
    try {
      target = new BrowserWindow({
        width: 800, height: 600, frame: false, transparent: true, backgroundColor: '#00000000',
        show: false, focusable: false, resizable: false, movable: false, minimizable: false,
        maximizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false,
        title: '专注完成', acceptFirstMouse: true,
        webPreferences: { preload: path.join(__dirname, 'celebration-ui/preload.cjs'),
          contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true,
          backgroundThrottling: false },
      });
      win = target; locate(target);
      target.setAlwaysOnTop(true, 'screen-saver');
      target.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
      target.setIgnoreMouseEvents(true, { forward: true });
      target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      target.webContents.on('will-navigate', event => event.preventDefault());
      target.webContents.on('render-process-gone', () => { if (win === target) dismiss(); });
      target.once('closed', () => { if (win === target) { win = null; current = null; clearTimer(timer); timer = null; } });
      Promise.resolve(target.loadFile(path.join(__dirname, 'celebration-ui/index.html'))).then(() => {
        if (disposed || win !== target || current !== entry || target.isDestroyed()) return;
        if (blocked()) { park(); return; }
        target.webContents.send('owl:completion-show', entry);
        target.showInactive();
        lastKind = entry.kind;
        timer = setTimer(dismiss, displayMs);
      }).catch(error => { if (win === target) dismiss(); console.error('专注完成提示未能显示:', error.message); });
    } catch (error) {
      dismiss(); console.error('专注完成提示未能显示:', error.message);
    }
  }
  function completed(value) {
    if (disposed || !value || value.kind !== 'focus' || typeof value.sessionId !== 'string'
      || !value.sessionId || value.sessionId.length > 128 || !Number.isSafeInteger(value.focusMs)
      || value.focusMs < 1000 || value.focusMs > 10800000 || value.focusMs !== value.durationMs
      || !Number.isFinite(value.completedAt) || seen.has(value.sessionId)) return;
    seen.add(value.sessionId);
    if (seen.size > 128) seen.delete(seen.values().next().value);
    pending = { sessionId: value.sessionId, durationMs: value.focusMs,
      completedAt: value.completedAt, deferred: blocked(),
      reducedMotion: Boolean(service.snapshot().preferences?.reducedMotion || nativeTheme?.shouldUseReducedMotion) };
    flush();
  }
  bind(service, 'completed', completed);
  bind(powerMonitor, 'lock-screen', () => { locked = true; park(); });
  bind(powerMonitor, 'unlock-screen', () => { locked = false; flush(); });
  bind(powerMonitor, 'suspend', () => { sleeping = true; park(); });
  bind(powerMonitor, 'resume', () => { sleeping = false; flush(); });
  bind(powerMonitor, 'user-did-resign-active', () => { inactive = true; park(); });
  bind(powerMonitor, 'user-did-become-active', () => { inactive = false; locked = systemLocked(); flush(); });
  const relocate = () => { if (win && !win.isDestroyed()) { try { locate(win); } catch { dismiss(); } } };
  for (const name of ['display-added', 'display-removed', 'display-metrics-changed']) bind(screen, name, relocate);
  const onDismiss = event => { if (owns(event)) dismiss(); };
  const onInteractive = (event, interactive) => {
    if (owns(event) && typeof interactive === 'boolean') win.setIgnoreMouseEvents(!interactive, { forward: true });
  };
  bind(ipcMain, 'owl:completion-dismiss', onDismiss);
  bind(ipcMain, 'owl:completion-interactive', onInteractive);
  return {
    inspect: () => ({ visible: win?.isVisible() ?? false, pending: pending?.sessionId ?? null,
      current: current?.sessionId ?? null, locked, sleeping, inactive,
      kind: current?.kind ?? pending?.kind ?? null, displayId }),
    dispose() { if (disposed) return; disposed = true; pending = null; dismiss(); bindings.splice(0).forEach(off => off()); },
  };
}
module.exports = { createCompletionHost, EFFECTS };
