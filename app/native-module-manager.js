'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const HOST_BUNDLE_ID = 'com.irixi.toolbox';
const MODULE_FILENAME = 'irixi-native.node';
const FRAMEWORK_NAME = 'IRiXiNativeKit.framework';
const SCREEN_PERMISSION_STATES = new Set([
  'not_determined',
  'not_granted',
  'denied',
  'authorized',
  'restricted',
  'unknown',
]);
const REQUIRED_METHODS = [
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
];
const W19_PERMISSION_TEST_ARGUMENT = '--irixi-w19-request-screen-permission';

class NativeModuleError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'NativeModuleError';
    this.code = code;
  }
}

function resolvePackagedPaths(options = {}) {
  const { platform = process.platform, isPackaged = false, execPath = process.execPath } = options;
  if (platform !== 'darwin') return { ok: false, error: 'unsupported_os' };
  if (!isPackaged || typeof execPath !== 'string' || !path.isAbsolute(execPath)) {
    return { ok: false, error: 'missing' };
  }
  const contentsPath = path.resolve(path.dirname(execPath), '..');
  const frameworksPath = path.join(contentsPath, 'Frameworks');
  return {
    ok: true,
    modulePath: path.join(frameworksPath, MODULE_FILENAME),
    frameworkPath: path.join(frameworksPath, FRAMEWORK_NAME),
  };
}

function inspectPackagedModule(options = {}) {
  const fsApi = options.fsApi || fs;
  const signatureRunner = options.signatureRunner || execFileSync;
  const resolved = resolvePackagedPaths(options);
  if (!resolved.ok) return resolved;

  try {
    for (const fixedPath of [resolved.modulePath, resolved.frameworkPath]) {
      const stat = fsApi.lstatSync(fixedPath);
      if (stat.isSymbolicLink()) return { ok: false, error: 'tampered' };
    }
    if (!fsApi.lstatSync(resolved.modulePath).isFile()) return { ok: false, error: 'tampered' };
    if (!fsApi.lstatSync(resolved.frameworkPath).isDirectory()) return { ok: false, error: 'tampered' };

    const realModulePath = fsApi.realpathSync(resolved.modulePath);
    const realFrameworkPath = fsApi.realpathSync(resolved.frameworkPath);
    if (realModulePath !== resolved.modulePath || realFrameworkPath !== resolved.frameworkPath) {
      return { ok: false, error: 'tampered' };
    }

    signatureRunner('/usr/bin/codesign', ['--verify', '--strict', resolved.modulePath], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    signatureRunner('/usr/bin/codesign', ['--verify', '--strict', resolved.frameworkPath], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, ...resolved };
  } catch (_error) {
    return { ok: false, error: 'missing' };
  }
}

function validateNativeApi(value) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
    throw new NativeModuleError('invalid_module', '原生模块接口不正确。');
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof value[method] !== 'function') {
      throw new NativeModuleError('invalid_module', `原生模块缺少固定方法：${method}`);
    }
  }
  return value;
}

function normalizePermissionStatus(value) {
  return SCREEN_PERMISSION_STATES.has(value) ? value : 'unknown';
}

function isExactW19PermissionTestInvocation(argv) {
  return Array.isArray(argv)
    && argv.length === 2
    && argv[1] === W19_PERMISSION_TEST_ARGUMENT;
}

