// electron-builder afterPack hook
// 因为 electron-builder + identity:null 跳过签名，asar:false 又关闭了 integrity 校验，
// 这里手动从内到外签名。优先使用显式指定的稳定身份，其次自动发现本机
// 的 IRiXi Local Code Signing；权限敏感的正式包没有稳定身份就直接中止。
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

function pickSigningIdentity(securityOutput, requestedName = '') {
  const identities = String(securityOutput || '').split(/\r?\n/)
    .map((line) => {
      const match = /^\s*\d+\)\s+([A-F0-9]{40})\s+"([^"]+)"\s*$/.exec(line);
      return match ? { hash: match[1], name: match[2].trim() } : null;
    })
    .filter(Boolean);
  const matches = identities.filter(({ name }) => requestedName
    ? name === requestedName
    : /^IRiXi Local Code Signing(?: \d{4})?$/.test(name));
  return matches[0]?.hash || null;
}

function resolveSigningIdentity() {
  const configured = String(process.env.IRIXI_CODESIGN_IDENTITY || '').trim();
  if (configured && /^[A-F0-9]{40}$/i.test(configured)) return configured;
  try {
    const output = execFileSync('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return pickSigningIdentity(output, configured);
  } catch (error) {
    return null;
  }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  const projectRoot = path.resolve(__dirname, '..');
  const macOSDirectory = path.join(appPath, 'Contents', 'MacOS');
  const electronExecutablePath = path.join(macOSDirectory, context.packager.appInfo.productFilename);
  const nativeModulePath = path.join(appPath, 'Contents', 'Frameworks', 'irixi-native.node');
  const nativeFrameworkPath = path.join(appPath, 'Contents', 'Frameworks', 'IRiXiNativeKit.framework');
  const nativeFrameworkBinaryPath = path.join(nativeFrameworkPath, 'IRiXiNativeKit');
  const nativeModuleManifestPath = path.join(appPath, 'Contents', 'Resources', 'native-module-manifest.json');

  if (!fs.existsSync(electronExecutablePath)) {
    throw new Error(`找不到 Electron 主程序：${electronExecutablePath}`);
  }
  if (
    !fs.existsSync(nativeModulePath)
    || !fs.existsSync(nativeFrameworkPath)
    || !fs.existsSync(nativeFrameworkBinaryPath)
    || !fs.existsSync(nativeModuleManifestPath)
  ) {
    throw new Error('缺少固定的 IRiXi 原生模块、框架或模块清单。');
  }

  const nativeModuleManifest = JSON.parse(fs.readFileSync(nativeModuleManifestPath, 'utf8'));
  const digest = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  if (
    nativeModuleManifest.moduleFile !== 'irixi-native.node'
    || nativeModuleManifest.frameworkName !== 'IRiXiNativeKit.framework'
    || nativeModuleManifest.frameworkBundleId !== 'com.irixi.toolbox.native-kit'
    || nativeModuleManifest.moduleSha256 !== digest(nativeModulePath)
    || nativeModuleManifest.frameworkBinarySha256 !== digest(nativeFrameworkBinaryPath)
  ) {
    throw new Error('IRiXi 原生模块或框架摘要与打包清单不一致。');
  }
  execFileSync('codesign', ['--verify', '--strict', nativeModulePath], { stdio: 'pipe' });
  execFileSync('codesign', ['--verify', '--strict', nativeFrameworkPath], { stdio: 'pipe' });

  const signingIdentity = resolveSigningIdentity();
  if (!signingIdentity || signingIdentity === '-') {
    throw new Error('IRiXi 是权限敏感应用，找不到固定的 IRiXi Local Code Signing 身份，停止生成临时签名包。');
  }
  const stableLocalSigning = true;
  console.log(`  • 稳定本机身份签名 ${appPath}`);

  // 依次签：所有 dylib → Framework 内 Helpers → Framework binary → Helper apps → Frameworks → 主 bundle
  const entitlementsPath = path.join(projectRoot, 'build', 'entitlements.mac.plist');
  // 逐文件失败先记录不抛：最终的 --verify --deep --strict 才是判定标准，
  // 个别无害告警不该中断构建，真正坏掉的签名会在下面的校验里被拦住。
  const signFailures = [];
  const cs = (file, executable = false) => {
    try {
      const args = ['--force', '--sign', signingIdentity, '--timestamp=none'];
      if (executable) args.push('--options', 'runtime', '--entitlements', entitlementsPath);
      args.push(file);
      execFileSync('codesign', args, { stdio: 'pipe' });
    } catch (e) {
      signFailures.push(`${file}: ${e.message}`);
      console.warn(`    codesign 失败 ${file}: ${e.message}`);
    }
  };

  const walk = (dir, predicate, cb) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.endsWith('.app') && !entry.name.endsWith('.framework')) {
        walk(full, predicate, cb);
      } else if (entry.isFile() && predicate(entry.name, full)) {
        cb(full);
      }
    }
  };

  const fwDir = path.join(appPath, 'Contents', 'Frameworks');

  // 稳定身份更新时，原生组件也必须先用同一身份签名；签名会改变二进制摘要，
  // 因此随即刷新包内清单，再由后续外层签名把新清单封住。
  if (stableLocalSigning) {
    execFileSync('codesign', [
      '--force', '--sign', signingIdentity, '--timestamp=none', '--options', 'runtime', nativeModulePath,
    ], { stdio: 'pipe' });
    execFileSync('codesign', [
      '--force', '--sign', signingIdentity, '--timestamp=none', '--options', 'runtime', nativeFrameworkPath,
    ], { stdio: 'pipe' });
    nativeModuleManifest.moduleSha256 = digest(nativeModulePath);
    nativeModuleManifest.frameworkBinarySha256 = digest(nativeFrameworkBinaryPath);
    nativeModuleManifest.signature = 'stable-local';
    fs.writeFileSync(nativeModuleManifestPath, `${JSON.stringify(nativeModuleManifest, null, 2)}\n`);
  }

  // 1) 所有 dylib
  walk(fwDir, (n) => n.endsWith('.dylib'), cs);

  // 2) Electron Framework 内部的 Helpers (chrome_crashpad_handler 等)
  const efw = path.join(fwDir, 'Electron Framework.framework', 'Versions', 'A', 'Helpers');
  if (fs.existsSync(efw)) {
    for (const f of fs.readdirSync(efw)) cs(path.join(efw, f), true);
  }

  // 3) Electron Framework 主 binary
  const efwBin = path.join(fwDir, 'Electron Framework.framework', 'Versions', 'A', 'Electron Framework');
  if (fs.existsSync(efwBin)) cs(efwBin);

  // 4) 每个 Helper.app 的内部 binary
  for (const entry of fs.readdirSync(fwDir)) {
    if (entry.endsWith('.app')) {
      const macosDir = path.join(fwDir, entry, 'Contents', 'MacOS');
      if (fs.existsSync(macosDir)) {
        for (const f of fs.readdirSync(macosDir)) cs(path.join(macosDir, f), true);
      }
    }
  }

  // 5) 每个 Helper.app 整体
  for (const entry of fs.readdirSync(fwDir)) {
      if (entry.endsWith('.app')) cs(path.join(fwDir, entry), true);
  }

  // 6) 每个 Framework 整体
  for (const entry of fs.readdirSync(fwDir)) {
    // IRiXiNativeKit 已按清单签名并锁定摘要；重新签名会改变已验收输入。
    if (entry.endsWith('.framework') && entry !== 'IRiXiNativeKit.framework') cs(path.join(fwDir, entry));
  }

  // 7) Electron 主程序（Contents/MacOS 下唯一的可执行文件）
  cs(electronExecutablePath, true);

  // 8) 主 bundle
  cs(appPath, true);

  // 校验：失败必须中断构建，否则本地会拿到一个签名已坏、却看起来构建成功的 DMG。
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'pipe' });
    execFileSync('codesign', ['--verify', '--strict', nativeModulePath], { stdio: 'pipe' });
    execFileSync('codesign', ['--verify', '--strict', nativeFrameworkPath], { stdio: 'pipe' });
    if (
      digest(nativeModulePath) !== nativeModuleManifest.moduleSha256
      || digest(nativeFrameworkBinaryPath) !== nativeModuleManifest.frameworkBinarySha256
    ) {
      throw new Error('签名主程序时改变了原生模块，停止生成候选包。');
    }
    console.log(`  ✓ 签名校验通过`);
  } catch (e) {
    if (signFailures.length) {
      console.error(`  ✗ 期间有 ${signFailures.length} 个文件签名失败：`);
      for (const failure of signFailures) console.error(`      ${failure}`);
    }
    throw new Error(`${stableLocalSigning ? '稳定本机身份' : 'ad-hoc'}签名校验失败，产物不可分发：${e.message}`);
  }
};

exports.pickSigningIdentity = pickSigningIdentity;
exports.resolveSigningIdentity = resolveSigningIdentity;
