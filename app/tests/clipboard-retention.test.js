const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const Domain = require('../renderer/domain');

const HISTORY_KEY = 'notch-clip-history';
const FAVORITES_KEY = 'notch-clip-favorites';
const source = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
const start = source.indexOf('// ============ 剪贴板历史 ============');
const end = source.indexOf('// ---- IPC 推送监听 ----', start);
assert.ok(start >= 0 && end > start, 'test must execute the actual clipboard renderer section');

function textEntry(id, text = `synthetic ${id}`) {
  return { id, type: 'text', text, timestamp: 100 };
}

function imageEntry(id, imagePath = `clipboard-images/clip-${id}.png`) {
  return { id, type: 'image', imagePath, timestamp: 100 };
}

function harness(history = [], favorites = [], persisted, images) {
  const storage = persisted || new Map([
    [HISTORY_KEY, JSON.stringify(history)],
    [FAVORITES_KEY, JSON.stringify(favorites)],
  ]);
  const backing = images || new Map(history.filter((row) => row.imagePath)
    .map((row) => [row.imagePath, `data:image/png;base64,${Buffer.from(row.id).toString('base64')}`]));
  const deleted = [];
  const copied = [];
  const failWrites = new Set();
  let nextId = 0;
  let toast = null;
  const clearButton = {
    attributes: {},
    classList: { add() {}, remove() {} },
    addEventListener() {},
    setAttribute(name, value) { this.attributes[name] = value; },
  };
  const context = vm.createContext({
    document: { getElementById: (id) => id === 'clip-clear-btn' ? clearButton : null },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem(key, value) {
        if (failWrites.has(key)) throw new Error('synthetic storage quota failure');
        storage.set(key, value);
      },
    },
    generateId: () => `generated-${++nextId}`,
    renderClipFavs() {},
    showStatusToast(message, options = {}) {
      const previous = toast;
      toast = null;
      previous?.options.onExpire?.();
      toast = { message, options };
    },
    window: {
      NotchDomain: Domain,
      notchAPI: {
        async readClipImage(imagePath) { return backing.get(imagePath) || null; },
        async deleteClipImages(paths) {
          for (const imagePath of paths) {
            deleted.push(imagePath);
            backing.delete(imagePath);
          }
        },
        async writeClipboard(entry) {
          if (entry.type === 'image' && !backing.has(entry.imagePath)) return false;
          copied.push(JSON.parse(JSON.stringify(entry)));
          return true;
        },
      },
    },
  });
  vm.runInContext(source.slice(start, end), context, { filename: 'renderer/app.js#clipboard' });
  const evaluate = (code) => vm.runInContext(code, context);
  return {
    storage, backing, deleted, copied, failWrites, clearButton,
    evaluate,
    state: () => JSON.parse(evaluate('JSON.stringify({ history: clipHistory, favorites: clipFavorites, cache: [...clipImageCache.keys()] })')),
    add: (entry) => context.addClipEntry(entry),
    clear: () => context.clearClipHistory(),
    requestClear: () => context.requestClearClipHistory(),
    toggle: (id) => context.toggleClipFavorite(id),
    remove: (id) => context.deleteClipEntry(id),
    preload: (imagePath) => context.preloadClipImage(imagePath),
    copy: (id) => context.copyClipEntry(id),
    get toast() { return toast; },
    action() {
      const current = toast;
      toast = null; // The real action dismisses without committing onExpire.
      return current?.options.onAction?.();
    },
    expire() {
      const current = toast;
      toast = null;
      return current?.options.onExpire?.();
    },
  };
}

test('overflow retains favorite text, URL and image outside the 100 ordinary-record quota', async () => {
  const favorites = [textEntry('saved-text', '完整保留\n第二行'),
    { ...textEntry('saved-url', 'https://example.com/saved?q=1'), type: 'url' }, imageEntry('saved-image')];
  const h = harness(favorites, favorites.map((row) => row.id));
  for (let index = 0; index < 160; index++) assert.equal(await h.add(textEntry(`row-${index}`)), true);
  const state = h.state();
  assert.equal(state.history.length, 103);
  assert.equal(state.history.filter((row) => !state.favorites.includes(row.id)).length, 100);
  for (const favorite of favorites) {
    const row = state.history.find((item) => item.id === favorite.id);
    assert.equal(row.type, favorite.type);
    assert.equal(row.text, favorite.text ?? null);
    assert.equal(row.imagePath, favorite.imagePath ?? null);
    assert.equal(await h.copy(favorite.id), true);
  }
  assert.equal(h.backing.has(favorites[2].imagePath), true);
  assert.deepEqual(h.deleted, []);
  assert.equal(h.copied.length, 3);
});

