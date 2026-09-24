const net = require('net');
const path = require('path');
const crypto = require('crypto');

// Keep the deadline active until the entire bounded body has been consumed.
async function fetchBoundedBytes(url, { timeout = 6000, maxBytes, headers = {} }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let reader;
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`http_${response.status}`);
    if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('response_too_large');
    reader = response.body?.getReader();
    const chunks = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new Error('response_too_large');
        chunks.push(value);
      }
    }
    return { bytes: Buffer.concat(chunks, size), contentType: response.headers.get('content-type') || '' };
  } finally {
    clearTimeout(timer);
    controller.abort();
    reader?.releaseLock();
  }
}

function isPrivateAddress(address) {
  const value = String(address || '').trim().toLowerCase().split('%', 1)[0];
  if (!value) return true;
  if (value.startsWith('::ffff:')) return isPrivateAddress(value.slice(7));
  const version = net.isIP(value);
  if (version === 4) {
    const parts = value.split('.').map(Number);
    return (
      parts[0] === 0 ||
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      parts[0] >= 224
    );
  }
  if (version === 6) {
    return (
      value === '::' ||
      value === '::1' ||
      value.startsWith('fc') ||
      value.startsWith('fd') ||
      /^fe[89ab]/.test(value) ||
      value.startsWith('ff')
    );
  }
  return true;
}

function decodeHtmlEntities(value) {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    hellip: '…',
    laquo: '«',
    lt: '<',
    mdash: '—',
    nbsp: ' ',
    ndash: '–',
    quot: '"',
    raquo: '»',
  };
  return String(value || '').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return Object.prototype.hasOwnProperty.call(named, lower) ? named[lower] : match;
  });
}

function extractMetaContent(html, key) {
  const tags = String(html || '').match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const property = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i);
    if (!property || property[1].toLowerCase() !== key.toLowerCase()) continue;
    const content = tag.match(/content\s*=\s*["']([^"']*)["']/i);
    if (content) return content[1];
  }
  return '';
}

