'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const {
  createAgentServiceManager,
  classifyAgentTaskForWatch,
  normalizeReminderSettings,
  nextReminderAt,
  localDateKey,
} = require('../agent-service');

const TASK_ID = '123e4567-e89b-42d3-a456-426614174000';
const MESSAGE_ID = '223e4567-e89b-42d3-a456-426614174000';

test('task watch classification only polls active execution and emits one stable terminal signal', () => {
  for (const status of ['queued', 'running', 'resuming', 'stopping']) {
    assert.deepEqual(classifyAgentTaskForWatch({ id: TASK_ID, status }), {
      action: 'watch', id: TASK_ID, status,
    });
  }
  for (const status of ['waiting_user', 'succeeded', 'partial', 'failed', 'cancelled']) {
    assert.deepEqual(classifyAgentTaskForWatch({ id: TASK_ID, status, seq: 8 }), {
      action: 'notify',
      id: TASK_ID,
      status,
      seq: 8,
      signal: `${TASK_ID}:8:${status}`,
    });
  }
  assert.equal(classifyAgentTaskForWatch({ id: TASK_ID, status: 'clarifying' }).action, 'stop');
  assert.equal(classifyAgentTaskForWatch({ id: '../escape', status: 'running' }).action, 'stop');
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function fakeSpawner(port, calls) {
  return (executable, args, options) => {
    calls.push({ executable, args, options });
    const child = new EventEmitter();
    child.pid = 4242 + calls.length;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = (signal) => {
      queueMicrotask(() => child.emit('exit', 0, signal));
      return true;
    };
    queueMicrotask(() => child.stdout.write(`${JSON.stringify({
      event: 'clockout-agent-ready',
      host: '127.0.0.1',
      port,
      pairCode: 'never-expose-this',
    })}\n`));
    return child;
  };
}

function manager(port, calls = []) {
  return createAgentServiceManager({
    executable: '/Applications/Test Electron.app/Contents/MacOS/Electron',
    servicePath: '/tmp/agent-service/server.mjs',
    dataDir: '/tmp/agent-service/data',
    codexBinary: 'codex',
    spawn: fakeSpawner(port, calls),
  });
}

test('reminder helpers normalize settings and calculate the next local reminder', () => {
  assert.deepEqual(normalizeReminderSettings({
    enabled: true,
    endTime: '18:00',
    leadMinutes: '15',
    skippedDate: '2026-08-31',
    snoozedUntil: 123,
  }), {
    enabled: true,
    endTime: '18:00',
    leadMinutes: 15,
    skippedDate: '2026-08-31',
    snoozedUntil: 123,
  });
  assert.deepEqual(normalizeReminderSettings({ endTime: '99:00', leadMinutes: 999 }), {
    enabled: true,
    endTime: '18:00',
    leadMinutes: 15,
    skippedDate: null,
    snoozedUntil: null,
  });

  const before = new Date(2026, 7, 31, 17, 44, 0, 0);
  const expected = new Date(2026, 7, 31, 17, 45, 0, 0);
  assert.equal(localDateKey(before), '2026-08-31');
  assert.equal(nextReminderAt({ endTime: '18:00', leadMinutes: 15 }, before), expected.getTime());

  const snoozedUntil = before.getTime() + 20 * 60 * 1000;
  assert.equal(nextReminderAt({ snoozedUntil }, before), snoozedUntil);
  assert.equal(nextReminderAt({ enabled: false, snoozedUntil }, before), null);
  assert.equal(
    nextReminderAt({ endTime: '18:00', leadMinutes: 15, skippedDate: '2026-08-31' }, before),
    new Date(2026, 8, 1, 17, 45, 0, 0).getTime()
  );
});

test('manager starts the local-only service without exposing its pair code', async (t) => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ task: null }));
  });
  const port = await listen(server);
  t.after(() => close(server));
  const calls = [];
  const service = manager(port, calls);
  t.after(() => service.stop());

  const running = await service.start();
  assert.equal(running.state, 'running');
  assert.equal(JSON.stringify(running).includes('never-expose-this'), false);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['/tmp/agent-service/server.mjs']);
  assert.equal(calls[0].options.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(calls[0].options.env.CLOCKOUT_HOST, '127.0.0.1');
  assert.equal(calls[0].options.env.CLOCKOUT_PORT, '0');
  assert.equal(calls[0].options.env.CLOCKOUT_ALLOW_LOOPBACK, '1');
  assert.deepEqual(await service.request('current'), { task: null });
});

