'use strict';

// Product rules only: no renderer clock, IO, network or user-activity inference.
const MINUTE = 60_000;
const { CATALOG: COLLECTION_CATALOG, SLOTS, LEGACY_SLOTS, BASE_SLOTS, DEFAULTS, ID, awardOwned, equip, equipSet } = require('./collection.cjs');
// Historical schemas could only earn these two IDs. New configurable items
// must never make an otherwise valid old save appear corrupt.
const {validatePositions}=require('./room-layout.cjs');
const {saveRoomSet,validateArrangement}=require('../ui/placement-rules.cjs');
const {DEFAULT_ORDER,validateOrder}=require('../ui/layer-order.cjs');
const CATALOG=Object.freeze([{id:'round-glasses',name:'圆眼镜',slot:'accessory',minutes:5},{id:'reading-chair',name:'阅读椅',slot:'room',minutes:10}]);

function initialState() {
  return { schema: 9, positions:{}, layerOrder:[...DEFAULT_ORDER], revision: 0, totalFocusMs: 0, creditedMinutes: 0,
    unlocked: [], collection: {owned:[],catalogVersion:COLLECTION_CATALOG.version}, equipment: {...DEFAULTS,room:'stool'},
    active: null, settledFocusMs: 0, processed: [], lastOutcome: null, lastSavedAt: null,
    preferences: { reducedMotion: false } };
}

