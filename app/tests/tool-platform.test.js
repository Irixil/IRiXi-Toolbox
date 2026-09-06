const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  MAX_PACKAGE_BYTES,
  ToolPackageError,
  parseToolPackage,
  createToolPlatform,
} = require('../tool-platform');

const sampleBytes = fs.readFileSync(path.join(__dirname, '..', 'bundled-tools', 'sample-counter.irixi-tool'));

function tempPlatform(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'irixi-tool-platform-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  return { rootDir, platform: createToolPlatform({ rootDir, hostVersion: '0.3.0' }) };
}

function packageWith(changes = {}) {
  const sample = JSON.parse(sampleBytes.toString('utf8'));
  return Buffer.from(JSON.stringify({ ...sample, ...changes }));
}

function hasCode(code) {
  return (error) => error instanceof ToolPackageError && error.code === code;
}

test('the bundled counter installs, persists, stops while disabled and resumes with its data', (t) => {
  const { platform } = tempPlatform(t);
  assert.equal(platform.preview(sampleBytes).network, false);
  assert.equal(platform.install(sampleBytes).enabled, true);
  assert.deepEqual(platform.runAction('sample.counter', 'add'), { count: 1 });
  platform.setEnabled('sample.counter', false);
  assert.throws(() => platform.getState('sample.counter'), hasCode('tool_disabled'));
  platform.setEnabled('sample.counter', true);
  assert.deepEqual(platform.getState('sample.counter'), { count: 1 });
  assert.throws(() => platform.install(sampleBytes), hasCode('already_installed'));
});

test('malformed, oversized, remote, over-permissioned and incompatible packages are rejected', () => {
  assert.throws(() => parseToolPackage(Buffer.from('{broken'), '0.3.0'), hasCode('invalid_json'));
  assert.throws(() => parseToolPackage(Buffer.alloc(MAX_PACKAGE_BYTES + 1), '0.3.0'), hasCode('package_too_large'));
  assert.throws(() => parseToolPackage(packageWith({ homepage: 'https://example.com' }), '0.3.0'), hasCode('unsupported_field'));
  assert.throws(() => parseToolPackage(packageWith({ description: 'https://example.com/tool' }), '0.3.0'), hasCode('remote_reference'));
  assert.throws(() => parseToolPackage(packageWith({ capabilities: ['storage', 'network'] }), '0.3.0'), hasCode('unsupported_capability'));
  assert.throws(() => parseToolPackage(packageWith({ minimumHostVersion: '9.0.0' }), '0.3.0'), hasCode('incompatible_host'));
  assert.throws(() => parseToolPackage(packageWith({ script: 'rm -rf /' }), '0.3.0'), hasCode('unsupported_field'));
});

test('package ids cannot escape the private tool directories', () => {
  assert.throws(() => parseToolPackage(packageWith({ id: '../../outside' }), '0.3.0'), hasCode('invalid_id'));
  assert.throws(() => parseToolPackage(packageWith({ id: 'UpperCase' }), '0.3.0'), hasCode('invalid_id'));
});

test('uninstall can keep or delete only this tool data', (t) => {
  const { rootDir, platform } = tempPlatform(t);
  platform.install(sampleBytes);
  platform.runAction('sample.counter', 'add');
  assert.equal(platform.uninstall('sample.counter', true).keptData, true);
  platform.install(sampleBytes);
  assert.deepEqual(platform.getState('sample.counter'), { count: 1 });
  assert.equal(platform.uninstall('sample.counter', false).keptData, false);
  platform.install(sampleBytes);
  assert.deepEqual(platform.getState('sample.counter'), { count: 0 });
  assert.equal(fs.existsSync(path.join(rootDir, 'data', 'sample.counter.json')), false);
});

test('a damaged registry fails closed without rewriting it', (t) => {
  const { rootDir, platform } = tempPlatform(t);
  fs.mkdirSync(rootDir, { recursive: true });
  const registryPath = path.join(rootDir, 'registry.json');
  fs.writeFileSync(registryPath, '{not-json');
  assert.throws(() => platform.list(), hasCode('storage_invalid'));
  assert.equal(fs.readFileSync(registryPath, 'utf8'), '{not-json');
});
