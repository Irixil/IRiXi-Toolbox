'use strict';

const fs = require('fs');
const path = require('path');

const PACKAGE_SCHEMA_VERSION = 1;
const REGISTRY_SCHEMA_VERSION = 1;
const MAX_PACKAGE_BYTES = 128 * 1024;
const TOOL_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const TOP_LEVEL_KEYS = new Set([
  'schemaVersion',
  'id',
  'name',
  'author',
  'version',
  'minimumHostVersion',
  'description',
  'capabilities',
  'ui',
  'actions',
]);
const UI_KEYS = new Set(['type', 'title', 'emptyText']);
const ACTION_KEYS = new Set(['id', 'label', 'operation', 'amount']);
const ALLOWED_CAPABILITIES = new Set(['storage']);
const ALLOWED_ACTION_OPERATIONS = new Set(['increment', 'set']);

class ToolPackageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ToolPackageError';
    this.code = code;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, code, message) {
  if (!isPlainObject(value)) throw new ToolPackageError(code, message);
}

function assertOnlyKeys(value, allowed, code, message) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new ToolPackageError(code, `${message}：${unknown.join('、')}`);
}

function requiredString(value, name, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new ToolPackageError('invalid_manifest', `${name}缺失或过长。`);
  }
  return value.trim();
}

function parseVersion(value, name = '版本') {
  const text = requiredString(value, name, 32);
  const match = VERSION_PATTERN.exec(text);
  if (!match) throw new ToolPackageError('invalid_version', `${name}必须写成 1.2.3。`);
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

function rejectRemoteReferences(value) {
  if (typeof value === 'string' && /(?:https?:\/\/|file:\/\/|data:text\/html|javascript:)/i.test(value)) {
    throw new ToolPackageError('remote_reference', '第一版工具包不能包含网址或可执行地址。');
  }
  if (Array.isArray(value)) value.forEach(rejectRemoteReferences);
  else if (isPlainObject(value)) Object.values(value).forEach(rejectRemoteReferences);
}

function normalizeManifest(input, hostVersion) {
  assertPlainObject(input, 'invalid_manifest', '工具包内容必须是一个 JSON 对象。');
  assertOnlyKeys(input, TOP_LEVEL_KEYS, 'unsupported_field', '工具包包含第一版不支持的字段');
  rejectRemoteReferences(input);

  if (input.schemaVersion !== PACKAGE_SCHEMA_VERSION) {
    throw new ToolPackageError('unsupported_schema', '这个工具包格式与当前版本不兼容。');
  }

  const id = requiredString(input.id, '工具 ID', 80);
  if (!TOOL_ID_PATTERN.test(id)) {
    throw new ToolPackageError('invalid_id', '工具 ID 只能使用小写字母、数字、点和短横线。');
  }

  const name = requiredString(input.name, '工具名称', 40);
  const author = requiredString(input.author, '作者', 60);
  const version = requiredString(input.version, '工具版本', 32);
  parseVersion(version, '工具版本');
  const minimumHostVersion = requiredString(input.minimumHostVersion, '最低应用版本', 32);
  const requiredHost = parseVersion(minimumHostVersion, '最低应用版本');
  const currentHost = parseVersion(hostVersion, '当前应用版本');
  if (compareVersions(currentHost, requiredHost) < 0) {
    throw new ToolPackageError('incompatible_host', `需要 IRiXi的小工具库 ${minimumHostVersion} 或更高版本。`);
  }

  const description = requiredString(input.description, '用途说明', 240);
  if (!Array.isArray(input.capabilities) || input.capabilities.length !== 1) {
    throw new ToolPackageError('unsupported_capability', '第一版工具只能申请本工具存储能力。');
  }
  const capabilities = [...new Set(input.capabilities)];
  if (capabilities.some((item) => typeof item !== 'string' || !ALLOWED_CAPABILITIES.has(item))) {
    throw new ToolPackageError('unsupported_capability', '这个工具申请了第一版不开放的能力。');
  }

  assertPlainObject(input.ui, 'invalid_ui', '界面描述无效。');
  assertOnlyKeys(input.ui, UI_KEYS, 'unsupported_ui', '界面描述包含不支持的字段');
  if (input.ui.type !== 'counter') {
    throw new ToolPackageError('unsupported_ui', '第一版只支持计数器示例界面。');
  }
  const ui = {
    type: 'counter',
    title: requiredString(input.ui.title, '界面标题', 50),
    emptyText: requiredString(input.ui.emptyText, '初始提示', 100),
  };

  if (!Array.isArray(input.actions) || input.actions.length < 1 || input.actions.length > 6) {
    throw new ToolPackageError('invalid_actions', '工具操作数量无效。');
  }
  const actionIds = new Set();
  const actions = input.actions.map((action) => {
    assertPlainObject(action, 'invalid_action', '工具操作必须是对象。');
    assertOnlyKeys(action, ACTION_KEYS, 'unsupported_action', '工具操作包含不支持的字段');
    const actionId = requiredString(action.id, '操作 ID', 40);
    if (!TOOL_ID_PATTERN.test(actionId) || actionIds.has(actionId)) {
      throw new ToolPackageError('invalid_action', '操作 ID 无效或重复。');
    }
    actionIds.add(actionId);
    const operation = requiredString(action.operation, '操作类型', 20);
    if (!ALLOWED_ACTION_OPERATIONS.has(operation)) {
      throw new ToolPackageError('unsupported_action', '工具包含不允许执行的操作。');
    }
    if (!Number.isSafeInteger(action.amount) || Math.abs(action.amount) > 1000) {
      throw new ToolPackageError('invalid_action', '操作数值无效。');
    }
    if (operation === 'increment' && action.amount === 0) {
      throw new ToolPackageError('invalid_action', '增加操作不能为 0。');
    }
    return {
      id: actionId,
      label: requiredString(action.label, '操作名称', 20),
      operation,
      amount: action.amount,
    };
  });

  return {
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    id,
    name,
    author,
    version,
    minimumHostVersion,
    description,
    capabilities,
    ui,
    actions,
  };
}

function parseToolPackage(bytes, hostVersion) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes || ''), 'utf8');
  if (!buffer.length) throw new ToolPackageError('empty_package', '工具包是空的。');
  if (buffer.length > MAX_PACKAGE_BYTES) {
    throw new ToolPackageError('package_too_large', '工具包超过第一版允许的大小。');
  }
  let parsed;
  try {
    parsed = JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    throw new ToolPackageError('invalid_json', '工具包内容损坏，无法读取。');
  }
  return normalizeManifest(parsed, hostVersion);
}

