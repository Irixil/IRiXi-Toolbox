'use strict';

const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn: spawnProcess, execFileSync } = require('node:child_process');

const PROTOCOL_VERSION = 1;
const MAX_LINE_BYTES = 64 * 1024;
const DEFAULT_RESPONSE_TIMEOUT_MS = 5000;
const DEFAULT_ACTION_TIMEOUT_MS = 30 * 60 * 1000;
const HELPER_BUNDLE_ID = 'com.irixi.toolbox.native-helper';
const HELPER_BUNDLE_NAME = 'IRiXi Native Helper.app';
const HELPER_EXECUTABLE_NAME = 'IRiXi Native Helper';
const MANIFEST_NAME = 'native-helper-manifest.json';

const NO_ARGS = new Set([
  'health',
  'translation.speak.source',
  'translation.speak.result',
  'translation.speech.pause',
  'translation.speech.resume',
  'translation.speech.stop',
  'translation.replaceSelection',
  'translation.settings.open',
  'capture.area',
  'capture.window',
  'capture.fullscreen',
  'capture.ocr',
  'record.stop',
  'history.open',
]);

const PARTNER_ARGS = new Set([
  'translation.input.open',
  'translation.selection',
  'translation.capture',
]);

const TARGET_ARGS = new Set([
  'capture.translate',
]);

const ALLOWED_ACTIONS = new Set([
  ...NO_ARGS,
  ...PARTNER_ARGS,
  ...TARGET_ARGS,
  'record.area',
  'record.fullscreen',
  'cancel',
]);

const RESPONSE_STATUSES = new Set(['started', 'completed', 'cancelled', 'failed']);
const EVENT_STATES = new Set(['ready', 'busy', 'needs_permission', 'crashed']);
const ERROR_CODES = new Set([
  'unsupported_os',
  'missing',
  'tampered',
  'signature_invalid',
  'protocol_error',
  'invalid_action',
  'invalid_args',
  'duplicate',
  'timeout',
  'busy',
  'permission_denied',
  'cancelled',
  'failed',
]);
const NON_EXCLUSIVE_ACTIONS = new Set([
  'health',
  'translation.speech.pause',
  'translation.speech.resume',
  'translation.speech.stop',
  'record.stop',
  'cancel',
]);