function validateState(s, allowLegacy = false) {
  const int = n => Number.isSafeInteger(n) && n >= 0;
  if (!s || !(s.schema === 9 || (allowLegacy && [2,3,4,5,6,7,8].includes(s.schema))) || !int(s.revision) || !int(s.totalFocusMs)
    || !int(s.creditedMinutes) || s.creditedMinutes !== Math.floor(s.totalFocusMs / MINUTE)
    || (s.schema === 2 ? !Array.isArray(s.records) : (!int(s.settledFocusMs) || Object.hasOwn(s,'records')))
    || !Array.isArray(s.processed) || s.processed.length > 128
    || !s.processed.every(id => typeof id === 'string')
    || new Set(s.processed).size !== s.processed.length || !Array.isArray(s.unlocked)
    || new Set(s.unlocked).size !== s.unlocked.length || !s.equipment
    || !(s.lastSavedAt === null || Number.isFinite(s.lastSavedAt))
    || !s.preferences || typeof s.preferences.reducedMotion !== 'boolean') {
    throw new Error('保存格式不正确；原文件已保留，不能用空白进度覆盖。');
  }
  if([4,5,6,7,8,9].includes(s.schema)){
    const c=s.collection;if(!c||!Array.isArray(c.owned)||new Set(c.owned).size!==c.owned.length||!c.owned.every(id=>typeof id==='string'&&ID.test(id))||typeof c.catalogVersion!=='string'||!c.catalogVersion||c.owned.length!==s.unlocked.length||!c.owned.every(id=>s.unlocked.includes(id)))throw Error('永久收藏记录不一致；原文件已保留。');
    if(s.equipment.room!==s.equipment.chair)throw Error('座位兼容记录不一致。');
    const slots=s.schema===4?LEGACY_SLOTS:s.schema>=7?SLOTS:BASE_SLOTS;
    for(const slot of slots){const id=s.equipment[slot];if(!(id===DEFAULTS[slot]||slot==='accessory'&&id===null||typeof id==='string'&&ID.test(id)&&c.owned.includes(id)))throw Error('装扮记录不正确；停止写入以保护存档。');const item=COLLECTION_CATALOG.items.find(i=>i.id===id);if(item&&item.category!==slot)throw Error('装扮类别不正确。');}
    if(s.testAccess!==undefined){
      const t=s.testAccess;if(!t||typeof t.enabled!=='boolean'||!t.equipment||t.equipment.room!==t.equipment.chair)throw Error('体验装扮记录不正确；原文件已保留。');
      for(const slot of slots){const id=t.equipment[slot];if(!(id===DEFAULTS[slot]||slot==='accessory'&&id===null||typeof id==='string'&&ID.test(id)))throw Error('体验装扮记录不正确；原文件已保留。');const item=COLLECTION_CATALOG.items.find(i=>i.id===id);if(item&&item.category!==slot)throw Error('体验装扮类别不正确；原文件已保留。');}
    }
  }else{
    const expected=CATALOG.filter(i=>s.creditedMinutes>=i.minutes).map(i=>i.id);
    if(s.unlocked.length!==expected.length||!expected.every(id=>s.unlocked.includes(id)))throw Error('成长与解锁记录不一致；停止写入以保护存档。');
    if(![null,'red-scarf','round-glasses'].includes(s.equipment.accessory)||!['stool','reading-chair'].includes(s.equipment.room)||s.equipment.accessory==='round-glasses'&&!s.unlocked.includes('round-glasses')||s.equipment.room==='reading-chair'&&!s.unlocked.includes('reading-chair'))throw Error('装扮记录不正确；停止写入以保护存档。');
  }
  if([5,6,7,8,9].includes(s.schema)){
    if(s.schema===5&&[s.positions,s.testAccess?.positions].filter(Boolean).some(p=>Object.values(p).some(v=>Object.hasOwn(v,'size'))))throw Error('旧版本包含未知比例字段，保留原存档。');
    if(s.schema<8)for(const owner of [s,s.testAccess].filter(Boolean)){for(const value of Object.values(owner.positions||{}))if(value.size?.some(n=>n>1536))throw Error('旧版本包含未知展示尺寸；保留原存档。');for(const [slot,id]of Object.entries(owner.equipment)){const item=COLLECTION_CATALOG.items.find(i=>i.id===id&&i.category===slot);if(item&&!item.scene?.placement&&owner.positions?.[id]?.size)throw Error('旧版本此物件不支持保存展示比例；保留原存档。');}}
    if(s.schema<9)for(const owner of [s,s.testAccess].filter(Boolean))for(const [slot,id]of Object.entries(owner.equipment)){const item=COLLECTION_CATALOG.items.find(i=>i.id===id&&i.category===slot),size=owner.positions?.[id]?.size;if(size&&item?.scene&&!item.scene.placement&&size[0]/item.scene.size[0]>3)throw Error('旧版本包含未知展示比例；保留原存档。');}
    validatePositions(s.positions,{legacy:s.schema<9});validateArrangement(COLLECTION_CATALOG,s.equipment,s.positions,{legacy:s.schema<9});
    if(s.testAccess)try{validatePositions(s.testAccess.positions,{legacy:s.schema<9});validateArrangement(COLLECTION_CATALOG,s.testAccess.equipment,s.testAccess.positions,{legacy:s.schema<9});}catch(e){throw Error('体验'+e.message);}
  }
  const ids = new Set();
  if(s.schema>=7){validateOrder(s.layerOrder);if(s.testAccess)validateOrder(s.testAccess.layerOrder);}
  let recorded = s.schema !== 2 ? s.settledFocusMs : 0;
  for (const r of s.schema === 2 ? s.records : []) {
    if (!r || typeof r.id !== 'string' || ids.has(r.id) || !int(r.focusMs)
      || !int(r.durationMs) || r.focusMs > r.durationMs
      || !['completed', 'ended'].includes(r.outcome) || typeof r.task !== 'string'
      || !int(r.marksEarned) || !Number.isFinite(r.startedAt) || !Number.isFinite(r.endedAt))
      throw new Error('专注记录不正确；原文件已保留。');
    ids.add(r.id); recorded += r.focusMs;
  }
  const a = s.active;
  if (a) {
    if (typeof a.id !== 'string' || ids.has(a.id) || !['focus', 'break'].includes(a.kind)
      || !['running', 'paused'].includes(a.status) || !int(a.durationMs) || a.durationMs < 1000
      || !int(a.elapsedMs) || a.elapsedMs >= a.durationMs || typeof a.task !== 'string'
      || !int(a.startCreditedMinutes) || a.startCreditedMinutes > s.creditedMinutes || !Number.isFinite(a.startedAt))
      throw new Error('活动计时记录不正确；原文件已保留。');
    if (a.kind === 'focus') recorded += a.elapsedMs;
  }
  if (recorded !== s.totalFocusMs) throw new Error('累计时间与逐次记录不一致；停止写入。');
  return s;
}