function cleanTitle(value) {
  return decodeHtmlEntities(String(value || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function extractPageTitle(html, fallback) {
  const ogTitle = extractMetaContent(html, 'og:title');
  const titleMatch = String(html || '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return cleanTitle(ogTitle || (titleMatch && titleMatch[1]) || fallback) || String(fallback || '未命名链接');
}

function extractFaviconHref(html) {
  const tags = String(html || '').match(/<link\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const rel = tag.match(/rel\s*=\s*["']([^"']+)["']/i);
    if (!rel || !/(?:^|\s)(?:shortcut\s+)?icon(?:\s|$)/i.test(rel[1])) continue;
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (href && href[1]) return decodeHtmlEntities(href[1].trim());
  }
  return '';
}

function parseSmartMaterialMetadata(value) {
  const source = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed;
  try { parsed = JSON.parse(source); } catch (error) { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const clean = (text, limit) => Array.from(String(text || '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()).slice(0, limit).join('');
  return { title: clean(parsed.title, 48), category: clean(parsed.category, 24) };
}

function selectTranscriptionSettings(current, legacy) {
  const currentSettings = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  if (Object.keys(currentSettings).length) return currentSettings;
  return legacy && typeof legacy === 'object' && !Array.isArray(legacy) ? legacy : {};
}

function panelBlurPolicy({
  appActive = false,
  cursorInside = false,
  mediaPermissionRequests = 0,
  transientSystemInteractionRequests = 0,
} = {}) {
  if (mediaPermissionRequests > 0 || transientSystemInteractionRequests > 0) return 'defer';
  // 交互发生在面板内部时，macOS 可能先发 blur 再发点击事件（尤其是
  // 自绘控件和 AX 自动化）。不要把一次内部点击误判成用户离开。
  if (cursorInside) return 'retain';
  return appActive ? 'retain' : 'collapse';
}

function recordingExtension(mimeType) {
  const mime = String(mimeType || '').split(';', 1)[0].trim().toLowerCase();
  if (mime === 'audio/mp4' || mime === 'audio/m4a' || mime === 'audio/x-m4a') return 'm4a';
  if (mime === 'audio/ogg') return 'ogg';
  if (mime === 'audio/wav' || mime === 'audio/x-wav') return 'wav';
  return 'webm';
}

function normalizeWindowRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row, order) => {
      const pid = Math.max(0, Math.round(Number(row && row.pid) || 0));
      const windowIndex = Math.max(0, Math.round(Number(row && row.windowIndex) || 0));
      const windowNumber = Math.max(0, Math.round(Number(row && row.windowNumber) || 0));
      const appName = String(row && row.appName || '').trim();
      const title = String(row && row.title || '').replace(/\s+/g, ' ').trim();
      const candidatePath = String(row && row.appPath || '').trim();
      const appPath = path.isAbsolute(candidatePath) && candidatePath.endsWith('.app') ? candidatePath : '';
      if (!pid || !appName || !title) return null;
      return {
        id: windowNumber ? `window-${pid}-${windowNumber}` : `window-${pid}-${windowIndex}-${order}`,
        pid,
        windowIndex,
        windowNumber,
        appName,
        appPath,
        title: title.slice(0, 240),
      };
    })
    .filter(Boolean)
    // 同一进程下标题完全相同的窗口只保留最前面那条：CGWindowList 按前后顺序返回，
    // 首条就是最靠前的那个。实测微信只开一个窗口却会返回两条同名记录（窗口号不同），
    // 界面上就成了两个「微信」。而聚焦是按标题匹配的，重复条目永远指向同一个窗口，
    // 留着也点不出第二个结果。标题不同的多窗口（如 VS Code 各工作区）不受影响。
    .filter((item, index, list) => list.findIndex(
      (other) => other.pid === item.pid && other.title === item.title
    ) === index);
}

function todoReminderState(todo, now = Date.now(), leadMs = 60 * 60 * 1000) {
  if (!todo || typeof todo !== 'object') return { state: 'invalid', delayMs: 0 };
  if (todo.done === true) return { state: 'done', delayMs: 0 };
  if (Number(todo.remindedAt) > 0) return { state: 'notified', delayMs: 0 };
  const deadline = Date.parse(String(todo.deadline || ''));
  const current = Number(now);
  if (!Number.isFinite(deadline) || !Number.isFinite(current)) return { state: 'invalid', delayMs: 0 };
  if (current > deadline) return { state: 'expired', delayMs: 0 };
  const triggerAt = deadline - Math.max(0, Number(leadMs) || 0);
  if (current >= triggerAt) return { state: 'due', delayMs: 0 };
  return { state: 'scheduled', delayMs: triggerAt - current };
}

const MAX_NODE_TIMER_DELAY_MS = (2 ** 31) - 1;

function todoReminderTimerDelay(delayMs) {
  const normalizedDelay = Number(delayMs);
  if (!Number.isFinite(normalizedDelay)) return 250;
  // Larger delays are coerced to 1ms by Node. Wake at the longest safe delay
  // and let the reminder scheduler recalculate the remaining time.
  return Math.min(MAX_NODE_TIMER_DELAY_MS, Math.max(250, normalizedDelay));
}

function firstPayloadText(payload, keys) {
  for (const key of keys) {
    const value = payload && payload[key];
    if ((typeof value === 'string' || typeof value === 'number') && String(value).trim()) {
      return String(value);
    }
  }
  return '';
}

function cleanTaskLine(value, maxLength) {
  const line = String(value || '').split(/\r?\n/).map((item) => item.trim()).find(Boolean) || '';
  const cleaned = line
    .replace(/^[#>*`_~\-\s]+/, '')
    .replace(/[`*_~]/g, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(cleaned).slice(0, maxLength).join('');
}

const TASK_NOTIFICATION_FALLBACK_TITLES = {
  codex: 'Codex 已完成任务',
  claude: 'Claude 已完成任务',
  gpt: 'GPT 已完成任务',
};

function taskNotificationIdentity(payload, source = 'task') {
  const data = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const cwd = firstPayloadText(data, ['cwd', 'working_directory', 'working-directory']);
  const project = cleanTaskLine(
    firstPayloadText(data, ['project', 'project_name', 'project-name', 'projectName'])
      || (cwd && path.isAbsolute(cwd) ? path.basename(path.normalize(cwd)) : ''),
    48
  );
  const concreteTitle = firstPayloadText(data, [
    'last_assistant_message',
    'last-assistant-message',
    'lastAssistantMessage',
    'task_title',
    'task-title',
    'taskTitle',
    'task_name',
    'task-name',
    'taskName',
    'last_user_message',
    'last-user-message',
    'lastUserMessage',
    'prompt',
    'user_prompt',
    'user-prompt',
    'userPrompt',
    'message',
    'title',
  ]);
  return {
    project,
    title: cleanTaskLine(concreteTitle, 120)
      || TASK_NOTIFICATION_FALLBACK_TITLES[source]
      || '任务已完成',
  };
}

function normalizeCredentialInput(value, id, createdAt) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const service = String(value.service || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const account = String(value.account || '').trim().slice(0, 320);
  const password = typeof value.password === 'string' ? value.password.slice(0, 4096) : '';
  if (!service || !account || !password) return null;
  return {
    id: String(id || value.id || `credential-${Date.now().toString(36)}`),
    service,
    account,
    password,
    createdAt: Number.isFinite(createdAt) ? createdAt : Number.isFinite(value.createdAt) ? value.createdAt : Date.now(),
  };
}

function parseSmartLinkMetadata(value) {
  const source = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed;
  try { parsed = JSON.parse(source); } catch (error) { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const clean = (text, limit) => Array.from(String(text || '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()).slice(0, limit).join('');
  return {
    title: clean(parsed.title, 80),
    category: clean(parsed.category, 14),
  };
}

// 剪贴板默认关闭（DEFAULT_FEATURES.clip = false），关着就不该轮询系统剪贴板。
// 原实现收了 features 却完全不用，恒定返回 recordHistory: true，于是无论用户有没有
// 在菜单栏打开这个功能，主进程都在每 500ms 读一次粘贴板——剪贴板里躺着大图时
// （实测一张截图 1.9MB PNG + 6.9MB Photoshop 数据）主进程空转就能吃掉三成 CPU，
// 面板展开和拖拽都会明显卡顿。
// 全局快捷键始终不注册：原 Cmd+Shift+V 已撤销，app:open-clip 仅由菜单栏驱动。
function clipboardServicePolicy(features) {
  const source = features && typeof features === 'object' && !Array.isArray(features) ? features : {};
  return {
    recordHistory: source.clip === true,
    registerGlobalShortcut: false,
  };
}

function createClipboardImageFingerprint(width, height, pngBuffer) {
  if (!Buffer.isBuffer(pngBuffer) || pngBuffer.length === 0) return null;
  const safeWidth = Number.isFinite(width) ? Math.max(0, Math.trunc(width)) : 0;
  const safeHeight = Number.isFinite(height) ? Math.max(0, Math.trunc(height)) : 0;
  const digest = crypto.createHash('sha256').update(pngBuffer).digest('hex');
  return `${safeWidth}x${safeHeight}:${digest}`;
}

function prepareClipboardImagePayload(mimeType, sourceBuffer, size = {}) {
  if (!Buffer.isBuffer(sourceBuffer) || sourceBuffer.length === 0) return null;
  const fingerprint = createClipboardImageFingerprint(size.width, size.height, sourceBuffer);
  if (!fingerprint) return null;
  return {
    fingerprint,
    mimeType: String(mimeType || '').toLowerCase(),
    sourceBuffer,
    // Electron 44 已经从 ClipboardItem 给出了 PNG 原始字节。复用它可以避免每次
    // 轮询都让 nativeImage 再做一次昂贵的 PNG 编码；其他格式只在确认为新图片后转换。
    pngBuffer: String(mimeType || '').toLowerCase() === 'image/png' ? sourceBuffer : null,
  };
}

function installLocalWebContentsGuards(webContents) {
  if (!webContents
    || typeof webContents.setWindowOpenHandler !== 'function'
    || typeof webContents.on !== 'function') return false;
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  webContents.on('will-navigate', (event) => event.preventDefault());
  return true;
}

async function runOwnedOpenDialog(showOpenDialog, owner, options, updateGuard = () => {}) {
  if (typeof showOpenDialog !== 'function') throw new TypeError('showOpenDialog must be a function');
  updateGuard(1);
  try {
    return owner
      ? await showOpenDialog(owner, options)
      : await showOpenDialog(options);
  } finally {
    updateGuard(-1);
  }
}

async function readClipboardObservation(items, options = {}) {
  const rows = Array.isArray(items) ? items.filter((item) => item && Array.isArray(item.types)) : [];
  const concealed = rows.some((item) => item.types.some((type) => (
    String(type || '').toLowerCase().includes('org.nspasteboard.concealedtype')
  )));
  if (concealed) return { concealed: true, text: '', image: null };

  let text = '';
  for (const item of rows) {
    if (!item.types.includes('text/plain') || typeof item.getType !== 'function') continue;
    try {
      const blob = await item.getType('text/plain');
      text = typeof blob?.text === 'function' ? await blob.text() : '';
    } catch (error) {
      text = '';
    }
    if (text) break;
  }

  let image = null;
  if (options.includeImage === true) {
    const preferredTypes = ['image/png', 'image/jpeg', 'image/webp'];
    for (const mimeType of preferredTypes) {
      const item = rows.find((row) => row.types.includes(mimeType));
      if (!item || typeof item.getType !== 'function') continue;
      try {
        const blob = await item.getType(mimeType);
        if (blob && typeof blob.arrayBuffer === 'function') {
          const buffer = Buffer.from(await blob.arrayBuffer());
          if (buffer.length > 0) image = { mimeType, buffer };
        }
      } catch (error) {
        image = null;
      }
      if (image) break;
    }
  }

  return { concealed: false, text, image };
}

function screenRecordingProbePolicy(status) {
  if (status === 'granted') return { hasAccess: true, inspectWindowTitles: true };
  if (['not-determined', 'denied', 'restricted'].includes(status)) {
    return { hasAccess: false, inspectWindowTitles: false };
  }
  // 未知状态下不主动触碰捕获 API，避免在启动阶段制造不可预测的系统弹窗。
  return { hasAccess: true, inspectWindowTitles: false };
}

function taskNotificationWindowPolicy(state) {
  const active = Boolean(state && state.active);
  const queueLength = Math.max(0, Number(state && state.queueLength) || 0);
  return !active && queueLength === 0 ? 'dispose' : 'retain';
}

function reduceClipboardObservation(state, observation, options = {}) {
  const previous = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  const current = observation && typeof observation === 'object' && !Array.isArray(observation)
    ? observation
    : {};
  const normalizedState = {
    textFingerprint: typeof previous.textFingerprint === 'string'
      ? previous.textFingerprint
      : null,
    imageFingerprint: typeof previous.imageFingerprint === 'string'
      ? previous.imageFingerprint
      : null,
  };
  if (current.concealed === true) return { state: normalizedState, record: null };

  const text = typeof current.text === 'string' && current.text ? current.text : null;
  const imageFingerprint = typeof current.imageFingerprint === 'string' && current.imageFingerprint
    ? current.imageFingerprint
    : null;
  const nextState = { ...normalizedState };
  if (text) nextState.textFingerprint = text;
  if (imageFingerprint) nextState.imageFingerprint = imageFingerprint;

  let record = null;
  if (options.baseline !== true) {
    if (text && text !== normalizedState.textFingerprint) {
      record = { type: 'text', text };
    } else if (!text && imageFingerprint && imageFingerprint !== normalizedState.imageFingerprint) {
      record = { type: 'image', imageFingerprint };
    }
  }
  return { state: nextState, record };
}

function createWorkspacePersistenceGate() {
  let lastSignature = null;
  const signatureFor = (storage, destination = '') => {
    if (!storage || typeof storage !== 'object' || Array.isArray(storage)) return null;
    return JSON.stringify([
      String(destination || ''),
      Object.keys(storage).sort().map((key) => [key, storage[key]]),
    ]);
  };
  return {
    shouldWrite(storage, destination = '') {
      const signature = signatureFor(storage, destination);
      return signature !== null && signature !== lastSignature;
    },
    markWritten(storage, destination = '') {
      const signature = signatureFor(storage, destination);
      if (signature !== null) lastSignature = signature;
    },
  };
}

function hoverSpacePollingPolicy({ shortcut, visible, mode } = {}) {
  return {
    enabled: shortcut === 'Space' && visible === true && mode === 'collapsed',
    intervalMs: 60,
  };
}

const CONFIGURABLE_FEATURES = new Set(['todo', 'notes', 'links', 'recordings', 'credentials', 'clip']);

function updateFeaturePreference(features, featureId, enabled) {
  if (!CONFIGURABLE_FEATURES.has(featureId) || typeof enabled !== 'boolean') return null;
  const source = features && typeof features === 'object' && !Array.isArray(features) ? features : {};
  return { ...source, [featureId]: enabled, home: true };
}

// 网易云音乐提供稳定的「控制」菜单。优先按菜单名称点击，避免依赖用户可修改的
// 全局快捷键；中英文名称同时保留，系统语言变化后仍能工作。
function neteaseMenuSpec(action) {
  if (action === 'play') return { trigger: ['播放', 'Play'], already: ['暂停', 'Pause'], playing: true };
  if (action === 'pause') return { trigger: ['暂停', 'Pause'], already: ['播放', 'Play'], playing: false };
  if (action === 'next') return { trigger: ['下一个', 'Next'], already: [], playing: true };
  if (action === 'previous') return { trigger: ['上一个', 'Previous'], already: [], playing: true };
  return null;
}

function classifyNeteaseControlError(error) {
  const message = String(error && (error.stderr || error.message) || error || '');
  if (/(-1743)|not (?:authori[sz]ed|permitted) to send apple events|automation permission/i.test(message)) {
    return 'automation_permission_required';
  }
  if (/(-1719)|(-25211)|assistive access|accessibility permission/i.test(message)) {
    return 'accessibility_permission_required';
  }
  return 'netease_control_failed';
}

function neteaseTrackIdFromOpenFiles(output) {
  const matches = String(output || '').matchAll(/\/online_play_cache\/(\d+)-_-_[^\n]*\.uc!?/g);
  let trackId = '';
  for (const match of matches) trackId = match[1];
  return trackId;
}

function normalizeNeteaseTrackMetadata(value) {
  let track = value;
  if (typeof value === 'string') {
    try { track = JSON.parse(value); } catch (error) { return null; }
  }
  if (!track || typeof track !== 'object' || Array.isArray(track)) return null;
  const id = String(track.id || '').trim();
  const title = String(track.name || track.title || '').trim();
  if (!/^\d+$/.test(id) || !title) return null;
  const artists = Array.isArray(track.artists)
    ? track.artists.map((artist) => String(artist && artist.name || '').trim()).filter(Boolean)
    : [];
  const albumValue = track.album && typeof track.album === 'object' ? track.album : {};
  const artworkValue = String(albumValue.picUrl || albumValue.cover || '').trim();
  return {
    id,
    title,
    artist: artists.join(' / '),
    album: String(albumValue.name || albumValue.albumName || '').trim(),
    durationMs: Math.max(0, Number(track.duration) || 0),
    artworkUrl: /^https?:\/\//i.test(artworkValue)
      ? artworkValue.replace(/^http:\/\//i, 'https://')
      : '',
  };
}

function parseNeteaseLrc(text) {
  const lines = [];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const timestamps = [...rawLine.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!timestamps.length) continue;
    const lyric = rawLine.replace(/\[[^\]]+\]/g, '').trim();
    if (!lyric) continue;
    for (const stamp of timestamps) {
      const fraction = String(stamp[3] || '0').padEnd(3, '0').slice(0, 3);
      const timeMs = (Number(stamp[1]) * 60 + Number(stamp[2])) * 1000 + Number(fraction);
      if (Number.isFinite(timeMs)) lines.push({ timeMs, text: lyric });
    }
  }
  return lines.sort((left, right) => left.timeMs - right.timeMs);
}

function normalizeNeteaseLyricsPayload(payload) {
  let value = payload;
  if (typeof payload === 'string') {
    try { value = JSON.parse(payload); } catch (error) { return []; }
  }
  if (!value || typeof value !== 'object' || value.nolyric === true || value.uncollected === true) return [];
  const original = parseNeteaseLrc(value.lrc && value.lrc.lyric);
  const translated = parseNeteaseLrc(value.tlyric && value.tlyric.lyric);
  const translationsByTime = new Map(translated.map((line) => [line.timeMs, line.text]));
  return original.slice(0, 600).map((line) => {
    const translation = translationsByTime.get(line.timeMs) || '';
    return translation && translation !== line.text ? { ...line, translation } : line;
  });
}

function clampNeteasePosition(value, durationMs = 0) {
  const duration = Math.max(0, Number(durationMs) || 0);
  const position = Math.max(0, Number(value) || 0);
  return duration > 0 ? Math.min(position, duration) : position;
}

async function controlNeteaseMusic(action, dependencies = {}, currentPlaying = false) {
  if (!['play', 'pause', 'next', 'previous'].includes(action)) {
    return { ok: false, error: 'invalid_action', running: false, playing: false };
  }

  const isRunning = dependencies.isRunning;
  const launch = dependencies.launch;
  const sendControl = dependencies.sendControl;
  const sleep = dependencies.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  if (![isRunning, launch, sendControl].every((dependency) => typeof dependency === 'function')) {
    return { ok: false, error: 'music_control_unavailable', running: false, playing: false };
  }

  let running = await isRunning();
  let bootstrapped = false;
  if (!running) {
    if (action !== 'play') return { ok: false, error: 'no_active_session', running: false, playing: false };
    const launched = await launch();
    if (!launched) return { ok: false, error: 'launch_failed', running: false, playing: false };
    for (let attempt = 0; attempt < 30; attempt += 1) {
      running = await isRunning();
      if (running) break;
      await sleep(200);
    }
    if (!running) return { ok: false, error: 'launch_failed', running: false, playing: false };
    bootstrapped = true;
    await sleep(3000);
  }

  const controlResult = await sendControl(action);
  if (!controlResult || controlResult.ok !== true) {
    return {
      ok: false,
      error: controlResult && controlResult.error || 'netease_control_failed',
      running: true,
      playing: Boolean(currentPlaying),
    };
  }
  const playing = typeof controlResult.playing === 'boolean'
    ? controlResult.playing
    : action !== 'pause';
  return { ok: true, running: true, playing, bootstrapped };
}

module.exports = {
  fetchBoundedBytes,
  isPrivateAddress,
  decodeHtmlEntities,
  extractPageTitle,
  extractFaviconHref,
  recordingExtension,
  normalizeWindowRows,
  todoReminderState,
  todoReminderTimerDelay,
  taskNotificationIdentity,
  normalizeCredentialInput,
  parseSmartLinkMetadata,
  parseSmartMaterialMetadata,
  selectTranscriptionSettings,
  panelBlurPolicy,
  clipboardServicePolicy,
  createClipboardImageFingerprint,
  prepareClipboardImagePayload,
  installLocalWebContentsGuards,
  runOwnedOpenDialog,
  readClipboardObservation,
  screenRecordingProbePolicy,
  taskNotificationWindowPolicy,
  reduceClipboardObservation,
  createWorkspacePersistenceGate,
  hoverSpacePollingPolicy,
  updateFeaturePreference,
  neteaseMenuSpec,
  classifyNeteaseControlError,
  neteaseTrackIdFromOpenFiles,
  normalizeNeteaseTrackMetadata,
  parseNeteaseLrc,
  normalizeNeteaseLyricsPayload,
  clampNeteasePosition,
  controlNeteaseMusic,
};
