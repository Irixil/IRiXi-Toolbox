'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const HELPER_NAME = 'IRiXi Native Helper.app';
const EXECUTABLE_NAME = 'IRiXi Native Helper';
const HOST_BUNDLE_ID = 'com.irixi.toolbox';
const HELPER_BUNDLE_ID = 'com.irixi.toolbox.native-helper';

function plistValue(plistPath, key) {
  return String(execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', plistPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })).trim();
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function verify(appPath) {
  assert(process.platform === 'darwin', '候选包只能在 macOS 上检查。');
  assert(path.isAbsolute(appPath) && appPath.endsWith('.app'), '请提供候选 .app 的绝对路径。');
  const contentsPath = path.join(appPath, 'Contents');
  const hostPlist = path.join(contentsPath, 'Info.plist');
  const helperPath = path.join(contentsPath, 'Helpers', HELPER_NAME);
  const helperExecutable = path.join(helperPath, 'Contents', 'MacOS', EXECUTABLE_NAME);
  const helperPlist = path.join(helperPath, 'Contents', 'Info.plist');
  const manifestPath = path.join(contentsPath, 'Resources', 'native-helper-manifest.json');
  const licensePath = path.join(contentsPath, 'Resources', 'native-helper-licenses', 'Snaploom-GPL-3.0.txt');

  for (const required of [hostPlist, helperPath, helperExecutable, helperPlist, manifestPath, licensePath]) {
    assert(fs.existsSync(required), `候选包缺少：${required}`);
    assert(!fs.lstatSync(required).isSymbolicLink(), `候选包不能用符号链接代替：${required}`);
  }
  const manifestBytes = fs.readFileSync(manifestPath);
  assert(manifestBytes.length <= 16 * 1024, '助手清单超过 16KB。');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  assert(JSON.stringify(Object.keys(manifest).sort()) === JSON.stringify([
    'bundleId', 'helperVersion', 'protocolVersion', 'relativeExecutablePath', 'sha256', 'signature',
  ]), '助手清单字段不正确。');
  assert(plistValue(hostPlist, 'CFBundleIdentifier') === HOST_BUNDLE_ID, '主程序 Bundle ID 不正确。');
  assert(plistValue(helperPlist, 'CFBundleIdentifier') === HELPER_BUNDLE_ID, '助手 Bundle ID 不正确。');
  assert(plistValue(helperPlist, 'CFBundleShortVersionString') === manifest.helperVersion, '助手版本与清单不一致。');
  assert(Number.parseInt(plistValue(helperPlist, 'LSMinimumSystemVersion'), 10) >= 15, '助手错误地声明支持 macOS 15 以下。');
  assert(manifest.protocolVersion === 1, '助手协议版本不正确。');
  assert(manifest.relativeExecutablePath === `${HELPER_NAME}/Contents/MacOS/${EXECUTABLE_NAME}`, '助手相对路径不正确。');
  assert(sha256(helperExecutable) === manifest.sha256, '助手程序摘要与清单不一致。');
  assert(['adhoc', 'developer-id'].includes(manifest.signature), '助手签名类型不正确。');

  execFileSync('/usr/bin/codesign', ['--verify', '--strict', helperPath], { stdio: 'pipe' });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'pipe' });

  const executableNames = fs.readdirSync(path.join(helperPath, 'Contents', 'MacOS'), { withFileTypes: true })
    .filter((entry) => entry.isFile()).map((entry) => entry.name);
  assert(JSON.stringify(executableNames) === JSON.stringify([EXECUTABLE_NAME]), '助手包含额外可执行文件。');
  assert(!fs.readdirSync(path.join(helperPath, 'Contents'), { recursive: true })
    .some((name) => String(name).toLowerCase().includes('sparkle')), '助手不应包含 Sparkle。');

  const result = {
    appPath,
    hostVersion: plistValue(hostPlist, 'CFBundleShortVersionString'),
    helperVersion: manifest.helperVersion,
    helperSha256: manifest.sha256,
    signature: manifest.signature,
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  try {
    verify(path.resolve(process.argv[2] || ''));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { verify };
