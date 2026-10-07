const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('remembering the toolbox itself must retain the previous paste destination', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const fn = source.slice(source.indexOf('async function rememberPasteTarget()'), source.indexOf("ipcMain.handle('mirror:get-image'"));
  let front = { bundleId: 'test.editor' };
  const context = vm.createContext({ OWL_ISOLATED: false, previousPasteTarget: null, readFrontmostApp: async () => front });
  const remember = vm.runInContext(fn + '\nrememberPasteTarget', context);
  assert.equal((await remember()).bundleId, 'test.editor');
  front = { bundleId: 'com.irixi.toolbox' };
  assert.equal((await remember()).bundleId, 'test.editor');
});

test('an isolated layout check never reads the frontmost application or replaces the paste destination', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const fn = source.slice(source.indexOf('async function rememberPasteTarget()'), source.indexOf("ipcMain.handle('mirror:get-image'"));
  const previous = { bundleId: 'test.editor' };
  const context = vm.createContext({ OWL_ISOLATED: true, previousPasteTarget: previous,
    readFrontmostApp: () => { throw Error('Isolated checks must not query other apps'); } });
  assert.equal(await vm.runInContext(fn + '\nrememberPasteTarget', context)(), null);
  assert.equal(context.previousPasteTarget, previous);
});