test('request exposes only the fixed action routes with exact payloads', async (t) => {
  const received = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      received.push({ method: request.method, path: request.url, body: raw ? JSON.parse(raw) : null });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"ok":true}');
    });
  });
  const port = await listen(server);
  t.after(() => close(server));
  const service = manager(port);
  await service.start();
  t.after(() => service.stop());

  await service.request('create', { workspacePath: '/tmp/workspace', goal: '完成交接' });
  await service.request('get', { id: TASK_ID });
  await service.request('message', { id: TASK_ID, messageId: MESSAGE_ID, text: '继续' });
  await service.request('confirm', { id: TASK_ID, expectedVersion: 3 });
  for (const action of ['cancel', 'rollback', 'accept', 'continue', 'end']) {
    await service.request(action, { id: TASK_ID });
  }

  assert.deepEqual(received.map(({ method, path }) => `${method} ${path}`), [
    'POST /api/tasks',
    `GET /api/tasks/${TASK_ID}`,
    `POST /api/tasks/${TASK_ID}/messages`,
    `POST /api/tasks/${TASK_ID}/confirm`,
    `POST /api/tasks/${TASK_ID}/cancel`,
    `POST /api/tasks/${TASK_ID}/rollback`,
    `POST /api/tasks/${TASK_ID}/accept`,
    `POST /api/tasks/${TASK_ID}/continue`,
    `POST /api/tasks/${TASK_ID}/end`,
  ]);
  assert.deepEqual(received[2].body, { messageId: MESSAGE_ID, text: '继续' });
  assert.deepEqual(received[3].body, { expectedVersion: 3 });
});

test('request rejects unknown actions, malformed UUIDs, and extra fields before HTTP', async (t) => {
  let requests = 0;
  const server = http.createServer((_request, response) => {
    requests += 1;
    response.end('{}');
  });
  const port = await listen(server);
  t.after(() => close(server));
  const service = manager(port);
  await service.start();
  t.after(() => service.stop());

  await assert.rejects(service.request('delete', { id: TASK_ID }), /不支持|接口定义/);
  await assert.rejects(service.request('get', { id: '../escape' }), /UUID/);
  await assert.rejects(service.request('current', { id: TASK_ID }), /接口定义/);
  await assert.rejects(service.request('create', { workspacePath: 'relative', goal: 'x' }), /绝对路径/);
  await assert.rejects(service.request('message', { id: TASK_ID, messageId: 'not-a-uuid', text: 'x' }), /UUID/);
  await assert.rejects(service.request('confirm', { id: TASK_ID, expectedVersion: 0 }), /版本号/);
  await assert.rejects(service.request('cancel', { id: TASK_ID, extra: true }), /接口定义/);
  assert.equal(requests, 0);
});

test('response bodies over 1MB are rejected', async (t) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ value: 'x'.repeat(1024 * 1024) }));
  });
  const port = await listen(server);
  t.after(() => close(server));
  const service = manager(port);
  await service.start();
  t.after(() => service.stop());
  await assert.rejects(service.request('current'), /超过 1MB/);
});

test('an unexpected exit waits for an explicit restart', async () => {
  const calls = [];
  let spawnedChild;
  const spawn = (...args) => {
    spawnedChild = fakeSpawner(43210, calls)(...args);
    return spawnedChild;
  };
  const service = createAgentServiceManager({
    executable: '/tmp/electron',
    servicePath: '/tmp/server.mjs',
    dataDir: '/tmp/data',
    codexBinary: '/tmp/codex',
    spawn,
  });
  await service.start();
  spawnedChild.emit('exit', 1, null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.status().state, 'failed');
  assert.equal(calls.length, 1);
  await service.restart();
  assert.equal(service.status().state, 'running');
  assert.equal(calls.length, 2);
  await service.stop();
});
