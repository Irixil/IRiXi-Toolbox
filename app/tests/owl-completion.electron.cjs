'use strict';

// Run with Electron, never Node. No production userData, clipboard, foreground
// inspection, or desktop capture is used. Visible mode is an explicit opt-in.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { app, BrowserWindow, WebContentsView, ipcMain, powerMonitor, screen, nativeTheme } = require('electron');

const source = path.resolve(process.env.TEST_APP_SOURCE || path.join(__dirname, '..'));
const { createOwlHost } = require(path.join(source, 'owl/owl-host.cjs'));
const visible = process.env.IRIXI_COMPLETION_VISIBLE === '1';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'irixi-completion-profile-'));
const evidenceDir = process.env.IRIXI_COMPLETION_EVIDENCE_DIR
  ? path.resolve(process.env.IRIXI_COMPLETION_EVIDENCE_DIR)
  : fs.mkdtempSync(path.join(os.tmpdir(), 'irixi-completion-evidence-'));
fs.mkdirSync(evidenceDir, { recursive: true });
app.setPath('userData', profile);
app.setName('IRiXi completion isolated test');

const result = { method: 'real Electron + production host, service, file store, UI; fresh temporary profile',
  source, sourceAsarSha256: source.endsWith('.asar') ? createHash('sha256').update(require('original-fs').readFileSync(source)).digest('hex') : null,
  visibleMode: visible, desktopPixelsCaptured: false, productionUserDataUsed: false,
  checks: [], naturalCompletion: null, syntheticVisualFixtures: [], frames: [], startedAt: new Date().toISOString() };
const overlayRecords = [];
const naturalEvents = [];
const syntheticIds = new Set();
let host;
let mainWindow;
let requestNumber = 0;
let manualReplay = false;
const nativeProbe = () => process.env.IRIXI_COMPLETION_WINDOW_PROBE
  ? JSON.parse(require('node:child_process').execFileSync(process.env.IRIXI_COMPLETION_WINDOW_PROBE, [String(process.pid)], { encoding: 'utf8' })) : null;

