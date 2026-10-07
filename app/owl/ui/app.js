'use strict';
import { createOwlScene } from './owl-scene.mjs';
import { bindWidgetDrag } from './widget-drag.mjs';
import { bindActivityRecords } from './activity-records.mjs';
import { equipmentOptions } from './equipment-view.mjs';
import { bindCollectionPanel } from './collection-panel.mjs';
const $ = id => document.getElementById(id);
let collectionPanel;
const scene = createOwlScene({canvas:$('owl-canvas'),fallback:$('owl-fallback'),notice:$('motion-note'),interactionElement:$('owl-interaction'),roomElement:document.querySelector('main'),response:$('owl-response'),onAppearance:look=>{$('equipment-summary').textContent=look.summary;collectionPanel?.setPreviewReady(look.canConfirmPreview);}});
const compact = new URLSearchParams(location.search).get('mode') === 'compact';
if (compact) document.body.classList.add('compact');
const widget = new URLSearchParams(location.search).get('mode') === 'widget';
if(widget){document.body.classList.add('widget');$('other-view').hidden=true;$('widget-size').hidden=false;$('widget-start').hidden=false;$('widget-task-slot').append($('task-setup'));$('widget-task-slot').append($('end'));}
$('more').addEventListener('toggle',()=>{
  const open=$('more').open;
  scene.setInteractionPaused(open);
  if(!widget)return;
  document.querySelector('header').inert=open;
  document.querySelector('.actions').inert=open;
  if(open)$('widget-task-slot').append($('error'));
  else document.querySelector('.actions').append($('error'));
});
const standaloneShell=new URLSearchParams(location.search).get('shell')==='standalone';
if(standaloneShell)document.body.classList.add('standalone');
$('other-view').textContent = standaloneShell ? (compact?'打开主窗口':'打开小窗口') : (compact?'打开独立窗口':'打开工具箱');
$('widget-size').addEventListener('click',()=>window.owlFocus.resizeWidget().catch(e=>{$('error').textContent=e.message;}));
const disposeWidgetDrag=widget?bindWidgetDrag(window.owlFocus):()=>{};
const disposeActivityRecords=bindActivityRecords(window.owlFocus);
let current, busy = false, unsubscribe, lastConfiguredSeconds;
collectionPanel=bindCollectionPanel({root:document,details:$('more'),onPreview:(equipment,positions,layerOrder)=>scene.setPreviewEquipment(equipment,positions,layerOrder),onSave:extra=>act('room-set',extra),onOpenChange:open=>{document.querySelector('main').classList.toggle('dressing',open);scene.setInteractionPaused(open);}});
const fmt = ms => { const s = Math.ceil(ms / 1000); return String(Math.floor(s / 60)).padStart(2,'0') + ':' + String(s % 60).padStart(2,'0'); };
function primaryType(s) {
  if (s.active) return s.active.status === 'running' ? 'pause' : 'resume';
  return s.lastOutcome?.kind === 'focus' && s.lastOutcome.outcome === 'completed' ? 'break' : 'start';
}
function render(state) {
  if (current && state.revision < current.revision) return;
  current = state;
  $('development-art-note').hidden=!state.collectionCatalog?.room?.developmentPreview;
  if(state.configuredFocusSeconds&&state.configuredFocusSeconds!==lastConfiguredSeconds){lastConfiguredSeconds=state.configuredFocusSeconds;$('minutes').value=String(lastConfiguredSeconds/60);}
  scene.update(state);
  collectionPanel.update(state,busy);
  $('test-access').checked=Boolean(state.testAccess?.enabled);$('test-access').disabled=busy||Boolean(state.fault);
  $('test-access-note').textContent=state.testAccess?.enabled?'全部现有道具可直接体验；关闭后恢复正常装扮。':'不增加专注时长或永久收藏；关闭后恢复正常装扮。';
  $('collection-open').textContent=state.testAccess?.enabled?'打开收藏箱 · 全部可体验':'打开收藏箱';
  $('wardrobe-toggle').title=state.testAccess?.enabled?'收藏与装扮 · 全道具体验':'收藏与装扮';
  const a = state.active, running = a?.status === 'running';
  const type = primaryType(state);
  $('status').textContent = a ? (a.kind === 'focus' ? '专注' : '休息') + (running ? '进行中' : '已暂停') : (state.lastOutcome?.outcome === 'completed' ? '本轮已完成' : '准备开始');
  if(state.testAccess?.enabled)$('status').textContent+=' · 全道具体验';
  const time=fmt(a ? a.durationMs-a.elapsedMs : Number($(type==='break'?'break-minutes':'minutes').value || (type==='break'?5:25))*60000);
  if($('remaining').textContent!==time||$('remaining').children.length!==time.length){$('remaining').replaceChildren(...[...time].map(char=>{const span=document.createElement('span');span.className=char===':'?'timer-colon':'timer-digit';span.textContent=char;return span;}));}
  $('active-task').textContent = a?.task || (type==='break' ? '休息一下，准备好后再开始下一轮' : '这次想做哪一件事？');
  $('task-setup').hidden = Boolean(a) || type==='break';
  $('primary-action').textContent = {start:'开始专注',pause:'暂停',resume:'确认并继续',break:'开始休息'}[type];
  $('primary-action').dataset.action = type;
  $('primary-action').title = a?.reason || $('active-task').textContent;
  if(widget){$('primary-action').textContent={start:'开始专注',pause:'暂停',resume:'继续',break:'开始休息'}[type];$('widget-start').hidden=Boolean(a)||type!=='start';}
  $('end').hidden = !a; $('start').hidden = Boolean(a) || type!=='break'; $('break').hidden = Boolean(a) || type==='break';
  for(const id of ['primary-action','start','end','break','accessory','room','reduced-motion']) $(id).disabled = busy || Boolean(state.fault);
  $('minutes').disabled = Boolean(a); $('break-minutes').disabled = Boolean(a);
  $('notice').textContent = state.fault || (a?.reason?.includes('上次退出') ? '上次进度已保留，确认后继续。' : a?.reason?.includes('中断') ? '检测到中断，确认后继续。' : '') || '';
  $('recovery-info').textContent = a?.reason || state.lastOutcome?.message || '';
  $('growth').textContent = state.creditedMinutes + ' 枚成长印记';
  $('total').textContent = '累计有效专注 ' + Math.floor(state.totalFocusMs/60000) + ' 分 ' + Math.floor(state.totalFocusMs/1000)%60 + ' 秒';
  const options=equipmentOptions(state),glasses=$('accessory').querySelector('option[value="round-glasses"]'),chair=$('room').querySelector('option[value="reading-chair"]');
  glasses.disabled=options.glasses.disabled;glasses.textContent=options.glasses.label;chair.disabled=options.chair.disabled;chair.textContent=options.chair.label;
  $('accessory').value = state.equipment.accessory==='round-glasses'?'round-glasses':'red-scarf'; $('room').value = state.equipment.room;
  $('reduced-motion').checked = state.preferences?.reducedMotion === true;
  $('saved').textContent = state.lastSavedAt?'已保存在这台 Mac':'这次努力会留在这里';
}
async function act(type, extra={}) {
  if(busy || !current) return;
  busy=true; $('error').textContent=''; render(current);
  try {
    const result=await window.owlFocus.command({type,requestId:crypto.randomUUID(),sessionId:current.active?.id,...extra});
    if(result.state) render(result.state);
    if(!result.ok) $('error').textContent=result.error;
    return result;
  } catch(e) { $('error').textContent='操作未确认：'+e.message; }
  finally {busy=false;if(current)render(current);}
}
async function start() {
  if(!$('task').value.trim()) { if(widget)$('more').open=true; $('error').textContent='先写下这次的一件事。'; $('task-setup').hidden=false; $('task').focus();return; }
  const seconds=Math.round(Number($('minutes').value)*60);
  if(window.owlFocus.defaults)try{await window.owlFocus.defaults({seconds});}catch(e){$('error').textContent=e.message;return;}
  return act('start',{task:$('task').value,seconds});
}
$('primary-action').addEventListener('click',()=>{
  if (!current || busy) return;
  const type=primaryType(current);
  if(type==='start') start();
  else if(type==='break') act('break',{minutes:Number($('break-minutes').value)});
  else act(type);
});
$('start').addEventListener('click',start);
$('widget-start').addEventListener('click',async()=>{await start();if(current?.active)$('more').open=false;});
$('end').addEventListener('click',()=>act('end'));
$('break').addEventListener('click',()=>act('break',{minutes:Number($('break-minutes').value)}));
for(const slot of ['accessory','room']) $(slot).addEventListener('change',event=>act('equip',{slot,item:event.target.value || null}));
$('reduced-motion').addEventListener('change',event=>act('preferences',{reducedMotion:event.target.checked}));
$('test-access').addEventListener('change',event=>act('test-access',{enabled:event.target.checked}));
for(const id of ['minutes','break-minutes']) $(id).addEventListener('input',()=>{if(current && !current.active)render(current);});
$('other-view').addEventListener('click',()=>window.owlFocus.openOtherView());
$('close-panel').addEventListener('click',()=>{$('more').open=false;});
if(!window.owlFocus) $('error').textContent='请通过本地工程入口打开。';
else { unsubscribe=window.owlFocus.subscribe(render);Promise.resolve(window.owlFocus.defaults?.()).then(defaults=>{if(defaults?.seconds)$('minutes').value=String(defaults.seconds/60);return window.owlFocus.snapshot();}).then(render).catch(e=>{$('error').textContent='读取存档失败：'+e.message;}); }
window.addEventListener('beforeunload',()=>{collectionPanel.dispose();disposeActivityRecords();disposeWidgetDrag();unsubscribe?.();scene.dispose();});
