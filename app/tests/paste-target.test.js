const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('remembering the toolbox itself must retain the previous paste destination', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const fn = source.slice(source.indexOf('async function rememberPasteTarget()'), source.indexOf("ipcMain.handle('mirror:get-image'"));
  let front = { bundleId: 'test.editor' };
  const context = vm.createContext({ previousPasteTarget: null, readFrontmostApp: async () => front });
  const remember = vm.runInContext(fn + '\nrememberPasteTarget', context);
  assert.equal((await remember()).bundleId, 'test.editor');
  front = { bundleId: 'com.irixi.toolbox' };
  assert.equal((await remember()).bundleId, 'test.editor');
});