class ObservedWindow extends BrowserWindow {
  constructor(options) {
    super(options);
    if (options.title !== '专注完成') return;
    const record = { window: this, options, showInactiveCalls: 0, messages: [], createdAt: Date.now(), destroyedAt: null };
    overlayRecords.push(record);
    const send = this.webContents.send.bind(this.webContents);
    this.webContents.send = (channel, ...args) => {
      if (channel === 'owl:completion-show') record.messages.push({ ...args[0], receivedAt: Date.now() });
      return send(channel, ...args);
    };
    const realShowInactive = this.showInactive.bind(this);
    this.showInactive = () => {
      record.showInactiveCalls++;
      record.requestedShownAt = Date.now();
      if (visible) realShowInactive();
    };
    this.once('closed', () => { record.destroyedAt = Date.now(); });
  }
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, message, timeout = 6_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(35);
  }
  throw new Error(message);
}
function check(name, details = {}) { result.checks.push({ name, passed: true, ...details }); }
function command(value) { return host.service.dispatch({ ...value, requestId: `electron-test-${++requestNumber}` }); }
function snapshotDisk() { return JSON.parse(fs.readFileSync(path.join(profile, 'owl', 'focus-state.json'), 'utf8')); }
async function readUi(win) {
  return win.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('#completion-card');
    const box = card.getBoundingClientRect();
    return { title: document.querySelector('#completion-title').textContent,
      visible: !card.hidden && card.classList.contains('visible'),
      opacity: getComputedStyle(card).opacity, kind: document.body.dataset.kind,
      reducedMotion: document.body.classList.contains('reduced-motion'),
      particleCount: document.querySelectorAll('.particle, .launch, .gift').length,
      activeAnimations: document.getAnimations().filter(animation => animation.playState === 'running').length,
      viewport: { width: innerWidth, height: innerHeight },
      cardBounds: { x: box.x, y: box.y, width: box.width, height: box.height },
      font: getComputedStyle(document.querySelector('#completion-title')).fontFamily };
  })()`);
}
async function waitForCard(win, title) {
  // A capture of this webContents only can wake a hidden renderer for its first
  // rAF. stayHidden prevents the test default from displaying desktop windows.
  await win.webContents.capturePage(undefined, { stayHidden: !visible, stayAwake: true });
  await waitFor(async () => {
    const ui = await readUi(win);
    return ui.visible && Number(ui.opacity) > .98 && ui.title === title;
  }, `completion card did not render: ${title}`);
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
  const ui = await readUi(win);
  assert(ui.cardBounds.x >= 0 && ui.cardBounds.y >= 0);
  assert(ui.cardBounds.x + ui.cardBounds.width <= ui.viewport.width + 1);
  assert(ui.cardBounds.y + ui.cardBounds.height <= ui.viewport.height + 1);
  return ui;
}
async function capture(win, group, count = 9, interval = 140) {
  const start = Date.now();
  for (let frame = 0; frame < count; frame++) {
    if (frame) await delay(interval);
    const image = await win.webContents.capturePage(undefined, { stayHidden: !visible, stayAwake: true });
    assert(!image.isEmpty(), 'capture must contain the actual renderer pixels');
    const filename = `${group}-${String(frame).padStart(3, '0')}.png`;
    fs.writeFileSync(path.join(evidenceDir, filename), image.toPNG());
    result.frames.push({ group, filename, milliseconds: Date.now() - start, dimensions: image.getSize(),
      source: 'overlay webContents.capturePage', desktopPixels: false });
  }
}
async function main() {
  await app.whenReady();
  app.dock?.hide();
  let expanded = true;
  host = createOwlHost({ app, BrowserWindow: ObservedWindow, WebContentsView, ipcMain, powerMonitor, screen, nativeTheme,
    dataDir: path.join(profile, 'owl'), readForeground: async () => null, isExpanded: () => expanded,
    showCard: () => { throw new Error('completion must not expand the toolbox'); },
    showHome: () => { throw new Error('completion must not navigate the toolbox'); } });
  host.service.on('completed', value => { if (!manualReplay && !syntheticIds.has(value.sessionId)) naturalEvents.push(value); });
  mainWindow = new BrowserWindow({ width: 600, height: 740, show: false, focusable: false, frame: false,
    webPreferences: { preload: path.join(source, 'owl/src/preload.cjs'), contextIsolation: true,
      sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
  host.attach(mainWindow);
  host.register(mainWindow);
  await mainWindow.loadFile(path.join(source, 'owl/ui/index.html'), { query: { mode: 'widget' } });
  const embedded = await mainWindow.webContents.executeJavaScript(`window.owlFocus.embedBounds({ visible: true, x: 20, y: 20, width: 540, height: 680 })`);
  assert.equal(embedded, true);
  assert(host.getEmbedded());
  await waitFor(() => !host.getEmbedded().webContents.isLoading(), 'production embedded UI did not load');
  expanded = false;
  host.hideEmbedded();
  assert.equal(host.getEmbedded().getVisible(), false);
  assert.equal(mainWindow.isVisible(), false);
  check('production embedded module hidden and host collapsed before timer starts');

  const focusBefore = BrowserWindow.getFocusedWindow()?.id ?? null;
  const nativeBefore = nativeProbe();
  command({ type: 'start', seconds: 3, task: '隔离测试：后台自然完成' });
  await waitFor(() => naturalEvents.length === 1 && overlayRecords[0]?.showInactiveCalls === 1,
    'real heartbeat did not produce exactly one natural completion overlay');
  const event = naturalEvents[0];
  assert.equal(event.kind, 'focus');
  assert.equal(event.focusMs, 3_000);
  assert.equal(event.durationMs, 3_000);
  assert.equal(host.service.snapshot().active, null);
  assert.equal(host.service.snapshot().totalFocusMs, 3_000);
  assert.equal(snapshotDisk().lastOutcome.sessionId, event.sessionId);
  assert.equal(snapshotDisk().lastOutcome.focusMs, 3_000);
  const record = overlayRecords[0];
  const win = record.window;
  assert.equal(win.isFocusable(), false);
  assert.equal(win.isFocused(), false);
  assert.equal(BrowserWindow.getFocusedWindow()?.id ?? null, focusBefore);
  assert.equal(mainWindow.isVisible(), false);
  assert.equal(host.getEmbedded().getVisible(), false);
  assert.equal(record.messages.length, 1);
  if (visible) assert.equal(win.isVisible(), true);
  else assert.equal(win.isVisible(), false);
  const naturalUi = await waitForCard(win, '刚刚成功专注 3 秒');
  const originalAvatar = await win.webContents.executeJavaScript(`(async () => {
    const avatar = document.querySelector('#owl-avatar');
    const image = new Image(); image.src = new URL('../ui/assets/motion-v7/head-poses.png', location.href).href;
    await image.decode();
    const reference = document.createElement('canvas'); reference.width = avatar.width; reference.height = avatar.height;
    reference.getContext('2d').drawImage(image, 0, 0, 418, 418, 0, 0, reference.width, reference.height);
    const actual = avatar.getContext('2d').getImageData(0, 0, avatar.width, avatar.height).data;
    const expected = reference.getContext('2d').getImageData(0, 0, reference.width, reference.height).data;
    const bounds = avatar.getBoundingClientRect();
    return { source: avatar.dataset.source, sourceWidth: image.naturalWidth, sourceHeight: image.naturalHeight,
      originalPixelsMatch: actual.every((value, index) => value === expected[index]),
      aspectRatio: bounds.width / bounds.height, filter: getComputedStyle(avatar).filter };
  })()`);
  assert.equal(originalAvatar.originalPixelsMatch, true);
  assert.equal(originalAvatar.source, 'head-poses.png:0,0,418,418');
  assert.equal(originalAvatar.sourceWidth, 1254); assert.equal(originalAvatar.sourceHeight, 1254);
  assert.equal(originalAvatar.aspectRatio, 1); assert.equal(originalAvatar.filter, 'none');
  result.originalAvatar = originalAvatar;
  check('completion avatar pixels exactly match a uniform crop of the existing production owl atlas, with original proportions and no filter');
  if (visible && nativeBefore) {
    const after = nativeProbe();
    assert.equal(after.frontPid, nativeBefore.frontPid, 'desktop overlay must preserve the foreground application');
    assert(after.ownWindows.some(row => row.onScreen && row.alpha > 0 && row.layer > 0), 'native compositor must report the own overlay on screen above ordinary app windows');
    result.nativeWindowProof = { before: nativeBefore, after, foregroundPreserved: true, ownOverlayOnScreen: true };
    check('native compositor confirms desktop overlay onscreen and foreground application PID unchanged');
  }
  result.naturalCompletion = { event, ui: naturalUi, diskOutcome: snapshotDisk().lastOutcome,
    showInactiveCalls: record.showInactiveCalls, overlayFocusable: win.isFocusable(), overlayFocused: win.isFocused(),
    hostVisible: mainWindow.isVisible(), embeddedVisible: host.getEmbedded().getVisible(), focusBefore,
    focusAfter: BrowserWindow.getFocusedWindow()?.id ?? null, displayBounds: win.getBounds(),
    systemReducedMotion: nativeTheme.shouldUseReducedMotion };
  check('three-second production heartbeat naturally completes, persists, and renders exact duration without focusing or opening toolbox');
  await capture(win, 'natural-completion', 12, 140);
  host.service.tick();
  assert.equal(naturalEvents.length, 1);
  manualReplay = true;
  host.service.emit('completed', event);
  manualReplay = false;
  assert.equal(overlayRecords.length, 1);
  assert.equal(record.messages.length, 1);
  await waitFor(() => win.isDestroyed(), 'overlay did not auto-dismiss after eight seconds', 9_000);
  const dismissalMs = record.destroyedAt - record.requestedShownAt;
  assert(dismissalMs >= 7_900 && dismissalMs < 9_500, `unexpected dismissal time: ${dismissalMs}`);
  check('natural completion is shown once and automatically destroyed after eight seconds', { dismissalMs });

  if (process.env.IRIXI_COMPLETION_NATURAL_ONLY === '1') {
    result.finishedAt = new Date().toISOString(); result.passed = true; return;
  }

  command({ type: 'start', seconds: 20, task: '隔离测试：提前换轮' });
  const earlyId = host.service.snapshot().active.id;
  await delay(140);
  command({ type: 'start-next', sessionId: earlyId, seconds: 20, task: '隔离测试：替换后的轮次' });
  assert.equal(host.service.snapshot().lastOutcome.outcome, 'ended');
  assert.equal(naturalEvents.length, 1);
  command({ type: 'end', sessionId: host.service.snapshot().active.id });
  assert.equal(overlayRecords.length, 1);
  check('early replacement and manual end do not celebrate or claim a natural completion');

  command({ type: 'break', seconds: 1 });
  await waitFor(() => !host.service.snapshot().active, 'break did not naturally finish');
  assert.equal(host.service.snapshot().lastOutcome.kind, 'break');
  assert.equal(host.service.snapshot().lastOutcome.outcome, 'completed');
  assert.equal(naturalEvents.length, 1);
  assert.equal(overlayRecords.length, 1);
  assert.equal(host.service.snapshot().creditedMinutes, 0);
  check('natural break completion never emits a focus celebration or duplicate earned minutes');

  // Explicitly synthetic presentation fixtures below are separate from the
  // genuine heartbeat result above. They never write a completed focus round.
  command({ type: 'preferences', reducedMotion: true });
  const diskBeforeFixtures = fs.readFileSync(path.join(profile, 'owl', 'focus-state.json'));
  const fixtureId = `synthetic-visual-${randomUUID()}`;
  syntheticIds.add(fixtureId);
  host.service.emit('completed', { sessionId: fixtureId, kind: 'focus', focusMs: 65_000, durationMs: 65_000,
    startedAt: Date.now() - 65_000, completedAt: Date.now() });
  await waitFor(() => overlayRecords[1]?.showInactiveCalls === 1, 'synthetic reduced-motion visual fixture did not render');
  const visualWindow = overlayRecords[1].window;
  const reducedUi = await waitForCard(visualWindow, '刚刚成功专注 1 分钟 5 秒');
  assert.equal(reducedUi.reducedMotion, true);
  assert.equal(reducedUi.particleCount, 0);
  assert.equal(reducedUi.activeAnimations, 0);
  await capture(visualWindow, 'synthetic-reduced-motion', 1);
  result.syntheticVisualFixtures.push({ id: fixtureId, purpose: '65-second duration formatting + saved reduced motion', ui: reducedUi });
  check('saved reduced motion displays exact minute-and-second text with no particles or running animation');

  // Emulation changes only this isolated renderer's CSS preference so all four
  // drawings can be previewed even on a Mac with reduced motion enabled.
  visualWindow.webContents.debugger.attach('1.3');
  await visualWindow.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  for (const kind of ['meteors', 'fireworks', 'ribbons', 'flowers']) {
    const payload = { sessionId: `${fixtureId}-${kind}`, kind, durationMs: 65_000,
      completedAt: Date.now(), deferred: false, reducedMotion: false };
    visualWindow.webContents.send('owl:completion-show', payload);
    await waitForCard(visualWindow, '刚刚成功专注 1 分钟 5 秒');
    await waitFor(async () => (await readUi(visualWindow)).particleCount > 0, `${kind} particles did not render`, 1_000);
    const ui = await readUi(visualWindow);
    assert.equal(ui.kind, kind);
    assert.equal(ui.reducedMotion, false);
    result.syntheticVisualFixtures.push({ id: payload.sessionId, purpose: 'production renderer visual fixture only', payload, ui,
      mediaEmulation: 'renderer-local prefers-reduced-motion: no-preference' });
    await capture(visualWindow, `synthetic-${kind}`, 7, 140);
  }
  assert.equal(fs.readFileSync(path.join(profile, 'owl', 'focus-state.json')).equals(diskBeforeFixtures), true,
    'presentation fixtures must not change real file-backed timer state');
  check('four actual renderer effects captured with synthetic visual fixtures; timer data remains byte-identical');
  await visualWindow.webContents.executeJavaScript("document.querySelector('#dismiss').click()");
  await waitFor(() => visualWindow.isDestroyed(), 'real renderer close button did not dismiss through checked IPC');
  check('real close button dismisses overlay through the production isolated preload and IPC');
  result.finishedAt = new Date().toISOString();
  result.passed = true;
}

const watchdog = setTimeout(() => {
  result.passed = false;
  result.error = '35-second integration watchdog exceeded';
  fs.writeFileSync(path.join(evidenceDir, 'electron-evidence.json'), JSON.stringify(result, null, 2));
  console.error(result.error);
  app.exit(1);
}, 35_000);

main().then(() => {
  console.log(JSON.stringify({ passed: true, checks: result.checks.length, capturedFrames: result.frames.length,
    visibleMode: visible, evidenceDir, source }, null, 2));
}).catch(error => {
  result.passed = false;
  result.error = error.stack;
  console.error(error.stack);
  process.exitCode = 1;
}).finally(() => {
  clearTimeout(watchdog);
  try { host?.dispose(); } catch (error) { result.cleanupError = error.message; process.exitCode = 1; }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
  fs.writeFileSync(path.join(evidenceDir, 'electron-evidence.json'), JSON.stringify(result, null, 2));
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(process.exitCode || 0);
});
