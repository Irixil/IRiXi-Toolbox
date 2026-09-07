const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
const workspaceJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace.js'), 'utf8');
const effectsJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'effects.js'), 'utf8');
const toolsJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'tools.js'), 'utf8');
const preloadJs = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const translationShortcutSwift = fs.readFileSync(
  path.join(__dirname, '..', '..', 'snaploom', 'SnaploomApp', 'Translation', 'TranslationShortcutManager.swift'),
  'utf8'
);
const nativeCaptureSwift = fs.readFileSync(
  path.join(__dirname, '..', '..', 'snaploom', 'SnaploomApp', 'IRiXiNative', 'IRiXiRegionCapture.swift'),
  'utf8'
);
const overlayViewSwift = fs.readFileSync(
  path.join(__dirname, '..', '..', 'snaploom', 'SnaploomApp', 'UI', 'Overlay', 'OverlayView.swift'),
  'utf8'
);
const packageConfig = require(path.join(__dirname, '..', 'package.json'));

test('IRiXi tools is a first-class page backed by narrow preload methods', () => {
  assert.match(html, /<title>IRiXi的小工具库<\/title>/);
  assert.match(html, /data-tab="tools"/);
  assert.match(html, /id="tab-tools"/);
  assert.match(html, /id="tools-install-sample"/);
  assert.match(html, /id="tool-install-dialog"/);
  assert.match(html, /id="tool-uninstall-dialog"/);
  assert.match(html, /id="tool-native-helper"/);
  assert.match(html, /data-helper-partner="en"/);
  assert.match(html, /data-helper-partner="ja"/);
  assert.match(html, /data-helper-partner="ko"/);
  assert.match(html, /id="tool-native-helper-selection"/);
  assert.match(html, /id="tool-native-capture"/);
  assert.match(html, />区域截图<\/button>/);
  assert.match(html, />窗口截图<\/button>/);
  assert.match(html, />全屏截图<\/button>/);
  assert.match(html, />识别文字<\/button>/);
  assert.match(html, />翻译图片<\/button>/);
  assert.match(preloadJs, /listTools: \(\) => ipcRenderer\.invoke\('tools:list'\)/);
  assert.match(preloadJs, /getNativeModuleStatus: \(\) => ipcRenderer\.invoke\('native-module:status'\)/);
  assert.match(preloadJs, /openNativeTestWindow: \(\) => ipcRenderer\.invoke\('native-module:test-window-open'\)/);
  assert.match(preloadJs, /closeNativeTestWindow: \(\) => ipcRenderer\.invoke\('native-module:test-window-close'\)/);
  assert.match(preloadJs, /startNativeAreaCapture: \(\) => ipcRenderer\.invoke\('native-module:capture-area'\)/);
  assert.match(preloadJs, /setCaptureShortcut: \(accelerator\) => ipcRenderer\.invoke\('settings:set-capture-shortcut', accelerator\)/);
  assert.match(preloadJs, /startNativeWindowCapture: \(\) => ipcRenderer\.invoke\('native-module:capture-window'\)/);
  assert.match(preloadJs, /startNativeFullscreenCapture: \(\) => ipcRenderer\.invoke\('native-module:capture-fullscreen'\)/);
  assert.match(preloadJs, /startNativeOCRCapture: \(\) => ipcRenderer\.invoke\('native-module:capture-ocr'\)/);
  assert.match(preloadJs, /startNativeImageTranslationCapture: \(\) => ipcRenderer\.invoke\('native-module:capture-translate'\)/);
  assert.match(preloadJs, /openNativeInputTranslation: \(partner\) => ipcRenderer\.invoke\('native-module:translation-input', partner\)/);
  assert.match(preloadJs, /startNativeSelectionTranslation: \(\) => ipcRenderer\.invoke\('native-module:translation-selection'\)/);
  assert.doesNotMatch(preloadJs, /requestScreenRecordingPermission|requestScreenPermission/);
  assert.match(preloadJs, /runToolAction: \(id, actionId\) => ipcRenderer\.invoke\('tools:run-action'/);
  assert.doesNotMatch(toolsJs, /\bfetch\s*\(/);
  assert.doesNotMatch(toolsJs, /\brequire\s*\(/);
  assert.doesNotMatch(preloadJs, /native-helper:/);
  assert.doesNotMatch(mainJs, /createNativeHelperManager|native-helper:/);
  assert.doesNotMatch(toolsJs, /runNativeHelperAction|onNativeHelperState/);
  assert.doesNotMatch(html, /data-helper-partner="(?:en|ja|ko)"[^>]*(?:data-migration-pending|disabled)/);
  assert.doesNotMatch(html, /id="tool-native-helper-selection"[^>]*(?:data-migration-pending|disabled)/);
  assert.match(toolsJs, /'tool-capture-area', 'startNativeAreaCapture'/);
  assert.match(toolsJs, /'tool-capture-window', 'startNativeWindowCapture'/);
  assert.match(toolsJs, /'tool-capture-fullscreen', 'startNativeFullscreenCapture'/);
  assert.match(toolsJs, /'tool-capture-ocr', 'startNativeOCRCapture'/);
  assert.match(toolsJs, /'tool-capture-translate', 'startNativeImageTranslationCapture'/);
  assert.match(toolsJs, /openNativeInputTranslation\(button\.dataset\.helperPartner\)/);
  assert.match(toolsJs, /startNativeSelectionTranslation\(\)/);
  assert.doesNotMatch(html, /id="tool-capture-window"[^>]*(?:data-migration-pending|disabled)/);
  assert.doesNotMatch(html, /id="tool-capture-fullscreen"[^>]*(?:data-migration-pending|disabled)/);
  assert.doesNotMatch(html, /id="tool-capture-ocr"[^>]*(?:data-migration-pending|disabled)/);
  assert.doesNotMatch(html, /id="tool-capture-translate"[^>]*(?:data-migration-pending|disabled)/);
  assert.doesNotMatch(toolsJs, /capture\.(?:area|window|fullscreen|ocr|translate)'[^\n]*(?:path|pixels|text)/);
  assert.match(mainJs, /id: 'builtin\.capture'[\s\S]*nativeAction: 'capture\.area'/);
  assert.match(toolsJs, /currentStatus\.textContent = toolStateLabel\(tool\)/);
  assert.doesNotMatch(mainJs, /app\.whenReady\(\)[\s\S]*nativeHelper\.start\(\)/);
  assert.match(mainJs, /ipcMain\.handle\('native-module:capture-area'/);
  assert.match(mainJs, /DEFAULT_CAPTURE_SHORTCUT = 'Command\+Shift\+X'/);
  assert.match(mainJs, /globalShortcut\.register\(shortcut, runAreaCaptureShortcut\)/);
  assert.match(mainJs, /function runAreaCaptureShortcut\(\) \{\s*const result = nativeModule\.startAreaCapture\(\)/);
  assert.match(mainJs, /hasStoredEncryptedSecret[\s\S]*\? safeStorage\.isEncryptionAvailable\(\)[\s\S]*: process\.platform === 'darwin'/);
  assert.match(translationShortcutSwift, /GetEventParameter\(/);
  assert.match(translationShortcutSwift, /hotKeyID\.signature == TranslationShortcutManager\.signature/);
  assert.match(translationShortcutSwift, /hotKeyID\.id == 1/);
  assert.match(nativeCaptureSwift, /overlay\.setExternalTranslationWindowEnabled\(\)/);
  assert.match(nativeCaptureSwift, /overlayDidRequestTranslation[\s\S]*IRiXiImageTranslationController\.shared\.translate\(image\)/);
  assert.match(overlayViewSwift, /usesExternalTranslationWindow[\s\S]*overlayViewDidRequestTranslation\(\)/);
  assert.match(html, /id="settings-capture-shortcut-value"/);
  assert.match(html, /id="settings-capture-shortcut-status"/);
  assert.match(mainJs, /ipcMain\.handle\('native-module:capture-window'/);
  assert.match(mainJs, /ipcMain\.handle\('native-module:capture-fullscreen'/);
  assert.match(mainJs, /ipcMain\.handle\('native-module:capture-ocr'/);
  assert.match(mainJs, /ipcMain\.handle\('native-module:capture-translate'/);
  assert.match(mainJs, /ipcMain\.handle\('native-module:translation-input'/);
  assert.match(mainJs, /ipcMain\.handle\('native-module:translation-selection'/);
  assert.match(mainJs, /id: 'builtin\.translation'[\s\S]*nativeAction: 'translation\.input'/);
  assert.match(toolsJs, /const result = await api\[method\]\(\)/);
});

test('old Agent, link inspection, credential editing and workspace switching are disconnected', () => {
  assert.match(html, /id="tab-button-agent"[^>]*hidden/);
  assert.match(html, /id="tab-button-links"[^>]*hidden/);
  assert.match(html, /id="tab-button-credentials"[^>]*hidden/);
  assert.doesNotMatch(html, /<script src="agent\.js"><\/script>/);
  assert.doesNotMatch(html, /id="settings-workspace-choose"/);
  assert.doesNotMatch(preloadJs, /agentStatus:|agentCreate:|onOpenAgent:|inspectLink:|listCredentials:|chooseWorkspace:/);
  assert.match(mainJs, /function assertAgentRenderer\(event\) \{\s*throw new Error\('旧 Agent 功能已停用。'\)/);
});

test('tool installation explains storage and denied capabilities before confirmation', () => {
  assert.match(html, /只保存这个工具自己的数字/);
  assert.match(html, /不能联网，不能读文件，也不能控制电脑/);
  assert.match(toolsJs, /previewSampleTool\(\)/);
  assert.match(toolsJs, /installSampleTool\(\)/);
  assert.match(toolsJs, /uninstallTool\(uninstallId, keepData\)/);
  assert.doesNotMatch(toolsJs, /window\.confirm\(/);
});

test('the packaged app contains the in-process module and no hidden permission helper', () => {
  assert.deepEqual(packageConfig.build.extraFiles.map((entry) => entry.to), [
    'Frameworks/IRiXiNativeKit.framework',
    'Frameworks/irixi-native.node',
  ]);
  assert.deepEqual(packageConfig.build.extraResources.map((entry) => entry.to), [
    'native-module-manifest.json',
  ]);
  assert.doesNotMatch(packageConfig.build.files.join('\n'), /native-helper-manager/);
  assert.doesNotMatch(packageConfig.build.files.join('\n'), /agent-service-v2|codex-notify|claude-notify/);
  const readyBlock = mainJs.match(/app\.whenReady\(\)\.then\(\(\) => \{[\s\S]*?\n\}\);/)?.[0] || '';
  assert.doesNotMatch(readyBlock, /startTaskNotificationServer\(|scheduleAgentReminder\(|ensureAgentService\(\)\.start/);
  assert.match(readyBlock, /nativeModule\.load\(\)/);
  assert.match(readyBlock, /isExactW19PermissionTestInvocation\(process\.argv\)/);
  assert.doesNotMatch(preloadJs, /requestScreenPermission/);
});

test('clipboard rows define both favorite icons before rendering entries', () => {
  assert.match(appJs, /const starOutlineSvg\s*=/);
  assert.match(appJs, /const starFilledSvg\s*=/);
});

test('notes have a dedicated top-level tab and management panel', () => {
  assert.match(html, /data-tab="notes"/);
  assert.match(html, /id="tab-notes"/);
  assert.match(html, /id="notes-search"/);
  assert.match(html, /id="notes-list"/);
  assert.match(html, /id="notes-detail"/);
});

test('home scratch note keeps only the save action', () => {
  const homeNote = html.match(/<section class="tile home-note"[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(homeNote, /id="note-save-btn"/);
  assert.doesNotMatch(homeNote, /id="note-library-btn"/);
  assert.doesNotMatch(homeNote, /id="note-library"/);
});

test('recordings expose in-page API settings and create a live draft while recording', () => {
  assert.match(html, /id="recording-configure"/);
  assert.match(workspaceJs, /function beginRecordingDraft\(\)/);
  assert.match(workspaceJs, /recordingLiveTranscript/);
  assert.match(workspaceJs, /configure-transcription/);
});

test('a live recording can be paused, resumed, and stopped from the recordings tab', () => {
  assert.match(workspaceJs, /recording-live-pause/);
  assert.match(workspaceJs, /recording-live-stop/);
  assert.match(workspaceJs, /togglePauseRecording/);
  assert.match(workspaceJs, /stopRecording/);
});

test('homepage visibility has one storage key, exact validation, and lifecycle events', () => {
  assert.match(appJs, /notch-home-hidden-modules-v1/);
  assert.match(appJs, /validateHomeWidgetLayout/);
  assert.match(appJs, /window\.NotchHome\s*=/);
  assert.match(appJs, /notch:home-modules-changed/);
  assert.match(appJs, /notch:home-layout-error/);
  assert.match(appJs, /stopMirror\(\)/);
  assert.match(appJs, /new Set\(homeTiles\.map\(\(tile\) => tile\.dataset\.homeModule\)\)/);
});

test('settings exposes exactly one switch for every homepage widget', () => {
  const switches = [...html.matchAll(/data-settings-home-module="([^"]+)"/g)]
    .map((match) => match[1]);
  assert.deepEqual(switches, [
    'music', 'pomodoro', 'recorder', 'windows', 'mirror', 'note', 'commands',
  ]);
  assert.match(workspaceJs, /isRecordingActive/);
  assert.match(workspaceJs, /recording_active/);
  assert.match(workspaceJs, /at_least_one_required/);
});

test('hidden visual widgets stop presentation-only background work', () => {
  assert.match(effectsJs, /setEnabled/);
  assert.match(effectsJs, /notch:home-modules-changed/);
  assert.match(workspaceJs, /NotchHome\?\.isVisible/);
});