function createNativeModuleManager(options = {}) {
  const inspector = options.inspector || (() => inspectPackagedModule({
    platform: options.platform,
    isPackaged: options.isPackaged,
    execPath: options.execPath,
  }));
  const loader = options.loader || ((modulePath) => require(modulePath));

  let api = null;
  let state = 'not_loaded';
  let bundleId = null;
  let screenPermission = 'unknown';

  function publicStatus() {
    return { state, bundleId, screenPermission };
  }

  function fail(code) {
    api = null;
    state = code;
    bundleId = null;
    screenPermission = 'unknown';
    return { ok: false, error: code, ...publicStatus() };
  }

  function load() {
    if (api) return { ok: true, ...publicStatus() };
    const inspection = inspector();
    if (!inspection || inspection.ok !== true || typeof inspection.modulePath !== 'string') {
      return fail(inspection?.error || 'missing');
    }
    try {
      const loaded = validateNativeApi(loader(inspection.modulePath));
      const reportedBundleId = loaded.getHostBundleIdentifier();
      if (reportedBundleId !== HOST_BUNDLE_ID) return fail('identity_mismatch');
      api = loaded;
      bundleId = reportedBundleId;
      screenPermission = normalizePermissionStatus(api.getScreenRecordingPermissionStatus());
      api.initializeTranslation();
      state = 'ready';
      return { ok: true, ...publicStatus() };
    } catch (error) {
      return fail(error instanceof NativeModuleError ? error.code : 'load_failed');
    }
  }

  function ensureLoaded() {
    const result = load();
    if (!result.ok || !api) throw new NativeModuleError(result.error || 'load_failed');
    return api;
  }

  function refreshScreenPermission() {
    try {
      const loaded = ensureLoaded();
      screenPermission = normalizePermissionStatus(loaded.getScreenRecordingPermissionStatus());
      return { ok: true, screenPermission };
    } catch (error) {
      return { ok: false, error: error.code || 'failed', screenPermission: 'unknown' };
    }
  }

  function requestScreenPermission() {
    try {
      const loaded = ensureLoaded();
      const requested = loaded.requestScreenRecordingPermission() === true;
      screenPermission = normalizePermissionStatus(loaded.getScreenRecordingPermissionStatus());
      return { ok: true, requested, screenPermission };
    } catch (error) {
      return { ok: false, error: error.code || 'failed', screenPermission: 'unknown' };
    }
  }

  function openTestWindow() {
    try {
      ensureLoaded().openTestWindow();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.code || 'failed' };
    }
  }

  function closeTestWindow() {
    try {
      ensureLoaded().closeTestWindow();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.code || 'failed' };
    }
  }

  function startAreaCapture() {
    try {
      const loaded = ensureLoaded();
      const code = loaded.startAreaCapture();
      if (code === 0) return { ok: true, active: true };
      if (code === 1) return { ok: false, error: 'busy', active: true };
      if (code === 2) {
        screenPermission = normalizePermissionStatus(loaded.getScreenRecordingPermissionStatus());
        return { ok: false, error: 'screen_recording_permission_required', active: false };
      }
      return { ok: false, error: 'capture_failed', active: false };
    } catch (error) {
      return { ok: false, error: error.code || 'failed', active: false };
    }
  }

  function startWindowCapture() {
    try {
      const loaded = ensureLoaded();
      const code = loaded.startWindowCapture();
      if (code === 0) return { ok: true, active: true };
      if (code === 1) return { ok: false, error: 'busy', active: true };
      if (code === 2) {
        screenPermission = normalizePermissionStatus(loaded.getScreenRecordingPermissionStatus());
        return { ok: false, error: 'screen_recording_permission_required', active: false };
      }
      return { ok: false, error: 'capture_failed', active: false };
    } catch (error) {
      return { ok: false, error: error.code || 'failed', active: false };
    }
  }

  function startFullscreenCapture() {
    try {
      const loaded = ensureLoaded();
      const code = loaded.startFullscreenCapture();
      if (code === 0) return { ok: true, active: true };
      if (code === 1) return { ok: false, error: 'busy', active: true };
      if (code === 2) {
        screenPermission = normalizePermissionStatus(loaded.getScreenRecordingPermissionStatus());
        return { ok: false, error: 'screen_recording_permission_required', active: false };
      }
      return { ok: false, error: 'capture_failed', active: false };
    } catch (error) {
      return { ok: false, error: error.code || 'failed', active: false };
    }
  }

  function startOCRCapture() {
    try {
      const loaded = ensureLoaded();
      const code = loaded.startOCRCapture();
      if (code === 0) return { ok: true, active: true };
      if (code === 1) return { ok: false, error: 'busy', active: true };
      if (code === 2) {
        screenPermission = normalizePermissionStatus(loaded.getScreenRecordingPermissionStatus());
        return { ok: false, error: 'screen_recording_permission_required', active: false };
      }
      return { ok: false, error: 'capture_failed', active: false };
    } catch (error) {
      return { ok: false, error: error.code || 'failed', active: false };
    }
  }

  function startImageTranslationCapture() {
    try {
      const loaded = ensureLoaded();
      const code = loaded.startImageTranslationCapture();
      if (code === 0) return { ok: true, active: true };
      if (code === 1) return { ok: false, error: 'busy', active: true };
      if (code === 2) {
        screenPermission = normalizePermissionStatus(loaded.getScreenRecordingPermissionStatus());
        return { ok: false, error: 'screen_recording_permission_required', active: false };
      }
      return { ok: false, error: 'capture_failed', active: false };
    } catch (error) {
      return { ok: false, error: error.code || 'failed', active: false };
    }
  }

  function cancelAreaCapture() {
    try {
      const loaded = ensureLoaded();
      loaded.cancelAreaCapture();
      return { ok: true, active: false };
    } catch (error) {
      return { ok: false, error: error.code || 'failed' };
    }
  }

  function isAreaCaptureActive() {
    try {
      return { ok: true, active: ensureLoaded().isAreaCaptureActive() === true };
    } catch (error) {
      return { ok: false, error: error.code || 'failed', active: false };
    }
  }

  function openInputTranslation(partner = 'en') {
    try {
      const normalized = ['en', 'ja', 'ko'].includes(partner) ? partner : 'en';
      const code = ensureLoaded().openInputTranslation(normalized);
      return code === 0 ? { ok: true } : { ok: false, error: 'translation_failed' };
    } catch (error) {
      return { ok: false, error: error.code || 'failed' };
    }
  }

  function translateCurrentSelection() {
    try {
      const code = ensureLoaded().translateCurrentSelection();
      return code === 0 ? { ok: true } : { ok: false, error: 'translation_failed' };
    } catch (error) {
      return { ok: false, error: error.code || 'failed' };
    }
  }

  return {
    load,
    status: publicStatus,
    refreshScreenPermission,
    requestScreenPermission,
    openTestWindow,
    closeTestWindow,
    startAreaCapture,
    startWindowCapture,
    startFullscreenCapture,
    startOCRCapture,
    startImageTranslationCapture,
    cancelAreaCapture,
    isAreaCaptureActive,
    openInputTranslation,
    translateCurrentSelection,
  };
}

module.exports = {
  HOST_BUNDLE_ID,
  MODULE_FILENAME,
  FRAMEWORK_NAME,
  SCREEN_PERMISSION_STATES,
  REQUIRED_METHODS,
  NativeModuleError,
  resolvePackagedPaths,
  inspectPackagedModule,
  validateNativeApi,
  normalizePermissionStatus,
  W19_PERMISSION_TEST_ARGUMENT,
  isExactW19PermissionTestInvocation,
  createNativeModuleManager,
};
