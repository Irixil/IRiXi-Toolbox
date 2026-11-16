// Permission-free integration test: real renderer, Chromium storage and image IPC;
// system clipboard writes are captured in memory, never sent to the user's clipboard.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { app, BrowserWindow, ipcMain, nativeImage, session } = require('electron');
const appRoot = process.env.IRIXI_CLIPBOARD_TEST_APP_ROOT || path.join(__dirname, '..');
const services = require(path.join(appRoot, 'main-services'));

const [profile, phase] = process.argv.slice(2);
assert.ok(profile && ['overflow', 'clear', 'reopen'].includes(phase));
app.setPath('userData', profile);
app.setName('IRiXi Clipboard Retention Test');
const images = path.join(profile, 'clipboard-images');
fs.mkdirSync(images, { recursive: true });
const imagePath = path.join(images, 'clip-favorite.png');
const plainImage = path.join(images, 'clip-ordinary.png');
const png = nativeImage.createFromBitmap(Buffer.from([30, 100, 220, 255]), { width: 1, height: 1 }).toPNG();
const text = '永久收藏测试\n中文、换行与完整内容 ' + '保留'.repeat(200);
const url = 'https://example.com/favorite?keep=complete';
const copies = [];
const handlers = new Map();
const mainSource = fs.readFileSync(path.join(appRoot, 'main.js'), 'utf8');
function sourceBetween(start, end) {
  const a = mainSource.indexOf(start);
  const b = mainSource.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Missing production section: ${start}`);
  return mainSource.slice(a, b);
}
const context = vm.createContext({
  fs, path, Buffer, Blob, nativeImage,
  CLIP_IMAGES_DIR_NAME: 'clipboard-images',
  workspacePath: name => path.join(profile, name),
  workspaceRoot: () => profile,
  ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
  clipboard: {
    writeText: async value => copies.push({ type: 'text', text: value }),
    write: async items => {
      const blob = items[0].payload['image/png'];
      const bytes = Buffer.from(await blob.arrayBuffer());
      assert.equal(nativeImage.createFromBuffer(bytes).isEmpty(), false);
      copies.push({ type: 'image', bytes: bytes.length });
    },
  },
  ClipboardItem: class { constructor(payload) { this.payload = payload; } },
  createClipboardImageFingerprint: services.createClipboardImageFingerprint,
  reduceClipboardObservation: services.reduceClipboardObservation,
  clipObservationState: {},
});
vm.runInContext(sourceBetween('function getClipImagesDir()', 'async function readSystemClipboard('), context);
vm.runInContext(sourceBetween("ipcMain.handle('clipboard:readImage'", 'function waitForCollapsedPanel('), context);
vm.runInContext("ipcMain.handle('clipboard:write', (event, entry) => writeClipboardEntry(entry));", context);
for (const [channel, handler] of handlers) ipcMain.handle(channel, handler);
ipcMain.handle('clipboard:paste', async (event, entry) => ({
  ok: await handlers.get('clipboard:write')(event, entry), pasted: false,
}));
// The rest of the app stays offline and permission-free in this fixture.
const preload = fs.readFileSync(path.join(appRoot, 'preload.js'), 'utf8');
for (const [, channel] of preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)) {
  if (handlers.has(channel) || channel === 'clipboard:paste') continue;
  ipcMain.handle(channel, () => channel === 'workspace:load-data' ? {} : null);
}

async function run() {
  await app.whenReady();
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, done) => done(false));
  const window = new BrowserWindow({ show: false, webPreferences: {
    preload: path.join(appRoot, 'preload.js'),
    contextIsolation: true, nodeIntegration: false, sandbox: true,
  } });
  const evaluate = code => window.webContents.executeJavaScript(code);
  await window.loadFile(path.join(appRoot, 'renderer', 'index.html'));
  if (phase === 'overflow') {
    fs.writeFileSync(imagePath, png);
    fs.writeFileSync(plainImage, png);
    await evaluate(`(async () => {
      await addClipEntry({type:'text', text:${JSON.stringify(text)}});
      toggleClipFavorite(clipHistory[0].id);
      await addClipEntry({type:'url', text:${JSON.stringify(url)}});
      toggleClipFavorite(clipHistory[0].id);
      await addClipEntry({type:'image', imagePath:${JSON.stringify(imagePath)}});
      toggleClipFavorite(clipHistory[0].id);
      await addClipEntry({type:'image', imagePath:${JSON.stringify(plainImage)}});
      await addClipEntry({type:'image', imagePath:'clipboard-images/clip-favorite.png'});
      for (let i=0;i<230;i++) await addClipEntry({type:'text', text:'ordinary-'+i});
    })()`);
  }
  const expectedOrdinary = phase === 'reopen' ? 0 : 100;
  const state = await evaluate(`({
    favorites: clipHistory.filter(e=>clipFavorites.includes(e.id)),
    ordinary: clipHistory.filter(e=>!clipFavorites.includes(e.id)).length,
    persisted: JSON.parse(localStorage.getItem(CLIP_HISTORY_KEY)),
  })`);
  assert.equal(state.ordinary, expectedOrdinary);
  assert.equal(state.favorites.length, 3);
  assert.equal(state.favorites.find(e => e.type === 'text').text, text);
  assert.equal(state.favorites.find(e => e.type === 'url').text, url);
  assert.equal(state.persisted.length, expectedOrdinary + 3);
  assert.deepEqual(fs.readFileSync(imagePath), png);
  await evaluate(`(async () => {
    for (const e of clipHistory.filter(e=>clipFavorites.includes(e.id))) {
      if (!await copyClipEntry(e.id)) throw Error('favorite copy failed: '+e.type);
    }
  })()`);
  assert.deepEqual(copies.filter(e => e.type === 'text').map(e => e.text).sort(), [text, url].sort());
  assert.equal(copies.filter(e => e.type === 'image').length, 1);
  const decoded = await evaluate(`(async () => {
    const src = await window.notchAPI.readClipImage(${JSON.stringify(imagePath)});
    const image = new Image(); image.src = src; await image.decode();
    return {width:image.naturalWidth, height:image.naturalHeight};
  })()`);
  assert.deepEqual(decoded, { width: 1, height: 1 });
  if (phase === 'clear') {
    await evaluate("addClipEntry({type:'image', imagePath:'clipboard-images/clip-favorite.png'})");
    await evaluate('requestClearClipHistory(); requestClearClipHistory();');
    assert.equal(await evaluate('clipHistory.length'), 3);
    assert.equal(await evaluate('clipFavorites.length'), 3);
    assert.deepEqual(fs.readFileSync(imagePath), png);
  }
  await window.webContents.session.flushStorageData();
  console.log(JSON.stringify({ phase, passed: true, favorites: 3, imageDecoded: decoded,
    ordinary: phase === 'clear' ? 0 : expectedOrdinary, processId: process.pid }));
  window.destroy();
  app.quit();
}
run().catch(error => { console.error(error); app.exit(1); });
