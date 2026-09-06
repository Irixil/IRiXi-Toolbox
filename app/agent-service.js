'use strict';

const http = require('http');
const path = require('path');
const { spawn: spawnProcess } = require('child_process');

const HTTP_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const READY_TIMEOUT_MS = 10_000;
const MAX_READY_LINE_BYTES = 64 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WATCHING_TASK_STATES = new Set(['queued', 'running', 'resuming', 'stopping']);
const NOTIFYING_TASK_STATES = new Set(['waiting_user', 'succeeded', 'partial', 'failed', 'cancelled']);

function classifyAgentTaskForWatch(task) {
  const id = typeof task?.id === 'string' && UUID_PATTERN.test(task.id) ? task.id.toLowerCase() : null;
  const status = typeof task?.status === 'string' ? task.status : '';
  if (!id) return { action: 'stop', id: null, status: '' };
  if (WATCHING_TASK_STATES.has(status)) return { action: 'watch', id, status };
  if (NOTIFYING_TASK_STATES.has(status)) {
    const seq = Number.isSafeInteger(task.seq) && task.seq >= 0 ? task.seq : 0;
    return { action: 'notify', id, status, seq, signal: `${id}:${seq}:${status}` };
  }
  return { action: 'stop', id, status };
}

function normalizeReminderSettings(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const endTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(source.endTime) ? source.endTime : '18:00';
  const lead = Number(source.leadMinutes);
  const snoozed = Number(source.snoozedUntil);
  return {
    enabled: source.enabled !== false,
    endTime,
    leadMinutes: Number.isInteger(lead) && lead >= 0 && lead <= 240 ? lead : 15,
    skippedDate: typeof source.skippedDate === 'string' && DATE_KEY_PATTERN.test(source.skippedDate)
      ? source.skippedDate
      : null,
    snoozedUntil: Number.isSafeInteger(snoozed) && snoozed > 0 ? snoozed : null,
  };
}

function toDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('日期无效。');
  return date;
}

function localDateKey(value = Date.now()) {
  const date = toDate(value);
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function nextReminderAt(input, from = Date.now()) {
  const settings = normalizeReminderSettings(input);
  if (!settings.enabled) return null;
  const now = toDate(from);
  const nowMs = now.getTime();
  if (settings.snoozedUntil && settings.snoozedUntil > nowMs) return settings.snoozedUntil;

  const [hour, minute] = settings.endTime.split(':').map(Number);
  const reminderMinute = (hour * 60 + minute - settings.leadMinutes + 1440) % 1440;
  const candidate = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    Math.floor(reminderMinute / 60),
    reminderMinute % 60,
    0,
    0
  );
  if (candidate.getTime() <= nowMs) candidate.setDate(candidate.getDate() + 1);
  if (settings.skippedDate === localDateKey(candidate)) candidate.setDate(candidate.getDate() + 1);
  return candidate.getTime();
}

function plainPayload(value) {
  const payload = value === undefined ? {} : value;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('Agent 请求参数必须是对象。');
  }
  const prototype = Object.getPrototypeOf(payload);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Agent 请求参数必须是普通对象。');
  }
  return payload;
}

function exactKeys(payload, allowed, required = allowed) {
  const keys = Object.keys(payload);
  const extras = keys.filter((key) => !allowed.includes(key));
  const missing = required.filter((key) => !Object.prototype.hasOwnProperty.call(payload, key));
  if (extras.length || missing.length) throw new TypeError('Agent 请求参数不符合接口定义。');
}

function uuid(value, label = '任务编号') {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new TypeError(`${label}不是有效的 UUID。`);
  return value.toLowerCase();
}

