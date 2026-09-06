'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  PROTOCOL_VERSION,
  MAX_LINE_BYTES,
  ALLOWED_ACTIONS,
  NativeHelperError,
  validateAction,
  parseIncomingLine,
  minimalChildEnvironment,
  createNativeHelperManager,
} = require('../native-helper-manager');

const FIXED_UUIDS = [
  '123e4567-e89b-42d3-a456-426614174000',
  '223e4567-e89b-42d3-a456-426614174000',
  '323e4567-e89b-42d3-a456-426614174000',
];

function hasCode(code) {
  return (error) => error instanceof NativeHelperError && error.code === code;
}

function fakeChild({ respond = true } = {}) {
  const child = new EventEmitter();
  const requests = [];
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kills = [];
  child.stdin = {
    destroyed: false,
    write(line, callback) {
      const request = JSON.parse(line);
      requests.push(request);
      if (callback) callback(null);
      if (respond) {
        queueMicrotask(() => child.stdout.write(`${JSON.stringify({
          v: PROTOCOL_VERSION,
          id: request.id,
          status: 'completed',
        })}\n`));
      }
      return true;
    },
  };
  child.kill = (signal) => {
    child.kills.push(signal);
    queueMicrotask(() => child.emit('exit', 0, signal));
    return true;
  };
  return { child, requests };
}

function uuidSource() {
  let index = 0;
  return () => FIXED_UUIDS[index++] || `423e4567-e89b-42d3-a456-42661417400${index}`;
}

test('the action list is fixed and every argument shape rejects extra fields', () => {
  assert.deepEqual([...ALLOWED_ACTIONS].sort(), [
    'cancel',
    'capture.area',
    'capture.fullscreen',
    'capture.ocr',
    'capture.translate',
    'capture.window',
    'health',
    'history.open',
    'record.area',
    'record.fullscreen',
    'record.stop',
    'translation.capture',
    'translation.input.open',
    'translation.replaceSelection',
    'translation.selection',
    'translation.settings.open',
    'translation.speak.result',
    'translation.speak.source',
    'translation.speech.pause',
    'translation.speech.resume',
    'translation.speech.stop',
  ]);
  assert.deepEqual(validateAction('translation.input.open', { partner: 'ja' }), { partner: 'ja' });
  assert.deepEqual(validateAction('capture.area', {}), {});
  assert.deepEqual(validateAction('capture.window', {}), {});
  assert.deepEqual(validateAction('capture.fullscreen', {}), {});
  assert.deepEqual(validateAction('capture.ocr', {}), {});
  assert.deepEqual(validateAction('capture.translate', { target: 'zh-CN' }), { target: 'zh-CN' });
  assert.deepEqual(validateAction('record.fullscreen', { display: 'current', microphone: false }), {
    display: 'current', microphone: false,
  });
  assert.throws(() => validateAction('shell', {}), hasCode('invalid_action'));
  assert.throws(() => validateAction('capture.area', { path: '/tmp/a' }), hasCode('invalid_args'));
  assert.throws(() => validateAction('capture.fullscreen', { display: 'current' }), hasCode('invalid_args'));
  assert.throws(() => validateAction('capture.ocr', { text: 'private OCR result' }), hasCode('invalid_args'));
  assert.throws(() => validateAction('capture.translate', { partner: 'zh-CN' }), hasCode('invalid_args'));
  assert.throws(() => validateAction('capture.translate', { target: 'en' }), hasCode('invalid_args'));
  assert.throws(() => validateAction('capture.translate', { target: 'zh-CN', path: '/tmp/a' }), hasCode('invalid_args'));
  assert.throws(() => validateAction('translation.selection', { partner: 'fr' }), hasCode('invalid_args'));
  assert.throws(() => validateAction('record.area', { microphone: true, command: 'open' }), hasCode('invalid_args'));
  assert.throws(() => validateAction('cancel', { requestId: '../escape' }), hasCode('invalid_args'));
});