test('more than 100 favorites are all retained alongside 100 ordinary records', async () => {
  const favorites = Array.from({ length: 110 }, (_, index) => textEntry(`saved-${index}`));
  const h = harness(favorites, favorites.map((row) => row.id));
  for (let index = 0; index < 120; index++) await h.add(textEntry(`row-${index}`));
  const state = h.state();
  assert.equal(state.history.length, 210);
  assert.equal(state.history.filter((row) => state.favorites.includes(row.id)).length, 110);
});

test('clear retains favorites, their cached and backed images, and reloadable exact content', async () => {
  const savedImage = imageEntry('saved');
  const ordinaryImage = imageEntry('ordinary');
  const h = harness([textEntry('normal'), ordinaryImage, textEntry('saved-text', '我的收藏\n原文'), savedImage], ['saved-text', 'saved']);
  await h.preload(savedImage.imagePath);
  await h.preload(ordinaryImage.imagePath);
  assert.equal(h.clear(), true);
  assert.deepEqual(h.state().history.map((row) => row.id), ['saved-text', 'saved']);
  assert.deepEqual(h.state().favorites, ['saved-text', 'saved']);
  assert.deepEqual(h.state().cache, [savedImage.imagePath]);
  assert.deepEqual(h.deleted, [ordinaryImage.imagePath]);
  assert.equal(h.backing.has(savedImage.imagePath), true);

  // Reloads the real renderer section from persisted data, not an OS-process restart.
  const reloaded = harness([], [], h.storage, h.backing);
  assert.deepEqual(reloaded.state().history, h.state().history);
  assert.deepEqual(reloaded.state().favorites, h.state().favorites);
  assert.equal(reloaded.state().cache.length, 0);
  await reloaded.preload(savedImage.imagePath);
  assert.deepEqual(reloaded.state().cache, [savedImage.imagePath]);
  assert.equal(await reloaded.copy('saved-text'), true);
  assert.equal(await reloaded.copy('saved'), true);
  assert.equal(reloaded.copied[0].text, '我的收藏\n原文');
  assert.equal(reloaded.copied[1].imagePath, savedImage.imagePath);
});

test('clear confirmation counts ordinary history and leaves an all-favorites history alone', () => {
  const h = harness([textEntry('normal'), textEntry('saved')], ['saved']);
  h.requestClear();
  assert.equal(h.state().history.length, 2);
  assert.match(h.clearButton.attributes['aria-label'], /1 条历史.*保留收藏/);
  h.requestClear();
  assert.deepEqual(h.state().history.map((row) => row.id), ['saved']);
  const persisted = [...h.storage];
  h.requestClear();
  assert.match(h.toast.message, /没有可清理.*收藏/);
  assert.deepEqual([...h.storage], persisted);
});

test('eviction, clear, and delayed deletion preserve image files referenced by favorites', async () => {
  const saved = imageEntry('saved', 'clipboard-images/clip-shared.png');
  const shared = imageEntry('ordinary', saved.imagePath);
  const ordinary = Array.from({ length: 99 }, (_, index) => textEntry(`row-${index}`));
  const h = harness([...ordinary, shared, saved], ['saved']);
  await h.preload(saved.imagePath);
  await h.add(textEntry('new'));
  assert.equal(h.state().history.some((row) => row.id === 'ordinary'), false);
  assert.equal(h.backing.has(saved.imagePath), true);
  assert.equal(h.clear(), true);
  assert.deepEqual(h.deleted, []);
  assert.deepEqual(h.state().cache, [saved.imagePath]);

  await h.add({ type: 'image', imagePath: saved.imagePath });
  const newId = h.state().history.find((row) => row.id !== 'saved').id;
  h.remove(newId);
  h.expire();
  assert.equal(h.backing.has(saved.imagePath), true);
  assert.deepEqual(h.deleted, []);
  assert.equal(await h.copy('saved'), true);
});

test('failed history save cannot commit eviction or delete the old image', async () => {
  const old = imageEntry('old');
  const h = harness([...Array.from({ length: 99 }, (_, i) => textEntry(`row-${i}`)), old]);
  await h.preload(old.imagePath);
  const before = h.state();
  const persisted = [...h.storage];
  h.failWrites.add(HISTORY_KEY);
  assert.equal(await h.add(textEntry('new')), false);
  assert.deepEqual(h.state(), before);
  assert.deepEqual([...h.storage], persisted);
  assert.deepEqual(h.deleted, []);
  assert.equal(h.backing.has(old.imagePath), true);
  assert.match(h.toast.message, /未能保存/);
});

