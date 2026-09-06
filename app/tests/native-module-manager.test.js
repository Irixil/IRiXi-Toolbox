'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  HOST_BUNDLE_ID,
  resolvePackagedPaths,
  validateNativeApi,
  isExactW19PermissionTestInvocation,
  createNativeModuleManager,
} = require('../native-module-manager');

function fakeNativeApi(overrides = {}) {
  return {
    getHostBundleIdentifier: () => HOST_BUNDLE_ID,
    getScreenRecordingPermissionStatus: () => 'not_determined',
    requestScreenRecordingPermission: () => false,
    openTestWindow: () => {},
    closeTestWindow: () => {},
    startAreaCapture: () => 0,
    startWindowCapture: () => 0,
    startFullscreenCapture: () => 0,
    startOCRCapture: () => 0,
    startImageTranslationCapture: () => 0,
    cancelAreaCapture: () => {},
    isAreaCaptureActive: () => false,
    initializeTranslation: () => {},
    openInputTranslation: () => 0,
    translateCurrentSelection: () => 0,
    ...overrides,
  };
}

test('the native module path is fixed inside Contents/Frameworks', () => {
  const result = resolvePackagedPaths({
    platform: 'darwin',
    isPackaged: true,
    execPath: '/Applications/IRiXi的小工具库.app/Contents/MacOS/IRiXi的小工具库',
  });
  assert.deepEqual(result, {
    ok: true,
    modulePath: '/Applications/IRiXi的小工具库.app/Contents/Frameworks/irixi-native.node',
    frameworkPath: '/Applications/IRiXi的小工具库.app/Contents/Frameworks/IRiXiNativeKit.framework',
  });
  assert.equal(resolvePackagedPaths({ platform: 'linux', isPackaged: true, execPath: '/app' }).error, 'unsupported_os');
  assert.equal(resolvePackagedPaths({ platform: 'darwin', isPackaged: false, execPath: '/app' }).error, 'missing');
});

test('only the fixed fifteen-function native interface is accepted', () => {
  assert.equal(validateNativeApi(fakeNativeApi()).getHostBundleIdentifier(), HOST_BUNDLE_ID);
  for (const method of [
    'getHostBundleIdentifier',
    'getScreenRecordingPermissionStatus',
    'requestScreenRecordingPermission',
    'openTestWindow',
    'closeTestWindow',
    'startAreaCapture',
    'startWindowCapture',
    'startFullscreenCapture',
    'startOCRCapture',
    'startImageTranslationCapture',
    'cancelAreaCapture',
    'isAreaCaptureActive',
    'initializeTranslation',
    'openInputTranslation',
    'translateCurrentSelection',
  ]) {
    const api = fakeNativeApi();
    delete api[method];
    assert.throws(() => validateNativeApi(api), /原生模块缺少固定方法/);
  }
});

test('area capture stays inside the native module and maps bounded result codes', () => {
  const calls = [];
  const manager = createNativeModuleManager({
    inspector: () => ({ ok: true, modulePath: '/fixed/irixi-native.node' }),
    loader: () => fakeNativeApi({
      startAreaCapture: () => { calls.push('start'); return 0; },
      cancelAreaCapture: () => calls.push('cancel'),
      isAreaCaptureActive: () => true,
    }),
  });
  assert.deepEqual(manager.startAreaCapture(), { ok: true, active: true });
  assert.deepEqual(manager.isAreaCaptureActive(), { ok: true, active: true });
  assert.deepEqual(manager.cancelAreaCapture(), { ok: true, active: false });
  assert.deepEqual(calls, ['start', 'cancel']);

  const permissionRequired = createNativeModuleManager({
    inspector: () => ({ ok: true, modulePath: '/fixed/irixi-native.node' }),
    loader: () => fakeNativeApi({ startAreaCapture: () => 2 }),
  });
  assert.deepEqual(permissionRequired.startAreaCapture(), {
    ok: false,
    error: 'screen_recording_permission_required',
    active: false,
  });
});

test('window and fullscreen capture stay inside the same native module', () => {
  const calls = [];
  const manager = createNativeModuleManager({
    inspector: () => ({ ok: true, modulePath: '/fixed/irixi-native.node' }),
    loader: () => fakeNativeApi({
      startWindowCapture: () => { calls.push('window'); return 0; },
      startFullscreenCapture: () => { calls.push('fullscreen'); return 0; },
    }),
  });
  assert.deepEqual(manager.startWindowCapture(), { ok: true, active: true });
  assert.deepEqual(manager.startFullscreenCapture(), { ok: true, active: true });
  assert.deepEqual(calls, ['window', 'fullscreen']);

  const busy = createNativeModuleManager({
    inspector: () => ({ ok: true, modulePath: '/fixed/irixi-native.node' }),
    loader: () => fakeNativeApi({ startWindowCapture: () => 1 }),
  });
  assert.deepEqual(busy.startWindowCapture(), { ok: false, error: 'busy', active: true });

  const permissionRequired = createNativeModuleManager({
    inspector: () => ({ ok: true, modulePath: '/fixed/irixi-native.node' }),
    loader: () => fakeNativeApi({ startFullscreenCapture: () => 2 }),
  });
  assert.deepEqual(permissionRequired.startFullscreenCapture(), {
    ok: false,
    error: 'screen_recording_permission_required',
    active: false,
  });
});

