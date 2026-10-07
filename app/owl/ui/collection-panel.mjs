import {bindPlacementInput} from './placement-input.mjs';
import { CollectionDraft } from './collection-draft.mjs';
const imageCache=new Map();
function image(src){if(!imageCache.has(src))imageCache.set(src,new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error('素材待准备'));i.src=new URL(src,import.meta.url).href;}));return imageCache.get(src);}
// Thumbnails contain the real object. Legacy atlas padding is measured, never shown as a fake item.
async function thumbnail(canvas,item){
 const t=item.thumbnail,ctx=canvas.getContext('2d');ctx.clearRect(0,0,256,256);
 if(item.developmentPlaceholder){ctx.fillStyle='#D7DDD0';ctx.fillRect(12,12,232,232);ctx.fillStyle='#35422E';ctx.font='24px sans-serif';ctx.fillText('开发占位',24,112);return;}
 if(!t||item.assetState==='missing')throw Error('素材待准备');
  if(t.src&&item.assetState==='ready'){ctx.save();if(item.scene?.placement?.mirrorX){ctx.translate(256,0);ctx.scale(-1,1);}ctx.drawImage(await image(t.src),0,0,256,256);ctx.restore();return;}
 const stage=document.createElement('canvas');stage.width=stage.height=1254;const s=stage.getContext('2d',{willReadFrequently:true});
 if(t.sprite){const a=await image(t.sprite);s.drawImage(a,...t.crop,0,0,t.crop[2],t.crop[3]);}else if(t.src)s.drawImage(await image(t.src),0,0);else for(const src of t.layers||[])s.drawImage(await image(src),0,0);
 const pixels=s.getImageData(0,0,1254,1254).data;let l=1254,r=0,top=1254,b=0;for(let y=0;y<1254;y++)for(let x=0;x<1254;x++)if(pixels[(y*1254+x)*4+3]>8){l=Math.min(l,x);r=Math.max(r,x);top=Math.min(top,y);b=Math.max(b,y);}
 if(r<=l||b<=top)throw Error('素材待准备');const scale=Math.min(224/(r-l+1),224/(b-top+1)),w=(r-l+1)*scale,h=(b-top+1)*scale;ctx.drawImage(stage,l,top,r-l+1,b-top+1,(256-w)/2,(256-h)/2,w,h);
}
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const icons={lamp:'M5 9h14L16 2H8L5 9Zm7 0v11m-5 0h10',rug:'m3 9 9-5 9 5-9 11L3 9Zm3 1 6-3 6 3-6 7-6-7',chair:'M6 13V5q6-3 12 0v8M4 12v7h16v-7M6 19v3m12-3v3',plant:'M8 15h8l-1 7H9l-1-7Zm4 0V4m0 5C3 11 3 4 5 3c5 0 7 3 7 6Zm0-2c1-5 5-6 8-4 0 5-5 7-8 4',accessory:'M10 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm12 0a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm-12 0h4'};
icons['portable-light']='M7 10V6a5 5 0 0 1 10 0v4M6 10h12l2 11H4L6 10Z';
for(const side of ['left','right']){icons['corner-vine-'+side]='M5 2q-2 11 10 19M5 7q10-6 11 0-8 7-11 0Zm2 7q-8 1-3 6 7 0 3-6';icons['corner-curtain-'+side]='M3 3h18M4 4q8 0 3 8l-4 9h7L7 12q9-2 13-8';}
icons['string-lights']='M2 4q10 7 20 0M5 6v5m7-3v5m7-7v5M3 12h4v4H3Zm7 2h4v4h-4Zm7-2h4v4h-4Z';
const icon=category=>{const n=node('span',undefined,'category-art');n.setAttribute('aria-hidden','true');n.innerHTML=`<svg viewBox="0 0 24 24"><path d="${icons[category]||'M4 4h16v16H4V4Zm4 4h8v8H8V8'}"/></svg>`;return n;};
export function bindCollectionPanel({root,details,onPreview=()=>{},onSave,onOpenChange=()=>{},placementBinder=bindPlacementInput}){
 let state,busy=false,category='lamp',signature,disposed=false,previewReady=false,drawGeneration=0,saving=false,lastOwned,rewardGeneration=0,saveError='';
 const draft=new CollectionDraft(),thumbnailStates=new Map(),thumbnailKey=item=>JSON.stringify([item.id,item.assetState,item.thumbnail]);
 const get=id=>root.querySelector('#'+id),launcher=get('collection-open'),toggle=get('wardrobe-toggle'),panel=get('collection-panel'),tabs=get('collection-tabs'),cards=get('collection-cards'),preview=get('collection-preview'),name=get('collection-preview-name'),message=get('collection-message'),confirm=get('collection-confirm'),cancel=get('collection-cancel');
 const reward=get('collection-reward'),rewardQueue=[];let shownReward;
 const isOpen=()=>Boolean(draft.equipment);
 const publish=()=>{onPreview({...draft.equipment},structuredClone(draft.positions),[...draft.layerOrder]);refreshSelected();};
 const placement=placementBinder({root,draft,onChange:()=>{publish();draw();},onMessage:text=>{message.textContent=text;}});
 get('collection-defaults').addEventListener('click',()=>{try{draft.resetAll();saveError='';publish();placement.repaint();}catch(e){saveError=e.message;refreshSelected();}});
 function close(){if(saving)return;placement.setMode(false);draft.clear();previewReady=false;panel.hidden=true;preview.hidden=true;onPreview(null);onOpenChange(false);toggle?.setAttribute('aria-expanded','false');signature=null;toggle?.focus?.();}
 function open(){if(!state||busy||state.fault)return;saveError='';details.open=false;draft.begin(state);panel.hidden=false;preview.hidden=false;previewReady=false;toggle?.setAttribute('aria-expanded','true');onOpenChange(true);signature=null;onPreview({...draft.equipment},structuredClone(draft.positions),[...draft.layerOrder]);draw();}
 function refreshSelected(){if(!state||!isOpen())return;
  const changed=draft.changedSlots,items=changed.map(slot=>state.collectionCatalog.items.find(i=>i.category===slot&&i.id===draft.equipment[slot])).filter(Boolean);
  const unavailable=items.find(i=>i.assetState==='missing'||thumbnailStates.get(thumbnailKey(i))==='failed'),locked=items.find(i=>!i.canEquip),loading=items.some(i=>thumbnailStates.get(thumbnailKey(i))!=='ready');
  confirm.disabled=busy||saving||Boolean(state.fault)||!draft.changed||Boolean(unavailable||locked)||loading||!previewReady;
  confirm.textContent=draft.changed?'放好':'已放好';
  message.textContent=saveError||(state.fault?'保存暂不可用，原装扮已保留。':unavailable?'素材暂不可用，请换其他道具或取消。':locked?`${locked.name}还未获得，可先试摆；${locked.unlockMinutes===null?'门槛待确认。':`再专注${locked.remainingMinutes}分钟解锁。`}`:draft.changed&&!previewReady||loading?'正在准备画面…':draft.changed?(state.testAccess?.enabled?'测试试摆 · 放好才保存，不增加永久收藏。':'正在房间试摆 · 放好才保存。'):(state.testAccess?.enabled?'全部现有道具可体验':'选一件，看看它在房间里的样子。'));
  if(!saveError&&!state.fault&&!unavailable&&!locked&&draft.equipment){const warnings=globalThis.owlPlacementRules.arrangementWarnings(state.collectionCatalog,draft.equipment,draft.positions);if(warnings.length)message.textContent+=' '+warnings[0]+'；可以继续摆放或保存。';}
  if(!saveError&&!state.fault&&!unavailable&&!locked&&!loading&&previewReady&&draft.equipment.tabletop&&!globalThis.owlPlacementRules.tabletopParent(draft.equipment,state.collectionCatalog))message.textContent+=' '+ '摆件已保留，放上带桌面的家具后显示。';
  get('collection-mode').textContent=state.testAccess?.enabled?'全道具体验':'我的收藏';
 }
 function choose(item){if(!isOpen())return;saveError='';draft.choose(item.category,item.id);name.textContent=item.name;previewReady=false;onPreview({...draft.equipment},structuredClone(draft.positions),[...draft.layerOrder]);signature=null;draw();placement.choose(item.id);}
 function stateLabel(item){if(item.category==='tabletop'&&draft.equipment?.tabletop===item.id&&!globalThis.owlPlacementRules.tabletopParent(draft.equipment,state.collectionCatalog))return '已选择 · 待放桌上';return draft.equipment?.[item.category]===item.id?'已使用':item.equipped?'已放好':item.owned?'已拥有':item.developmentPlaceholder?'开发占位':item.testAvailable?'测试可用':item.unlockMinutes===null?'门槛待确认':`再专注${item.remainingMinutes}分钟`;}
 function draw(){if(!state?.collectionCatalog||!isOpen())return;
  const c=state.collectionCatalog,sig=JSON.stringify([c,draft.equipment,category,busy,saving,Boolean(state.fault)]);if(sig===signature){refreshSelected();return;}signature=sig;const generation=++drawGeneration,scroll=cards.scrollLeft||0;
  tabs.replaceChildren();for(const cat of c.categories){const b=node('button');b.type='button';b.dataset.category=cat.id;b.title=cat.name;b.setAttribute('aria-label',cat.name);b.setAttribute('aria-pressed',String(category===cat.id));b.append(icon(cat.id),node('span',cat.name,'category-name'));b.addEventListener('click',()=>{category=cat.id;signature=null;draw();});tabs.append(b);}
  cards.replaceChildren();const order=i=>i.id===draft.equipment[i.category]?0:i.owned?1:i.testAvailable?2:3;
  for(const item of c.items.filter(i=>i.category===category).sort((a,b)=>order(a)-order(b))){
   const b=node('button',undefined,'collection-card');b.type='button';b.dataset.item=item.id;b.setAttribute('aria-pressed',String(draft.equipment[category]===item.id));b.setAttribute('aria-label',`${item.name}，${stateLabel(item)}，点击在房间试摆`);b.title=`${item.name} · ${stateLabel(item)}`;
   const art=node('div',undefined,'collection-art'),canvas=document.createElement('canvas');canvas.width=canvas.height=256;canvas.setAttribute('aria-hidden','true');art.append(canvas);const missing=node('span','素材待准备','collection-missing');missing.hidden=item.assetState!=='missing';art.append(missing);
   if(!missing.hidden)canvas.hidden=true;else{const key=thumbnailKey(item);if(!thumbnailStates.has(key))thumbnailStates.set(key,'loading');thumbnail(canvas,item).then(()=>{if(disposed||generation!==drawGeneration)return;thumbnailStates.set(key,'ready');refreshSelected();},()=>{if(disposed||generation!==drawGeneration)return;thumbnailStates.set(key,'failed');canvas.hidden=true;missing.hidden=false;b.dataset.assetFailed='true';refreshSelected();});}
   b.append(art,node('strong',item.name),node('span',stateLabel(item),'collection-state'));b.disabled=busy||saving||Boolean(state.fault);b.addEventListener('click',()=>choose(item));cards.append(b);
  }
  const removals={lamp:['收起灯具',null],rug:['收起地毯',null],plant:['收起盆栽',null],accessory:['摘下眼镜','red-scarf']};
  if(!['chair','accessory'].includes(category)&&!removals[category])removals[category]=['收起这类物件',null];
 if(removals[category]){const [label,id]=removals[category],b=node('button',label,'text-button collection-remove');b.type='button';b.dataset.remove=category;b.disabled=busy||saving||Boolean(state.fault);b.addEventListener('click',()=>choose({id,category,name:label}));cards.append(b);}
  cards.scrollLeft=scroll;const old=state.collection.owned.filter(id=>!c.items.some(i=>i.id===id));get('collection-retained').textContent=old.length?`已保留${old.length}件历史收藏`:'';refreshSelected();
 }
 function showReward(){if(!reward||shownReward||!rewardQueue.length)return;shownReward=rewardQueue.shift();const item=state.collectionCatalog.items.find(i=>i.id===shownReward);if(!item){shownReward=null;showReward();return;}reward.hidden=false;get('collection-reward-name').textContent=item.name;get('collection-reward-note').textContent='有效专注带来的新收藏';const n=++rewardGeneration;thumbnail(get('collection-reward-canvas'),item).catch(()=>{if(n===rewardGeneration)get('collection-reward-note').textContent='新收藏已保存，实物图暂不可用。';});}
 function dismissReward(){shownReward=null;if(reward)reward.hidden=true;rewardGeneration++;showReward();}
 launcher.addEventListener('click',open);toggle?.addEventListener('click',()=>isOpen()?close():open());get('collection-back').addEventListener('click',close);cancel.addEventListener('click',close);
 confirm.addEventListener('click',async()=>{refreshSelected();if(confirm.disabled||!onSave)return;saving=true;refreshSelected();try{const result=await onSave(draft.command());if(result?.ok){saving=false;close();}else saveError=result?.error||'保存未确认，试摆仍保留。';}catch(e){saveError='保存未确认：'+e.message;}finally{saving=false;refreshSelected();}});
 get('collection-reward-dismiss')?.addEventListener('click',dismissReward);get('collection-reward-place')?.addEventListener('click',()=>{const item=state.collectionCatalog.items.find(i=>i.id===shownReward);dismissReward();open();if(item){category=item.category;choose(item);}});
 const escape=e=>{if(e.key==='Escape'&&isOpen()){e.preventDefault();close();}};document.addEventListener('keydown',escape);
 return {
  update(next,isBusy){state=next;busy=isBusy;if(lastOwned===undefined)lastOwned=new Set(next.collection.owned);else for(const id of next.collection.owned)if(!lastOwned.has(id)){lastOwned.add(id);rewardQueue.push(id);}showReward();
   if(isOpen()&&!saving&&draft.stale(next)){close();if(!busy)open();message.textContent='装扮已在其他入口更新，试摆已回到当前装扮。';}draw();},
  setPreviewReady(value){previewReady=Boolean(value);refreshSelected();},
  open,close,dispose(){disposed=true;placement.dispose();draft.clear();document.removeEventListener('keydown',escape);},
 };
}