function award(s,catalog=COLLECTION_CATALOG) { s.creditedMinutes=Math.floor(s.totalFocusMs/MINUTE);awardOwned(s,catalog); }

function finish(s, now, outcome) {
  const a = s.active;
  if (a.kind === 'focus') s.settledFocusMs += a.elapsedMs;
  s.lastOutcome = { kind: a.kind, outcome, at: now,
    message: a.kind === 'focus' ? (outcome === 'completed' ? '本轮专注完成，可以开始休息。' : '本轮已提前结束，实际计入的时间已保存。')
      : (outcome === 'completed' ? '休息结束；准备好后手动开始下一轮。' : '休息已结束。') };
  s.active = null;
}

function advance(s, deltaMs, now, catalog=COLLECTION_CATALOG) {
  if (!s.active || s.active.status !== 'running' || deltaMs <= 0) return false;
  const a = s.active;
  const counted = Math.min(Math.floor(deltaMs), a.durationMs - a.elapsedMs);
  if (!counted) return false;
  a.elapsedMs += counted;
  if (a.kind === 'focus') { s.totalFocusMs += counted; award(s,catalog); }
  if (a.elapsedMs >= a.durationMs) finish(s, now, 'completed');
  return true;
}

function interrupt(s, reason, now) {
  if (!s.active) return false;
  s.active.status = 'paused';
  s.active.reason = reason;
  s.lastOutcome = { kind: s.active.kind, outcome: 'interrupted', at: now, message: reason };
  return true;
}

function command(s, c, now, makeId, catalog=COLLECTION_CATALOG) {
  if (!c || typeof c.requestId !== 'string' || !/^[\w-]{1,100}$/.test(c.requestId))
    throw new Error('操作标识无效。');
  if (s.processed.includes(c.requestId)) return false;
  if (['pause', 'resume', 'end'].includes(c.type)
    && (!s.active || c.sessionId !== s.active.id)) throw new Error('这轮状态已改变，请使用当前窗口显示的这一轮。');
  switch (c.type) {
    case 'start':
    case 'break': {
      if (s.active) throw new Error('已有一轮进行中；两个窗口共用这一轮，请先结束。');
      const minutes = c.minutes ?? (c.type === 'break' ? 5 : 25);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > (c.type === 'break' ? 60 : 180))
        if (c.seconds === undefined) throw new Error('专注时长为1–180分钟，休息时长为1–60分钟。');
      const durationSeconds = c.seconds ?? minutes * 60;
      if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > (c.type === 'break' ? 3600 : 10800))
        throw new Error('时长为1秒至180分钟；休息最多60分钟。');
      const task = c.type === 'break' ? '休息' : (typeof c.task === 'string' ? c.task.trim().slice(0, 200) : '');
      if (!task) throw new Error('先写下这次想做的一件事。');
      s.active = { id: makeId(), kind: c.type === 'break' ? 'break' : 'focus', status: 'running',
        task, durationMs: durationSeconds * 1000, elapsedMs: 0, startedAt: now,
        startCreditedMinutes: s.creditedMinutes, reason: null };
      s.lastOutcome = null;
      break;
    }
    case 'pause': s.active.status = 'paused'; s.active.reason = '你已暂停；暂停时间不计入成长。'; break;
    case 'resume': s.active.status = 'running'; s.active.reason = null; s.lastOutcome = null; break;
    case 'end': finish(s, now, 'ended'); break;
    case 'preferences':
      if (typeof c.reducedMotion !== 'boolean') throw new Error('动效偏好无效。');
      s.preferences.reducedMotion = c.reducedMotion;
      break;
    case 'equip': equip(s,c.slot,c.item,catalog);break;
    case 'equip-set': equipSet(s,c.equipment,c.expectedEquipment,c.expectedTestEnabled,catalog);break;
    case 'room-set': saveRoomSet(s,c,catalog,equipSet);break;
    case 'test-access':
      if(typeof c.enabled!=='boolean')throw Error('全道具体验开关无效。');
      if(!s.testAccess)s.testAccess={enabled:false,equipment:structuredClone(s.equipment),positions:structuredClone(s.positions),layerOrder:[...s.layerOrder]};
      s.testAccess.enabled=c.enabled;
      break;
    default: throw new Error('不支持的操作。');
  }
  s.processed.push(c.requestId);
  s.processed = s.processed.slice(-128);
  return true;
}