function defaultRegistry() {
  return { schemaVersion: REGISTRY_SCHEMA_VERSION, tools: {} };
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return fallback;
    throw new ToolPackageError('storage_invalid', '工具资料无法读取，请保留现场后重试。');
  }
}

function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try { fs.unlinkSync(temporaryPath); } catch (cleanupError) {}
    throw new ToolPackageError('storage_write_failed', '保存工具资料失败，旧内容未被替换。');
  }
}

function validateRegistry(value) {
  if (!isPlainObject(value) || value.schemaVersion !== REGISTRY_SCHEMA_VERSION || !isPlainObject(value.tools)) {
    throw new ToolPackageError('registry_invalid', '工具登记表损坏，现有工具暂时不会启动。');
  }
  return value;
}

function publicTool(record) {
  return {
    id: record.manifest.id,
    name: record.manifest.name,
    author: record.manifest.author,
    version: record.manifest.version,
    description: record.manifest.description,
    capabilities: [...record.manifest.capabilities],
    ui: { ...record.manifest.ui },
    actions: record.manifest.actions.map((action) => ({ ...action })),
    enabled: record.enabled === true,
    kind: 'installed',
    installedAt: record.installedAt,
  };
}

function createToolPlatform({ rootDir, hostVersion }) {
  if (!path.isAbsolute(rootDir)) throw new TypeError('rootDir must be absolute');
  parseVersion(hostVersion, '当前应用版本');
  const registryPath = path.join(rootDir, 'registry.json');
  const packagesDir = path.join(rootDir, 'packages');
  const dataDir = path.join(rootDir, 'data');

  function loadRegistry() {
    const stored = readJson(registryPath, null);
    return stored === null ? defaultRegistry() : validateRegistry(stored);
  }

  function saveRegistry(registry) {
    writeJsonAtomic(registryPath, validateRegistry(registry));
  }

  function packagePath(toolId) {
    if (!TOOL_ID_PATTERN.test(toolId)) throw new ToolPackageError('invalid_id', '工具 ID 无效。');
    return path.join(packagesDir, `${toolId}.irixi-tool`);
  }

  function dataPath(toolId) {
    if (!TOOL_ID_PATTERN.test(toolId)) throw new ToolPackageError('invalid_id', '工具 ID 无效。');
    return path.join(dataDir, `${toolId}.json`);
  }

  function list() {
    const registry = loadRegistry();
    return Object.values(registry.tools)
      .map(publicTool)
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
  }

  function preview(bytes) {
    const manifest = parseToolPackage(bytes, hostVersion);
    return {
      id: manifest.id,
      name: manifest.name,
      author: manifest.author,
      version: manifest.version,
      description: manifest.description,
      capabilities: [...manifest.capabilities],
      saves: '只保存这个工具自己的少量内容',
      network: false,
      systemAccess: false,
    };
  }

  function install(bytes, source = 'bundled') {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes || ''), 'utf8');
    const manifest = parseToolPackage(buffer, hostVersion);
    const registry = loadRegistry();
    if (registry.tools[manifest.id]) {
      throw new ToolPackageError('already_installed', '这个工具已经安装。');
    }
    const now = new Date().toISOString();
    const record = { manifest, enabled: true, source, installedAt: now, updatedAt: now };
    const destination = packagePath(manifest.id);
    const temporaryPath = `${destination}.${process.pid}.${Date.now()}.tmp`;
    fs.mkdirSync(packagesDir, { recursive: true });
    try {
      fs.writeFileSync(temporaryPath, buffer, { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporaryPath, destination);
      registry.tools[manifest.id] = record;
      saveRegistry(registry);
    } catch (error) {
      try { fs.unlinkSync(temporaryPath); } catch (cleanupError) {}
      try { fs.unlinkSync(destination); } catch (cleanupError) {}
      if (error instanceof ToolPackageError) throw error;
      throw new ToolPackageError('install_failed', '安装没有完成，原有工具未受影响。');
    }
    return publicTool(record);
  }

  function setEnabled(toolId, enabled) {
    if (typeof enabled !== 'boolean') throw new ToolPackageError('invalid_state', '工具开关状态无效。');
    const registry = loadRegistry();
    const record = registry.tools[toolId];
    if (!record) throw new ToolPackageError('not_installed', '没有找到这个工具。');
    record.enabled = enabled;
    record.updatedAt = new Date().toISOString();
    saveRegistry(registry);
    return publicTool(record);
  }

  function getState(toolId) {
    const registry = loadRegistry();
    const record = registry.tools[toolId];
    if (!record) throw new ToolPackageError('not_installed', '没有找到这个工具。');
    if (!record.enabled) throw new ToolPackageError('tool_disabled', '这个工具已停用。');
    const state = readJson(dataPath(toolId), { count: 0 });
    if (!isPlainObject(state) || !Number.isSafeInteger(state.count)) {
      throw new ToolPackageError('tool_data_invalid', '这个工具的内容损坏，其他工具未受影响。');
    }
    return { count: state.count };
  }

  function runAction(toolId, actionId) {
    const registry = loadRegistry();
    const record = registry.tools[toolId];
    if (!record) throw new ToolPackageError('not_installed', '没有找到这个工具。');
    if (!record.enabled) throw new ToolPackageError('tool_disabled', '这个工具已停用。');
    const action = record.manifest.actions.find((candidate) => candidate.id === actionId);
    if (!action) throw new ToolPackageError('action_denied', '这个操作没有得到工具包声明。');
    const current = getState(toolId);
    const count = action.operation === 'set' ? action.amount : current.count + action.amount;
    if (!Number.isSafeInteger(count) || Math.abs(count) > 1_000_000_000) {
      throw new ToolPackageError('value_out_of_range', '计数结果超出允许范围。');
    }
    const next = { count };
    writeJsonAtomic(dataPath(toolId), next);
    return next;
  }

  function uninstall(toolId, keepData) {
    if (typeof keepData !== 'boolean') throw new ToolPackageError('invalid_state', '请选择是否保留工具内容。');
    const registry = loadRegistry();
    if (!registry.tools[toolId]) throw new ToolPackageError('not_installed', '这个工具已经不在工具库中。');
    delete registry.tools[toolId];
    saveRegistry(registry);
    try { fs.unlinkSync(packagePath(toolId)); } catch (error) {
      if (!error || error.code !== 'ENOENT') return { ok: true, cleanupPending: true, keptData: keepData };
    }
    if (!keepData) {
      try { fs.unlinkSync(dataPath(toolId)); } catch (error) {
        if (!error || error.code !== 'ENOENT') return { ok: true, cleanupPending: true, keptData: false };
      }
    }
    return { ok: true, cleanupPending: false, keptData: keepData };
  }

  return { list, preview, install, setEnabled, getState, runAction, uninstall };
}

module.exports = {
  MAX_PACKAGE_BYTES,
  ToolPackageError,
  parseToolPackage,
  createToolPlatform,
};