test('relative and absolute references to the same favorite image survive cleanup in both directions', async () => {
  const relative = 'clipboard-images/clip-shared.png';
  const absolute = '/tmp/synthetic-profile/clipboard-images/clip-shared.png';
  for (const [savedPath, ordinaryPath] of [[relative, absolute], [absolute, relative]]) {
    const saved = imageEntry('saved', savedPath);
    const shared = imageEntry('ordinary', ordinaryPath);
    const ordinary = Array.from({ length: 99 }, (_, index) => textEntry(`row-${index}`));
    const h = harness([...ordinary, shared, saved], ['saved']);
    await h.preload(savedPath);
    await h.add(textEntry('new'));
    assert.equal(h.state().history.some((row) => row.id === 'ordinary'), false);
    assert.deepEqual(h.deleted, [], `overflow must retain the shared image: ${savedPath}`);
    await h.add({ type: 'image', imagePath: ordinaryPath });
    const newId = h.state().history.find((row) => row.type === 'image' && row.id !== 'saved').id;
    h.remove(newId);
    h.expire();
    assert.deepEqual(h.deleted, [], `delayed delete must retain the shared image: ${savedPath}`);
    await h.add({ type: 'image', imagePath: ordinaryPath });
    assert.equal(h.clear(), true);
    assert.deepEqual(h.deleted, [], `clear must retain the shared image: ${savedPath}`);
    assert.deepEqual(h.state().cache, [savedPath, ordinaryPath]);
    assert.equal(h.backing.has(savedPath), true);
    assert.equal(await h.copy('saved'), true);
  }
});

test('failed history save cannot commit clear or explicit deletion', () => {
  const old = imageEntry('old');
  const h = harness([old, textEntry('saved')], ['saved']);
  const before = h.state();
  const persisted = [...h.storage];
  h.failWrites.add(HISTORY_KEY);
  assert.equal(h.clear(), false);
  h.remove('old');
  h.expire();
  assert.deepEqual(h.state(), before);
  assert.deepEqual([...h.storage], persisted);
  assert.deepEqual(h.deleted, []);
  assert.equal(h.backing.has(old.imagePath), true);
});

test('failed favorite save cannot report a new favorite or remove an existing favorite', () => {
  const h = harness([textEntry('normal'), textEntry('saved')], ['saved']);
  const before = h.state();
  const persisted = [...h.storage];
  h.failWrites.add(FAVORITES_KEY);
  h.toggle('normal');
  assert.deepEqual(h.state(), before);
  h.toggle('saved');
  assert.deepEqual(h.state(), before);
  assert.deepEqual([...h.storage], persisted);
  assert.match(h.toast.message, /收藏.*未能保存/);
});

test('favorite deletion requires confirmation, supports undo, and only then deletes image on expiry', async () => {
  const saved = imageEntry('saved');
  const h = harness([saved], ['saved']);
  const before = h.state();
  h.remove('saved');
  assert.deepEqual(h.state(), before);
  assert.match(h.toast.options.actionLabel, /确认/);
  h.expire();
  assert.deepEqual(h.state(), before);
  assert.equal(h.backing.has(saved.imagePath), true);

  h.remove('saved');
  h.action();
  assert.equal(h.state().history.length, 0);
  assert.equal(h.state().favorites.length, 0);
  assert.equal(h.backing.has(saved.imagePath), true);
  assert.match(h.toast.options.actionLabel, /撤销/);
  h.action();
  assert.deepEqual(h.state(), before);
  assert.deepEqual(JSON.parse(h.storage.get(FAVORITES_KEY)), ['saved']);
  h.expire();
  assert.deepEqual(h.deleted, []);
  assert.equal(await h.copy('saved'), true);

  h.remove('saved');
  h.action();
  h.expire();
  assert.equal(h.state().history.length, 0);
  assert.equal(h.backing.has(saved.imagePath), false);
  assert.deepEqual(h.deleted, [saved.imagePath]);
});

test('unfavorited record rejoins ordinary retention on the next insertion', async () => {
  const saved = imageEntry('saved');
  const ordinary = Array.from({ length: 100 }, (_, index) => textEntry(`row-${index}`));
  const h = harness([...ordinary, saved], ['saved']);
  h.toggle('saved');
  assert.equal(h.state().history.length, 101);
  await h.add(textEntry('new'));
  assert.equal(h.state().history.length, 100);
  assert.equal(h.state().history.some((row) => row.id === 'saved'), false);
  assert.deepEqual(h.deleted, [saved.imagePath]);
});