test('incoming JSONL accepts only fixed response and state fields', () => {
  assert.deepEqual(parseIncomingLine(JSON.stringify({
    v: 1, id: FIXED_UUIDS[0], status: 'completed',
  })), {
    type: 'response', id: FIXED_UUIDS[0], status: 'completed', code: undefined,
  });
  assert.deepEqual(parseIncomingLine('{"v":1,"event":"state","state":"busy"}'), {
    type: 'event', state: 'busy',
  });
  assert.throws(() => parseIncomingLine('{broken'), hasCode('protocol_error'));
  assert.throws(() => parseIncomingLine(JSON.stringify({
    v: 1, id: FIXED_UUIDS[0], status: 'completed', path: '/tmp/result',
  })), hasCode('protocol_error'));
  assert.throws(() => parseIncomingLine(JSON.stringify({
    v: 1, id: FIXED_UUIDS[0], status: 'failed', code: 'secret text',
  })), hasCode('protocol_error'));
  assert.throws(() => parseIncomingLine('x'.repeat(MAX_LINE_BYTES + 1)), hasCode('protocol_error'));
});

test('a missing helper is reported without spawning or affecting other tools', async () => {
  let spawns = 0;
  const manager = createNativeHelperManager({
    inspector: () => ({ ok: false, error: 'missing' }),
    spawn: () => { spawns += 1; },
  });
  assert.deepEqual(manager.status(), { state: 'missing' });
  assert.deepEqual(await manager.run('capture.area', {}), { ok: false, error: 'missing' });
  assert.equal(spawns, 0);
});

test('the manager spawns one fixed child with pipes and sends exact JSONL', async (t) => {
  const spawned = [];
  const fake = fakeChild();
  const manager = createNativeHelperManager({
    inspector: () => ({ ok: true, executablePath: '/fixed/IRiXi Native Helper' }),
    spawn: (executable, args, options) => {
      spawned.push({ executable, args, options });
      return fake.child;
    },
    randomUUID: uuidSource(),
  });
  t.after(() => manager.stop());

  assert.deepEqual(await manager.run('capture.area', {}), { ok: true });
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].executable, '/fixed/IRiXi Native Helper');
  assert.deepEqual(spawned[0].args, []);
  assert.deepEqual(spawned[0].options.stdio, ['pipe', 'pipe', 'pipe']);
  assert.equal(spawned[0].options.detached, false);
  assert.equal(spawned[0].options.shell, undefined);
  assert.deepEqual(fake.requests, [
    { v: 1, id: FIXED_UUIDS[0], action: 'health', args: {} },
    { v: 1, id: FIXED_UUIDS[1], action: 'capture.area', args: {} },
  ]);
  assert.deepEqual(manager.status(), { state: 'ready' });
});

test('the child receives a minimal environment without API secrets', () => {
  const env = minimalChildEnvironment({
    HOME: '/Users/test',
    USER: 'test',
    TMPDIR: '/tmp/test',
    OPENAI_API_KEY: 'secret',
    ANTHROPIC_API_KEY: 'secret',
    PATH: '/unsafe',
  });
  assert.deepEqual(env, {
    PATH: '/usr/bin:/bin',
    LANG: 'en_US.UTF-8',
    HOME: '/Users/test',
    USER: 'test',
    TMPDIR: '/tmp/test',
  });
});

test('an unexpected exit never restarts until restart is called', async (t) => {
  const children = [];
  const manager = createNativeHelperManager({
    inspector: () => ({ ok: true, executablePath: '/fixed/helper' }),
    spawn: () => {
      const fake = fakeChild();
      children.push(fake);
      return fake.child;
    },
    randomUUID: uuidSource(),
  });
  t.after(() => manager.stop());

  assert.deepEqual(await manager.start(), { ok: true });
  children[0].child.emit('exit', 1, null);
  assert.deepEqual(manager.status(), { state: 'crashed' });
  assert.equal(children.length, 1);
  assert.deepEqual(await manager.restart(), { ok: true });
  assert.equal(children.length, 2);
});

