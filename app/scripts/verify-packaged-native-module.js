'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const HOST_BUNDLE_ID = 'com.irixi.toolbox';
const FRAMEWORK_BUNDLE_ID = 'com.irixi.toolbox.native-kit';

function fail(message) {
  throw new Error(message);
}

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function assertNoSymlinks(rootPath) {
  const stat = fs.lstatSync(rootPath);
  if (stat.isSymbolicLink()) fail(`产物包含符号链接：${rootPath}`);
  if (!stat.isDirectory()) return;
  for (const entry of fs.readdirSync(rootPath)) assertNoSymlinks(path.join(rootPath, entry));
}

function plistValue(plistPath, key) {
  return run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plistPath]);
}

function main() {
  const appPath = process.argv[2];
  if (!appPath || !path.isAbsolute(appPath) || path.extname(appPath) !== '.app') {
    fail('请传入候选 .app 的绝对路径。');
  }
  const contents = path.join(appPath, 'Contents');
  const modulePath = path.join(contents, 'Frameworks', 'irixi-native.node');
  const frameworkPath = path.join(contents, 'Frameworks', 'IRiXiNativeKit.framework');
  const frameworkBinary = path.join(frameworkPath, 'IRiXiNativeKit');
  const manifestPath = path.join(contents, 'Resources', 'native-module-manifest.json');
  for (const required of [modulePath, frameworkPath, frameworkBinary, manifestPath]) {
    if (!fs.existsSync(required)) fail(`候选包缺少：${required}`);
  }
  if (plistValue(path.join(contents, 'Info.plist'), 'CFBundleIdentifier') !== HOST_BUNDLE_ID) {
    fail('候选 App 身份不正确。');
  }
  if (plistValue(path.join(frameworkPath, 'Resources', 'Info.plist'), 'CFBundleIdentifier') !== FRAMEWORK_BUNDLE_ID) {
    fail('候选原生框架身份不正确。');
  }
  assertNoSymlinks(modulePath);
  assertNoSymlinks(frameworkPath);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.abiVersion !== 7) fail('原生模块清单版本不正确。');
  if (manifest.moduleFile !== 'irixi-native.node' || manifest.frameworkName !== 'IRiXiNativeKit.framework') {
    fail('原生模块清单路径不正确。');
  }
  if (manifest.frameworkBundleId !== FRAMEWORK_BUNDLE_ID || manifest.architecture !== 'arm64') {
    fail('原生模块清单身份不正确。');
  }
  if (manifest.moduleSha256 !== sha256(modulePath)) fail('原生模块摘要不一致。');
  if (manifest.frameworkBinarySha256 !== sha256(frameworkBinary)) fail('原生框架摘要不一致。');
  if (!run('/usr/bin/otool', ['-L', modulePath]).includes('@rpath/IRiXiNativeKit.framework/IRiXiNativeKit')) {
    fail('原生模块加载路径不正确。');
  }
  run('/usr/bin/codesign', ['--verify', '--strict', modulePath]);
  run('/usr/bin/codesign', ['--verify', '--strict', frameworkPath]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath]);
  console.log('候选 App 的原生模块、固定身份和签名均通过校验。');
}

main();
