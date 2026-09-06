'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const FRAMEWORK_NAME = 'IRiXiNativeKit.framework';
const FRAMEWORK_BINARY = 'IRiXiNativeKit';
const FRAMEWORK_BUNDLE_ID = 'com.irixi.toolbox.native-kit';
const MODULE_NAME = 'irixi-native.node';
const EXPECTED_ABI = 6;

function fail(message) {
  throw new Error(message);
}

function requireAbsoluteEnvironmentPath(name) {
  const value = process.env[name];
  if (!value || !path.isAbsolute(value)) fail(`${name} 必须是绝对路径。`);
  return path.normalize(value);
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function assertNoSymlinks(rootPath) {
  const stat = fs.lstatSync(rootPath);
  if (stat.isSymbolicLink()) fail(`不接受符号链接：${rootPath}`);
  if (!stat.isDirectory()) return;
  for (const entry of fs.readdirSync(rootPath)) assertNoSymlinks(path.join(rootPath, entry));
}

function plistValue(plistPath, key) {
  return run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plistPath]);
}

function main() {
  if (process.platform !== 'darwin') fail('原生模块只能在 macOS 构建。');

  const sourceFramework = requireAbsoluteEnvironmentPath('IRIXI_NATIVE_FRAMEWORK');
  const nodeHeaders = requireAbsoluteEnvironmentPath('IRIXI_NODE_HEADERS');
  const expectedFrameworkHash = String(process.env.IRIXI_NATIVE_FRAMEWORK_SHA256 || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedFrameworkHash)) {
    fail('IRIXI_NATIVE_FRAMEWORK_SHA256 必须是 64 位 SHA-256。');
  }
  if (path.basename(sourceFramework) !== FRAMEWORK_NAME) fail('原生框架名称不正确。');

  const sourceInfo = path.join(sourceFramework, 'Resources', 'Info.plist');
  const sourceBinary = path.join(sourceFramework, FRAMEWORK_BINARY);
  const nodeApiHeader = path.join(nodeHeaders, 'node_api.h');
  for (const required of [sourceInfo, sourceBinary, nodeApiHeader]) {
    if (!fs.existsSync(required)) fail(`缺少构建输入：${required}`);
  }
  assertNoSymlinks(sourceFramework);
  run('/usr/bin/codesign', ['--verify', '--strict', sourceFramework]);
  if (!run('/usr/bin/lipo', ['-archs', sourceBinary]).split(/\s+/).includes('arm64')) {
    fail('原生框架不包含 arm64。');
  }
  if (plistValue(sourceInfo, 'CFBundleIdentifier') !== FRAMEWORK_BUNDLE_ID) {
    fail('原生框架身份不正确。');
  }
  if (plistValue(sourceInfo, 'CFBundleExecutable') !== FRAMEWORK_BINARY) {
    fail('原生框架主程序名称不正确。');
  }
  const frameworkVersion = plistValue(sourceInfo, 'CFBundleShortVersionString');
  if (!/^\d+\.\d+\.\d+$/.test(frameworkVersion)) fail('原生框架版本号不正确。');
  if (sha256(sourceBinary) !== expectedFrameworkHash) fail('原生框架摘要与已验收输入不一致。');

  const stageRoot = path.join(PROJECT_ROOT, 'build', 'native-module');
  const stagedFramework = path.join(stageRoot, FRAMEWORK_NAME);
  const stagedBinary = path.join(stagedFramework, FRAMEWORK_BINARY);
  const stagedModule = path.join(stageRoot, MODULE_NAME);
  const manifestPath = path.join(PROJECT_ROOT, 'build', 'native-module-manifest.json');
  fs.rmSync(stageRoot, { recursive: true, force: true });
  fs.mkdirSync(stageRoot, { recursive: true });
  fs.cpSync(sourceFramework, stagedFramework, { recursive: true, dereference: false });
  assertNoSymlinks(stagedFramework);
  run('/usr/bin/codesign', ['--verify', '--strict', stagedFramework]);

  const clang = run('/usr/bin/xcrun', ['--find', 'clang++']);
  const macosSdk = run('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path']);
  const bridgeSource = path.join(PROJECT_ROOT, 'native', 'irixi-native-bridge', 'src', 'bridge.mm');
  execFileSync(clang, [
    '-std=c++17',
    '-arch', 'arm64',
    '-mmacosx-version-min=13.0',
    '-isysroot', macosSdk,
    '-fPIC',
    '-bundle',
    '-undefined', 'dynamic_lookup',
    '-I', nodeHeaders,
    '-F', stageRoot,
    '-framework', 'IRiXiNativeKit',
    '-Wl,-rpath,@loader_path',
    '-o', stagedModule,
    bridgeSource,
  ], { stdio: 'inherit' });

  const moduleDependencies = run('/usr/bin/otool', ['-L', stagedModule]);
  if (!moduleDependencies.includes('@rpath/IRiXiNativeKit.framework/IRiXiNativeKit')) {
    fail('原生模块没有使用固定框架加载路径。');
  }
  run('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', '--options', 'runtime', stagedModule]);
  run('/usr/bin/codesign', ['--verify', '--strict', stagedModule]);

  const manifest = {
    schemaVersion: 1,
    abiVersion: EXPECTED_ABI,
    moduleFile: MODULE_NAME,
    moduleSha256: sha256(stagedModule),
    frameworkName: FRAMEWORK_NAME,
    frameworkBundleId: FRAMEWORK_BUNDLE_ID,
    frameworkVersion,
    frameworkBinarySha256: sha256(stagedBinary),
    architecture: 'arm64',
    signature: 'adhoc',
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`原生模块已准备：${manifest.moduleSha256}`);
}

main();