test('OCR capture stays inside the same native module', () => {
  const manager = createNativeModuleManager({
    inspector: () => ({ ok: true, modulePath: '/fixed/irixi-native.node' }),
    loader: () => fakeNativeApi({ startOCRCapture: () => 0 }),
  });
  assert.deepEqual(manager.startOCRCapture(), { ok: true, active: true });
});

test('image translation capture stays inside the same native module', () => {
  const manager = createNativeModuleManager({
    inspector: () => ({ ok: true, modulePath: '/fixed/irixi-native.node' }),
    loader: () => fakeNativeApi({ startImageTranslationCapture: () => 0 }),
  });
  assert.deepEqual(manager.startImageTranslationCapture(), { ok: true, active: true });
});

test('input and selection translation stay inside the same native module', () => {
  const calls = [];
  const manager = createNativeModuleManager({
    inspector: () => ({ ok: true, modulePath: '/fixed/irixi-native.node' }),
    loader: () => fakeNativeApi({
      openInputTranslation: (partner) => { calls.push(['input', partner]); return 0; },
      translateCurrentSelection: () => { calls.push(['selection']); return 0; },
    }),
  });
  assert.deepEqual(manager.openInputTranslation('ja'), { ok: true });
  assert.deepEqual(manager.openInputTranslation('unsupported'), { ok: true });
  assert.deepEqual(manager.translateCurrentSelection(), { ok: true });
  assert.deepEqual(calls, [['input', 'ja'], ['input', 'en'], ['selection']]);
});

test('loading reads identity and permission but never requests permission', () => {
  const calls = [];
  const manager = createNativeModuleManager({
    inspector: () => ({ ok: true, modulePath: path.join('/fixed', 'irixi-native.node') }),
    loader: () => fakeNativeApi({
      getHostBundleIdentifier: () => { calls.push('bundle'); return HOST_BUNDLE_ID; },
      getScreenRecordingPermissionStatus: () => { calls.push('permission.status'); return 'denied'; },
      requestScreenRecordingPermission: () => { calls.push('permission.request'); return true; },
    }),
  });
  assert.deepEqual(manager.load(), {
    ok: true,
    state: 'ready',
    bundleId: HOST_BUNDLE_ID,
    screenPermission: 'denied',
  });
  assert.deepEqual(calls, ['bundle', 'permission.status']);
});

test('an unexpected host bundle identity fails closed', () => {
  const manager = createNativeModuleManager({
    inspector: () => ({ ok: true, modulePath: '/fixed/irixi-native.node' }),
    loader: () => fakeNativeApi({ getHostBundleIdentifier: () => 'com.example.other' }),
  });
  assert.equal(manager.load().error, 'identity_mismatch');
  assert.deepEqual(manager.status(), {
    state: 'identity_mismatch', bundleId: null, screenPermission: 'unknown',
  });
});

test('permission request remains explicit and test window opens and closes', () => {
  const calls = [];
  let permission = 'not_determined';
  const manager = createNativeModuleManager({
    inspector: () => ({ ok: true, modulePath: '/fixed/irixi-native.node' }),
    loader: () => fakeNativeApi({
      getScreenRecordingPermissionStatus: () => permission,
      requestScreenRecordingPermission: () => { calls.push('request'); permission = 'authorized'; return true; },
      openTestWindow: () => calls.push('open'),
      closeTestWindow: () => calls.push('close'),
    }),
  });
  assert.equal(manager.load().ok, true);
  assert.deepEqual(calls, []);
  assert.deepEqual(manager.requestScreenPermission(), {
    ok: true, requested: true, screenPermission: 'authorized',
  });
  assert.deepEqual(manager.openTestWindow(), { ok: true });
  assert.deepEqual(manager.closeTestWindow(), { ok: true });
  assert.deepEqual(calls, ['request', 'open', 'close']);
});

test('missing module and invalid permission values stay bounded', () => {
  const missing = createNativeModuleManager({ inspector: () => ({ ok: false, error: 'missing' }) });
  assert.equal(missing.load().error, 'missing');
  assert.deepEqual(missing.openTestWindow(), { ok: false, error: 'missing' });

  const invalidStatus = createNativeModuleManager({
    inspector: () => ({ ok: true, modulePath: '/fixed/irixi-native.node' }),
    loader: () => fakeNativeApi({ getScreenRecordingPermissionStatus: () => 'private_detail' }),
  });
  assert.equal(invalidStatus.load().screenPermission, 'unknown');
});

test('the W19 permission request is gated by one exact packaged launch argument', () => {
  assert.equal(isExactW19PermissionTestInvocation([
    '/Applications/IRiXi的小工具库.app/Contents/MacOS/IRiXi的小工具库',
    '--irixi-w19-request-screen-permission',
  ]), true);
  assert.equal(isExactW19PermissionTestInvocation([
    '/Applications/IRiXi的小工具库.app/Contents/MacOS/IRiXi的小工具库',
  ]), false);
  assert.equal(isExactW19PermissionTestInvocation([
    '/Applications/IRiXi的小工具库.app/Contents/MacOS/IRiXi的小工具库',
    '--irixi-w19-request-screen-permission',
    '--extra',
  ]), false);
  assert.equal(isExactW19PermissionTestInvocation([
    '/Applications/IRiXi的小工具库.app/Contents/MacOS/IRiXi的小工具库',
    '--irixi-w19-request-screen-permission=1',
  ]), false);
});