function text(value, max, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label}不能为空。`);
  const cleaned = value.trim();
  if (cleaned.length > max || cleaned.includes('\0')) throw new TypeError(`${label}无效或过长。`);
  return cleaned;
}

function routeFor(action, input) {
  const payload = plainPayload(input);
  if (action === 'current') {
    exactKeys(payload, [], []);
    return { method: 'GET', path: '/api/tasks/current' };
  }
  if (action === 'create') {
    exactKeys(payload, ['workspacePath', 'goal']);
    const workspacePath = text(payload.workspacePath, 4096, '工作区路径');
    if (!path.isAbsolute(workspacePath)) throw new TypeError('工作区路径必须是绝对路径。');
    return { method: 'POST', path: '/api/tasks', body: { workspacePath, goal: text(payload.goal, 2000, '任务') } };
  }

  const taskId = uuid(payload.id);
  if (action === 'get') {
    exactKeys(payload, ['id']);
    return { method: 'GET', path: `/api/tasks/${taskId}` };
  }
  if (action === 'message') {
    exactKeys(payload, ['id', 'messageId', 'text']);
    return {
      method: 'POST',
      path: `/api/tasks/${taskId}/messages`,
      body: { messageId: uuid(payload.messageId, '消息编号'), text: text(payload.text, 8000, '回复') },
    };
  }
  if (action === 'confirm') {
    exactKeys(payload, ['id', 'expectedVersion']);
    if (!Number.isSafeInteger(payload.expectedVersion) || payload.expectedVersion < 1) {
      throw new TypeError('确认版本号无效。');
    }
    return {
      method: 'POST',
      path: `/api/tasks/${taskId}/confirm`,
      body: { expectedVersion: payload.expectedVersion },
    };
  }
  if (['cancel', 'rollback', 'accept', 'continue', 'end'].includes(action)) {
    exactKeys(payload, ['id']);
    return { method: 'POST', path: `/api/tasks/${taskId}/${action}`, body: {} };
  }
  throw new TypeError('不支持的 Agent 操作。');
}

function requestJson(port, route) {
  return new Promise((resolve, reject) => {
    const body = route.body === undefined ? null : Buffer.from(JSON.stringify(route.body));
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      method: route.method,
      path: route.path,
      headers: body ? {
        'content-type': 'application/json',
        'content-length': body.length,
      } : undefined,
    }, (response) => {
      const declaredSize = Number(response.headers['content-length']);
      if (Number.isFinite(declaredSize) && declaredSize > MAX_RESPONSE_BYTES) {
        response.destroy();
        finish(new Error('Agent 服务响应超过 1MB。'));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          response.destroy();
          finish(new Error('Agent 服务响应超过 1MB。'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (settled) return;
        let payload = {};
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          payload = raw ? JSON.parse(raw) : {};
        } catch {
          finish(new Error('Agent 服务返回了无效的 JSON。'));
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const error = new Error(typeof payload.error === 'string' ? payload.error : `Agent 服务请求失败（${response.statusCode}）。`);
          error.status = response.statusCode;
          if (payload.details !== undefined) error.details = payload.details;
          finish(error);
          return;
        }
        finish(null, payload);
      });
      response.on('error', (error) => finish(error));
    });
    request.setTimeout(HTTP_TIMEOUT_MS, () => request.destroy(new Error('Agent 服务请求超时。')));
    request.on('error', (error) => finish(error));
    if (body) request.end(body);
    else request.end();
  });
}

function absoluteOption(value, label) {
  if (typeof value !== 'string' || !value || value.includes('\0') || !path.isAbsolute(value)) {
    throw new TypeError(`${label}必须是绝对路径。`);
  }
  return path.resolve(value);
}

function codexOption(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new TypeError('Codex 路径无效。');
  const cleaned = value.trim();
  if (!path.isAbsolute(cleaned) && !/^[a-z0-9._-]+$/i.test(cleaned)) throw new TypeError('Codex 路径无效。');
  return cleaned;
}

function childEnvironment({ dataDir, codexBinary }) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'ELECTRON_RUN_AS_NODE' || key.startsWith('CLOCKOUT_')) delete env[key];
  }
  return {
    ...env,
    ELECTRON_RUN_AS_NODE: '1',
    CLOCKOUT_HOST: '127.0.0.1',
    CLOCKOUT_PORT: '0',
    CLOCKOUT_DATA_DIR: dataDir,
    CLOCKOUT_RUNNER: 'codex',
    CLOCKOUT_CODEX_BIN: codexBinary,
    CLOCKOUT_ALLOW_LOOPBACK: '1',
  };
}

function createAgentServiceManager(options = {}) {
  const executable = absoluteOption(options.executable, 'Electron 可执行文件');
  const servicePath = absoluteOption(options.servicePath, 'Agent 服务文件');
  const dataDir = absoluteOption(options.dataDir, 'Agent 数据目录');
  const codexBinary = codexOption(options.codexBinary);
  const spawn = options.spawn || spawnProcess;
  if (typeof spawn !== 'function') throw new TypeError('spawn 必须是函数。');

  let state = 'stopped';
  let child = null;
  let port = null;
  let lastError = null;
  let starting = null;

  function status() {
    return {
      state,
      running: state === 'running',
      port: state === 'running' ? port : null,
      pid: child && Number.isInteger(child.pid) ? child.pid : null,
      error: lastError,
    };
  }

  function launch() {
    state = 'starting';
    port = null;
    lastError = null;
    return new Promise((resolve, reject) => {
      let process;
      try {
        process = spawn(executable, [servicePath], {
          cwd: path.dirname(servicePath),
          env: childEnvironment({ dataDir, codexBinary }),
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        state = 'failed';
        lastError = 'Agent 服务无法启动。';
        reject(error);
        return;
      }
      child = process;
      let buffer = '';
      let settled = false;
      const timer = setTimeout(() => fail(new Error('Agent 服务启动超时。')), READY_TIMEOUT_MS);
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(status());
      };
      const fail = (error) => {
        if (settled) return;
        state = 'failed';
        port = null;
        lastError = error.message || 'Agent 服务启动失败。';
        try { process.kill('SIGTERM'); } catch {}
        finish(error);
      };

      process.once('error', (error) => fail(error));
      process.once('exit', (code, signal) => {
        if (child !== process) return;
        child = null;
        port = null;
        if (state === 'stopping') {
          state = 'stopped';
          lastError = null;
        } else {
          state = 'failed';
          lastError = `Agent 服务已停止（${signal || code || 'unknown'}）。`;
        }
        if (!settled) finish(new Error(lastError || 'Agent 服务在就绪前停止。'));
      });
      if (!process.stdout || typeof process.stdout.on !== 'function') {
        fail(new Error('Agent 服务没有可读的启动输出。'));
        return;
      }
      if (process.stderr && typeof process.stderr.resume === 'function') process.stderr.resume();
      process.stdout.on('data', (chunk) => {
        if (settled) return;
        buffer += chunk.toString('utf8');
        if (Buffer.byteLength(buffer) > MAX_READY_LINE_BYTES) {
          fail(new Error('Agent 服务启动输出过长。'));
          return;
        }
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          let ready;
          try { ready = JSON.parse(line); } catch { continue; }
          if (ready.event !== 'clockout-agent-ready') continue;
          if (ready.host !== '127.0.0.1' || !Number.isInteger(ready.port) || ready.port < 1 || ready.port > 65535) {
            fail(new Error('Agent 服务返回了不安全的监听地址。'));
            return;
          }
          port = ready.port;
          state = 'running';
          lastError = null;
          finish();
          return;
        }
      });
    });
  }

  async function start() {
    if (state === 'running') return status();
    if (starting) return starting;
    if (child) await stop();
    starting = launch();
    try {
      return await starting;
    } finally {
      starting = null;
    }
  }

  async function stop() {
    const process = child;
    if (!process) {
      state = 'stopped';
      port = null;
      lastError = null;
      return status();
    }
    state = 'stopping';
    const exited = new Promise((resolve) => process.once('exit', resolve));
    try { process.kill('SIGTERM'); } catch {}
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
    if (child === process) {
      try { process.kill('SIGKILL'); } catch {}
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 500))]);
    }
    if (child === process) child = null;
    state = 'stopped';
    port = null;
    lastError = null;
    return status();
  }

  async function restart() {
    await stop();
    return start();
  }

  async function request(action, payload) {
    const route = routeFor(action, payload);
    if (state !== 'running' || !port) throw new Error('Agent 服务尚未运行。');
    return requestJson(port, route);
  }

  return { status, start, restart, stop, request };
}

module.exports = {
  createAgentServiceManager,
  classifyAgentTaskForWatch,
  normalizeReminderSettings,
  nextReminderAt,
  localDateKey,
};