class NativeHelperError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'NativeHelperError';
    this.code = ERROR_CODES.has(code) ? code : 'failed';
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, allowed) {
  if (!isPlainObject(value)) return false;
  return Object.keys(value).every((key) => allowed.has(key));
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validateAction(action, args = {}) {
  if (typeof action !== 'string' || !ALLOWED_ACTIONS.has(action)) {
    throw new NativeHelperError('invalid_action', '不支持这个原生助手动作。');
  }
  if (!isPlainObject(args)) {
    throw new NativeHelperError('invalid_args', '原生助手参数格式不正确。');
  }

  if (NO_ARGS.has(action)) {
    if (!hasExactKeys(args, new Set()) || Object.keys(args).length !== 0) {
      throw new NativeHelperError('invalid_args', '这个动作不接受参数。');
    }
    return {};
  }

  if (PARTNER_ARGS.has(action)) {
    if (!hasExactKeys(args, new Set(['partner'])) || Object.keys(args).length !== 1
      || !['en', 'ja', 'ko'].includes(args.partner)) {
      throw new NativeHelperError('invalid_args', '互译对象只能是英语、日语或韩语。');
    }
    return { partner: args.partner };
  }

  if (TARGET_ARGS.has(action)) {
    if (!hasExactKeys(args, new Set(['target'])) || Object.keys(args).length !== 1
      || args.target !== 'zh-CN') {
      throw new NativeHelperError('invalid_args', '图片翻译目标只能使用内置的简体中文。');
    }
    return { target: args.target };
  }

  if (action === 'record.area') {
    if (!hasExactKeys(args, new Set(['microphone'])) || Object.keys(args).length !== 1
      || typeof args.microphone !== 'boolean') {
      throw new NativeHelperError('invalid_args', '录屏麦克风设置不正确。');
    }
    return { microphone: args.microphone };
  }

  if (action === 'record.fullscreen') {
    if (!hasExactKeys(args, new Set(['display', 'microphone'])) || Object.keys(args).length !== 2
      || !['current', 'all'].includes(args.display) || typeof args.microphone !== 'boolean') {
      throw new NativeHelperError('invalid_args', '全屏录制参数不正确。');
    }
    return { display: args.display, microphone: args.microphone };
  }

  if (action === 'cancel') {
    if (!hasExactKeys(args, new Set(['requestId'])) || Object.keys(args).length !== 1
      || !isUuid(args.requestId)) {
      throw new NativeHelperError('invalid_args', '取消目标必须是有效请求编号。');
    }
    return { requestId: args.requestId };
  }

  throw new NativeHelperError('invalid_action');
}

function parseSystemMajor(version) {
  const match = String(version || '').match(/^(\d+)(?:\.|$)/);
  return match ? Number(match[1]) : 0;
}

function readPlistValue(plistPath, key, runner = execFileSync) {
  return String(runner('/usr/bin/plutil', ['-extract', key, 'raw', plistPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })).trim();
}

function inspectPackagedHelper(options) {
  const {
    resourcesPath,
    isPackaged,
    platform = process.platform,
    systemVersion = '',
    fsApi = fs,
    signatureRunner = execFileSync,
  } = options || {};

  if (platform !== 'darwin' || parseSystemMajor(systemVersion) < 15) {
    return { ok: false, error: 'unsupported_os' };
  }
  if (!isPackaged || typeof resourcesPath !== 'string' || !path.isAbsolute(resourcesPath)) {
    return { ok: false, error: 'missing' };
  }

  try {
    const contentsPath = path.resolve(resourcesPath, '..');
    const helpersRoot = path.join(contentsPath, 'Helpers');
    const bundlePath = path.join(helpersRoot, HELPER_BUNDLE_NAME);
    const executablePath = path.join(bundlePath, 'Contents', 'MacOS', HELPER_EXECUTABLE_NAME);
    const plistPath = path.join(bundlePath, 'Contents', 'Info.plist');
    const manifestPath = path.join(resourcesPath, MANIFEST_NAME);

    for (const requiredPath of [bundlePath, executablePath, plistPath, manifestPath]) {
      const stat = fsApi.lstatSync(requiredPath);
      if (stat.isSymbolicLink()) return { ok: false, error: 'tampered' };
    }

    const realHelpersRoot = fsApi.realpathSync(helpersRoot);
    const realExecutable = fsApi.realpathSync(executablePath);
    if (!realExecutable.startsWith(`${realHelpersRoot}${path.sep}`)) {
      return { ok: false, error: 'tampered' };
    }

    const manifestBytes = fsApi.readFileSync(manifestPath);
    if (manifestBytes.length > 16 * 1024) return { ok: false, error: 'tampered' };
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    const manifestKeys = new Set(['protocolVersion', 'helperVersion', 'bundleId', 'relativeExecutablePath', 'sha256', 'signature']);
    if (!hasExactKeys(manifest, manifestKeys)
      || Object.keys(manifest).length !== manifestKeys.size
      || manifest.protocolVersion !== PROTOCOL_VERSION
      || manifest.bundleId !== HELPER_BUNDLE_ID
      || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.helperVersion)
      || manifest.relativeExecutablePath !== `${HELPER_BUNDLE_NAME}/Contents/MacOS/${HELPER_EXECUTABLE_NAME}`
      || !/^[0-9a-f]{64}$/.test(manifest.sha256)
      || !['adhoc', 'developer-id'].includes(manifest.signature)) {
      return { ok: false, error: 'tampered' };
    }

    const bundleId = readPlistValue(plistPath, 'CFBundleIdentifier', signatureRunner);
    const bundleVersion = readPlistValue(plistPath, 'CFBundleShortVersionString', signatureRunner);
    const minimumVersion = readPlistValue(plistPath, 'LSMinimumSystemVersion', signatureRunner);
    if (bundleId !== HELPER_BUNDLE_ID || bundleVersion !== manifest.helperVersion
      || parseSystemMajor(minimumVersion) < 15) {
      return { ok: false, error: 'tampered' };
    }

    const digest = crypto.createHash('sha256').update(fsApi.readFileSync(executablePath)).digest('hex');
    if (digest !== manifest.sha256) return { ok: false, error: 'tampered' };

    try {
      signatureRunner('/usr/bin/codesign', ['--verify', '--strict', bundlePath], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (_error) {
      return { ok: false, error: 'signature_invalid' };
    }

    return {
      ok: true,
      executablePath: realExecutable,
      helperVersion: manifest.helperVersion,
      signature: manifest.signature,
    };
  } catch (_error) {
    return { ok: false, error: 'missing' };
  }
}

function parseIncomingLine(line) {
  if (typeof line !== 'string' || Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
    throw new NativeHelperError('protocol_error');
  }

  let value;
  try {
    value = JSON.parse(line);
  } catch (_error) {
    throw new NativeHelperError('protocol_error');
  }
  if (!isPlainObject(value) || value.v !== PROTOCOL_VERSION) {
    throw new NativeHelperError('protocol_error');
  }

  if (Object.prototype.hasOwnProperty.call(value, 'event')) {
    if (!hasExactKeys(value, new Set(['v', 'event', 'state']))
      || Object.keys(value).length !== 3
      || value.event !== 'state'
      || !EVENT_STATES.has(value.state)) {
      throw new NativeHelperError('protocol_error');
    }
    return { type: 'event', state: value.state };
  }

  if (!hasExactKeys(value, new Set(['v', 'id', 'status', 'code']))
    || !isUuid(value.id)
    || !RESPONSE_STATUSES.has(value.status)
    || (value.code !== undefined && !ERROR_CODES.has(value.code))) {
    throw new NativeHelperError('protocol_error');
  }
  if (value.status === 'failed' && typeof value.code !== 'string') {
    throw new NativeHelperError('protocol_error');
  }
  if (value.status !== 'failed' && value.code !== undefined) {
    throw new NativeHelperError('protocol_error');
  }
  return { type: 'response', id: value.id, status: value.status, code: value.code };
}

function minimalChildEnvironment(source = process.env) {
  const safe = { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' };
  for (const key of ['HOME', 'USER', 'LOGNAME', 'TMPDIR', '__CF_USER_TEXT_ENCODING']) {
    if (typeof source[key] === 'string' && source[key]) safe[key] = source[key];
  }
  return safe;
}

function createNativeHelperManager(options = {}) {
  const emitter = new EventEmitter();
  const inspector = options.inspector || (() => inspectPackagedHelper({
    resourcesPath: options.resourcesPath,
    isPackaged: options.isPackaged,
    platform: options.platform,
    systemVersion: typeof options.systemVersion === 'function' ? options.systemVersion() : options.systemVersion,
  }));
  const spawn = options.spawn || spawnProcess;
  const responseTimeoutMs = options.responseTimeoutMs || DEFAULT_RESPONSE_TIMEOUT_MS;
  const actionTimeoutMs = options.actionTimeoutMs || DEFAULT_ACTION_TIMEOUT_MS;
  const randomUUID = options.randomUUID || crypto.randomUUID;
  const logger = options.logger || console;

  let child = null;
  let state = 'stopped';
  let detail = null;
  let stdoutBuffer = Buffer.alloc(0);
  let startPromise = null;
  const pending = new Map();
  const issuedIds = new Set();

  function publicStatus() {
    return detail ? { state, detail } : { state };
  }

  function setState(nextState, nextDetail = null) {
    state = nextState;
    detail = nextDetail;
    emitter.emit('state', publicStatus());
  }

  function settlePending(code) {
    for (const item of pending.values()) {
      clearTimeout(item.responseTimer);
      clearTimeout(item.actionTimer);
      item.resolve({ ok: false, error: code });
    }
    pending.clear();
  }

  function terminateForProtocolError() {
    const current = child;
    child = null;
    stdoutBuffer = Buffer.alloc(0);
    settlePending('protocol_error');
    setState('failed', 'protocol_error');
    if (current && typeof current.kill === 'function') current.kill('SIGTERM');
  }

  function handleMessage(message) {
    if (message.type === 'event') {
      setState(message.state);
      return;
    }

    const item = pending.get(message.id);
    if (!item) return;
    if (message.status === 'started') {
      clearTimeout(item.responseTimer);
      if (!item.actionTimer) {
        item.actionTimer = setTimeout(() => {
          pending.delete(message.id);
          item.resolve({ ok: false, error: 'timeout' });
          setState('failed', 'timeout');
          const current = child;
          child = null;
          if (current && typeof current.kill === 'function') current.kill('SIGTERM');
        }, actionTimeoutMs);
      }
      setState('busy');
      return;
    }

    pending.delete(message.id);
    clearTimeout(item.responseTimer);
    clearTimeout(item.actionTimer);
    if (pending.size === 0 && child) setState('ready');
    if (message.status === 'completed') item.resolve({ ok: true });
    else if (message.status === 'cancelled') item.resolve({ ok: false, error: 'cancelled' });
    else item.resolve({ ok: false, error: message.code || 'failed' });
  }

  function handleStdout(chunk) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    stdoutBuffer = Buffer.concat([stdoutBuffer, bytes]);
    if (stdoutBuffer.length > MAX_LINE_BYTES && stdoutBuffer.indexOf(0x0a) === -1) {
      terminateForProtocolError();
      return;
    }

    while (true) {
      const newline = stdoutBuffer.indexOf(0x0a);
      if (newline === -1) break;
      const lineBytes = stdoutBuffer.subarray(0, newline);
      stdoutBuffer = stdoutBuffer.subarray(newline + 1);
      if (lineBytes.length === 0) continue;
      if (lineBytes.length > MAX_LINE_BYTES) {
        terminateForProtocolError();
        return;
      }
      try {
        handleMessage(parseIncomingLine(lineBytes.toString('utf8')));
      } catch (_error) {
        terminateForProtocolError();
        return;
      }
    }
  }

  function attachChild(nextChild) {
    child = nextChild;
    stdoutBuffer = Buffer.alloc(0);
    issuedIds.clear();
    let stderrBuffer = '';
    let fixedDiagnostic = null;
    nextChild.stdout.on('data', (chunk) => {
      if (child === nextChild) handleStdout(chunk);
    });
    nextChild.stderr.on('data', (chunk) => {
      if (stderrBuffer.length >= 4096) return;
      stderrBuffer += String(chunk).slice(0, 4096 - stderrBuffer.length);
      for (const line of stderrBuffer.split(/\r?\n/)) {
        const match = line.trim().match(/^parent_validation:([a-z_]{1,64})$/);
        if (!match) continue;
        fixedDiagnostic = `parent_validation:${match[1]}`;
        logger.warn(`[native-helper] ${fixedDiagnostic}`);
      }
    });
    nextChild.once('error', () => {
      if (child !== nextChild) return;
      child = null;
      settlePending('failed');
      setState('failed', 'failed');
    });
    nextChild.once('exit', () => {
      if (child !== nextChild) return;
      child = null;
      stdoutBuffer = Buffer.alloc(0);
      settlePending('failed');
      setState('crashed', fixedDiagnostic);
    });
  }

  function send(action, args = {}) {
    let normalizedArgs;
    try {
      normalizedArgs = validateAction(action, args);
    } catch (error) {
      return Promise.resolve({ ok: false, error: error.code || 'invalid_args' });
    }
    if (!child || !child.stdin || child.stdin.destroyed) {
      return Promise.resolve({ ok: false, error: state === 'crashed' ? 'failed' : 'missing' });
    }
    if (!NON_EXCLUSIVE_ACTIONS.has(action)
      && [...pending.values()].some((item) => !NON_EXCLUSIVE_ACTIONS.has(item.action))) {
      return Promise.resolve({ ok: false, error: 'busy' });
    }

    const id = randomUUID();
    if (!isUuid(id) || issuedIds.has(id)) {
      return Promise.resolve({ ok: false, error: 'duplicate' });
    }
    issuedIds.add(id);
    const request = { v: PROTOCOL_VERSION, id, action, args: normalizedArgs };
    const line = `${JSON.stringify(request)}\n`;
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
      return Promise.resolve({ ok: false, error: 'invalid_args' });
    }

    return new Promise((resolve) => {
      const item = {
        action,
        resolve,
        actionTimer: null,
        responseTimer: setTimeout(() => {
          pending.delete(id);
          resolve({ ok: false, error: 'timeout' });
          setState('failed', 'timeout');
          const current = child;
          child = null;
          if (current && typeof current.kill === 'function') current.kill('SIGTERM');
        }, responseTimeoutMs),
      };
      pending.set(id, item);
      child.stdin.write(line, (error) => {
        if (!error) return;
        pending.delete(id);
        clearTimeout(item.responseTimer);
        resolve({ ok: false, error: 'failed' });
      });
    });
  }

  async function start() {
    if (child && (state === 'ready' || state === 'busy')) return { ok: true };
    if (startPromise) return startPromise;
    startPromise = (async () => {
      const inspected = inspector();
      if (!inspected || inspected.ok !== true || typeof inspected.executablePath !== 'string') {
        const error = inspected && ERROR_CODES.has(inspected.error) ? inspected.error : 'missing';
        setState(error);
        return { ok: false, error };
      }
      setState('starting');
      let nextChild;
      try {
        nextChild = spawn(inspected.executablePath, [], {
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: false,
          windowsHide: true,
          env: minimalChildEnvironment(),
        });
      } catch (_error) {
        setState('failed', 'failed');
        return { ok: false, error: 'failed' };
      }
      attachChild(nextChild);
      const ready = await send('health', {});
      if (!ready.ok) return ready;
      setState('ready');
      return { ok: true };
    })();
    try {
      return await startPromise;
    } finally {
      startPromise = null;
    }
  }

  async function run(action, args = {}) {
    try {
      validateAction(action, args);
    } catch (error) {
      return { ok: false, error: error.code || 'invalid_args' };
    }
    const started = await start();
    if (!started.ok) return started;
    return send(action, args);
  }

  function stop() {
    const current = child;
    child = null;
    stdoutBuffer = Buffer.alloc(0);
    settlePending('cancelled');
    setState('stopped');
    if (current && typeof current.kill === 'function') current.kill('SIGTERM');
  }

  async function restart() {
    stop();
    return start();
  }

  function status() {
    if (child || !['stopped', 'missing', 'unsupported_os', 'tampered', 'signature_invalid'].includes(state)) {
      return publicStatus();
    }
    const inspected = inspector();
    if (!inspected || inspected.ok !== true) {
      const error = inspected && ERROR_CODES.has(inspected.error) ? inspected.error : 'missing';
      state = error;
      detail = null;
    }
    return publicStatus();
  }

  return {
    on: (event, handler) => emitter.on(event, handler),
    off: (event, handler) => emitter.off(event, handler),
    status,
    start,
    run,
    restart,
    stop,
  };
}

module.exports = {
  PROTOCOL_VERSION,
  MAX_LINE_BYTES,
  ALLOWED_ACTIONS,
  NativeHelperError,
  validateAction,
  parseIncomingLine,
  inspectPackagedHelper,
  minimalChildEnvironment,
  createNativeHelperManager,
};