test('parent validation diagnostics keep only the fixed reason code', async () => {
  const fake = fakeChild({ respond: false });
  const warnings = [];
  const manager = createNativeHelperManager({
    inspector: () => ({ ok: true, executablePath: '/fixed/helper' }),
    spawn: () => fake.child,
    randomUUID: uuidSource(),
    logger: { warn: (message) => warnings.push(message) },
    responseTimeoutMs: 1000,
  });
  const pendingStart = manager.start();
  fake.child.stderr.write('/Users/private/secret\nparent_validation:parent_path_mismatch\n');
  fake.child.emit('exit', 1, null);
  assert.deepEqual(await pendingStart, { ok: false, error: 'failed' });
  assert.deepEqual(manager.status(), { state: 'crashed', detail: 'parent_validation:parent_path_mismatch' });
  assert.deepEqual(warnings, ['[native-helper] parent_validation:parent_path_mismatch']);
});

test('a repeated request UUID is rejected within one helper run', async (t) => {
  const fake = fakeChild();
  const manager = createNativeHelperManager({
    inspector: () => ({ ok: true, executablePath: '/fixed/helper' }),
    spawn: () => fake.child,
    randomUUID: () => FIXED_UUIDS[0],
  });
  t.after(() => manager.stop());

  assert.deepEqual(await manager.start(), { ok: true });
  assert.deepEqual(await manager.run('capture.area', {}), { ok: false, error: 'duplicate' });
  assert.deepEqual(fake.requests.map((request) => request.action), ['health']);
});

test('silence and oversized output fail closed and stop the child', async () => {
  const silent = fakeChild({ respond: false });
  const timeoutManager = createNativeHelperManager({
    inspector: () => ({ ok: true, executablePath: '/fixed/helper' }),
    spawn: () => silent.child,
    randomUUID: uuidSource(),
    responseTimeoutMs: 10,
  });
  assert.deepEqual(await timeoutManager.start(), { ok: false, error: 'timeout' });
  assert.deepEqual(silent.child.kills, ['SIGTERM']);

  const oversized = fakeChild({ respond: false });
  const protocolManager = createNativeHelperManager({
    inspector: () => ({ ok: true, executablePath: '/fixed/helper' }),
    spawn: () => oversized.child,
    randomUUID: uuidSource(),
    responseTimeoutMs: 1000,
  });
  const pendingStart = protocolManager.start();
  oversized.child.stdout.write(Buffer.alloc(MAX_LINE_BYTES + 1, 0x61));
  assert.deepEqual(await pendingStart, { ok: false, error: 'protocol_error' });
  assert.deepEqual(protocolManager.status(), { state: 'failed', detail: 'protocol_error' });
  assert.deepEqual(oversized.child.kills, ['SIGTERM']);
});

test('third-party tools keep storage-only capability and the app exposes no helper IPC', () => {
  const root = path.join(__dirname, '..');
  const toolSource = fs.readFileSync(path.join(root, 'tool-platform.js'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  const managerSource = fs.readFileSync(path.join(root, 'native-helper-manager.js'), 'utf8');
  const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

  assert.match(toolSource, /const ALLOWED_CAPABILITIES = new Set\(\['storage'\]\)/);
  assert.doesNotMatch(toolSource, /native-helper|nativeHelper|spawn\(|execFile/);
  assert.doesNotMatch(preloadSource, /native-helper:status|native-helper:run|native-helper:restart/);
  assert.doesNotMatch(preloadSource, /helperPath|stdin|stdout|spawn/);
  assert.match(mainSource, /event\.sender === mainWindow\.webContents/);
  assert.doesNotMatch(mainSource, /createNativeHelperManager|native-helper:/);
  assert.doesNotMatch(mainSource, /app\.getSystemVersion\(/);
  assert.doesNotMatch(managerSource, /createServer|\.listen\(|WebSocket|node:http|node:net/);
});
