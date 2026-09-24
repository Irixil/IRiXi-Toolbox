'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { app } = require('electron');

async function main() {
  await app.whenReady();
  const nativeModule = require(path.join(__dirname, '..', 'build', 'native-module', 'irixi-native.node'));
  const bundleId = nativeModule.getHostBundleIdentifier();
  const permission = nativeModule.getScreenRecordingPermissionStatus();
  assert.equal(typeof bundleId, 'string');
  assert.ok(bundleId.length > 0);
  assert.ok(['authorized', 'not_granted'].includes(permission));
  assert.equal(typeof nativeModule.startAreaCapture, 'function');
  assert.equal(typeof nativeModule.startWindowCapture, 'function');
  assert.equal(typeof nativeModule.startFullscreenCapture, 'function');
  assert.equal(typeof nativeModule.startOCRCapture, 'function');
  assert.equal(typeof nativeModule.startImageTranslationCapture, 'function');
  assert.equal(typeof nativeModule.setAreaCaptureShortcut, 'function');
  assert.equal(typeof nativeModule.initializeTranslation, 'function');
  assert.equal(typeof nativeModule.openInputTranslation, 'function');
  assert.equal(typeof nativeModule.translateCurrentSelection, 'function');

  nativeModule.initializeTranslation();
  assert.equal(nativeModule.setAreaCaptureShortcut('Command+Option+Shift+F20'), 0);
  assert.equal(nativeModule.openInputTranslation('en'), 0);
  await new Promise((resolve) => setTimeout(resolve, 250));

  // 本测试只验证原生窗口可打开；绝不调用授权请求或读取选中文字。
  nativeModule.openTestWindow();
  await new Promise((resolve) => setTimeout(resolve, 250));
  nativeModule.closeTestWindow();
  console.log(JSON.stringify({
    ok: true,
    bundleId,
    permission,
    captureShortcut: 'registered_natively',
    translationWindow: 'opened',
    testWindow: 'opened_and_closed',
  }));
  app.quit();
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