function migrateState(s) {
  if(s?.schema===9)return validateState(s);
  if(s?.schema===8){validateState(s,true);const n=structuredClone(s);n.schema=9;return validateState(n);}
  if(s?.schema===7){validateState(s,true);const n=structuredClone(s);n.schema=8;return migrateState(n);}
  if(s?.schema===6){validateState(s,true);const n=structuredClone(s);n.schema=7;n.layerOrder=[...DEFAULT_ORDER];n.equipment={...DEFAULTS,...s.equipment};if(n.testAccess){n.testAccess.equipment={...DEFAULTS,...n.testAccess.equipment};n.testAccess.layerOrder=[...DEFAULT_ORDER];}return migrateState(n);}
  if(s?.schema===5){validateState(s,true);const n=structuredClone(s);n.schema=6;return migrateState(n);}
  if(s?.schema===4){if(Object.hasOwn(s,'positions')||s.testAccess&&Object.hasOwn(s.testAccess,'positions'))throw Error('旧版本包含未知位置字段，保留原存档。');validateState(s,true);const n=structuredClone(s);n.schema=6;n.positions={};n.equipment={...DEFAULTS,...s.equipment};if(n.testAccess){n.testAccess.equipment={...DEFAULTS,...n.testAccess.equipment};n.testAccess.positions={};}return migrateState(n);}
  if(s?.schema===3){if(Object.hasOwn(s,'collection'))throw Error('旧版本包含未知收藏字段，原文件已保留。');validateState(s,true);const migrated=structuredClone(s);migrated.schema=4;migrated.collection={owned:[...s.unlocked],catalogVersion:COLLECTION_CATALOG.version};migrated.equipment={...DEFAULTS,...s.equipment,chair:s.equipment.room};return migrateState(validateState(migrated,true));}
  if (s?.schema === 2) {
    validateState(s, true);
    const migrated = structuredClone(s);
    migrated.schema = 3;
    migrated.settledFocusMs = s.records.reduce((total,r) => total+r.focusMs,0);
    delete migrated.records;
    return migrateState(validateState(migrated,true));
  }
  if (s?.schema !== 1) return validateState(s);
  if (!s.equipment || ![null, 'desk-plant'].includes(s.equipment.room)
    || !Array.isArray(s.unlocked) || s.unlocked.some(id => !['round-glasses', 'desk-plant'].includes(id)))
    throw new Error('旧工程装扮记录无法识别，原文件必须保留。');
  const migrated = structuredClone(s);
  migrated.schema = 2;
  migrated.preferences = { reducedMotion: false };
  migrated.unlocked = migrated.unlocked.map(id => id === 'desk-plant' ? 'reading-chair' : id);
  migrated.equipment.room = migrated.equipment.room === 'desk-plant' ? 'reading-chair' : 'stool';
  return migrateState(validateState(migrated, true));
}
module.exports = { MINUTE, CATALOG, initialState, validateState, migrateState, advance, interrupt, command };
