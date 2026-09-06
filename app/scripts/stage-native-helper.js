'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const HELPER_NAME = 'IRiXi Native Helper.app';
const EXECUTABLE_NAME = 'IRiXi Native Helper';
const BUNDLE_ID = 'com.irixi.toolbox.native-helper';
const PROTOCOL_VERSION = 1;
const EXPECTED_SNAPLOOM_COMMIT = '503e0c8a7960a13976b1b15369a8171d61965bdd';

function fail(message) {
  throw new Error(message);
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function plistValue(plistPath, key) {
  return String(execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', plistPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })).trim();
}

function assertNoSymlinks(rootPath) {
  const stack = [rootPath];
  while (stack.length) {
    const current = stack.pop();
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) fail(`原生助手不能包含符号链接：${current}`);
    if (!stat.isDirectory()) continue;
    for (const name of fs.readdirSync(current)) stack.push(path.join(current, name));
  }
}

function makeStagedCopyWritable(rootPath) {
  const stack = [rootPath];
  while (stack.length) {
    const current = stack.pop();
    const stat = fs.lstatSync(current);
    if (stat.isDirectory()) {
      fs.chmodSync(current, stat.mode | 0o700);
      for (const name of fs.readdirSync(current)) stack.push(path.join(current, name));
    } else {
      fs.chmodSync(current, stat.mode | 0o200);
    }
  }
}

function inspectHelper(helperPath) {
  if (process.platform !== 'darwin') fail('原生助手只能在 macOS 上打包。');
  if (!path.isAbsolute(helperPath) || path.basename(helperPath) !== HELPER_NAME) {
    fail(`IRIXI_NATIVE_HELPER_APP 必须是 ${HELPER_NAME} 的绝对路径。`);
  }
  assertNoSymlinks(helperPath);

  const contentsPath = path.join(helperPath, 'Contents');
  const executableDirectory = path.join(contentsPath, 'MacOS');
  const executablePath = path.join(executableDirectory, EXECUTABLE_NAME);
  const plistPath = path.join(contentsPath, 'Info.plist');
  const executables = fs.readdirSync(executableDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile());
  if (executables.length !== 1 || executables[0].name !== EXECUTABLE_NAME) {
    fail('原生助手的 Contents/MacOS 必须且只能包含一个固定程序。');
  }
  if (plistValue(plistPath, 'CFBundleIdentifier') !== BUNDLE_ID) fail('原生助手 Bundle ID 不匹配。');
  const helperVersion = plistValue(plistPath, 'CFBundleShortVersionString');
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(helperVersion)) fail('原生助手版本格式不正确。');
  const minimumSystemVersion = plistValue(plistPath, 'LSMinimumSystemVersion');
  if (Number.parseInt(minimumSystemVersion, 10) < 15) fail('原生助手最低系统版本必须是 macOS 15。');
  execFileSync('/usr/bin/codesign', ['--verify', '--strict', helperPath], { stdio: 'pipe' });
  const signatureCheck = spawnSync('/usr/bin/codesign', ['-d', '--verbose=4', helperPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (signatureCheck.status !== 0) fail('无法读取原生助手签名。');
  const signatureDescription = `${signatureCheck.stdout || ''}\n${signatureCheck.stderr || ''}`;
  const signature = signatureDescription.includes('Signature=adhoc') ? 'adhoc' : 'developer-id';
  return { executablePath, helperVersion, minimumSystemVersion, signature, digest: sha256(executablePath) };
}

function stage() {
  const sourceHelper = process.env.IRIXI_NATIVE_HELPER_APP;
  const snaploomSource = process.env.IRIXI_SNAPLOOM_SOURCE;
  const expectedDigest = process.env.IRIXI_NATIVE_HELPER_SHA256;
  if (!sourceHelper) fail('缺少 IRIXI_NATIVE_HELPER_APP，不能猜测要嵌入哪个助手。');
  if (!/^[0-9a-f]{64}$/.test(expectedDigest || '')) {
    fail('缺少有效的 IRIXI_NATIVE_HELPER_SHA256，不能把仍在变化的助手装入候选包。');
  }
  if (!snaploomSource || !path.isAbsolute(snaploomSource)) {
    fail('缺少 IRIXI_SNAPLOOM_SOURCE，不能确认助手来源和许可。');
  }

  const revision = String(execFileSync('/usr/bin/git', ['-C', snaploomSource, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })).trim();
  if (revision !== EXPECTED_SNAPLOOM_COMMIT) {
    fail(`Snaploom 来源不是已确认版本：${revision}`);
  }
  const licensePath = path.join(snaploomSource, 'LICENSE');
  if (!fs.existsSync(licensePath)) fail('Snaploom LICENSE 不存在，停止打包。');

  const sourceInspection = inspectHelper(path.resolve(sourceHelper));
  if (sourceInspection.digest !== expectedDigest) {
    fail(`原生助手摘要与指定版本不一致：${sourceInspection.digest}`);
  }
  const stageRoot = path.join(PROJECT_ROOT, 'build', 'native-helper');
  const stagedHelper = path.join(stageRoot, HELPER_NAME);
  const licensesRoot = path.join(PROJECT_ROOT, 'build', 'native-helper-licenses');
  const manifestPath = path.join(PROJECT_ROOT, 'build', 'native-helper-manifest.json');

  fs.rmSync(stageRoot, { recursive: true, force: true });
  fs.rmSync(licensesRoot, { recursive: true, force: true });
  fs.mkdirSync(stageRoot, { recursive: true, mode: 0o700 });
  fs.mkdirSync(licensesRoot, { recursive: true, mode: 0o700 });
  fs.cpSync(path.resolve(sourceHelper), stagedHelper, { recursive: true, preserveTimestamps: true });
  makeStagedCopyWritable(stagedHelper);
  fs.copyFileSync(licensePath, path.join(licensesRoot, 'Snaploom-GPL-3.0.txt'));

  // 只重签暂存副本。来源候选保持只读；不沿用 Xcode 构建时可能带入的调试 entitlement。
  execFileSync('/usr/bin/codesign', [
    '--force', '--sign', '-', '--timestamp=none', '--options', 'runtime', stagedHelper,
  ], { stdio: 'pipe' });

  const stagedInspection = inspectHelper(stagedHelper);
  fs.writeFileSync(path.join(licensesRoot, 'SOURCE.json'), `${JSON.stringify({
    snaploomCommit: revision,
    helperVersion: sourceInspection.helperVersion,
    sourceHelperExecutableSha256: sourceInspection.digest,
    packagedHelperExecutableSha256: stagedInspection.digest,
  }, null, 2)}\n`, { mode: 0o600 });
  const manifest = {
    protocolVersion: PROTOCOL_VERSION,
    helperVersion: stagedInspection.helperVersion,
    bundleId: BUNDLE_ID,
    relativeExecutablePath: `${HELPER_NAME}/Contents/MacOS/${EXECUTABLE_NAME}`,
    sha256: stagedInspection.digest,
    signature: stagedInspection.signature,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({
    stagedHelper,
    manifestPath,
    helperVersion: stagedInspection.helperVersion,
    sha256: stagedInspection.digest,
    snaploomCommit: revision,
    host: os.hostname(),
  }, null, 2));
}

if (require.main === module) {
  try {
    stage();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { inspectHelper, stage };
