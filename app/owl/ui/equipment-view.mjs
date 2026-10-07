export const GLASSES_KEYS=Object.freeze(['glassesFront','glassesUp','glassesLeft30','glassesLeft60','glassesRight30','glassesRight60']);
const all=(images,keys)=>keys.every(k=>Boolean(images[k]));
function canPreview(state,images,slot,id){
  const category=slot==='room'?'chair':slot,item=state.collectionCatalog?.items.find(i=>i.id===id&&i.category===category);
  if(item?.assetState==='missing')return false;
  if(category==='accessory')return id===null||id==='red-scarf'||id==='round-glasses'&&all(images,GLASSES_KEYS);
  if(category==='chair'&&id==='stool')return true;
  if(category==='chair'&&id==='reading-chair')return all(images,['chairBack','chairFront']);
  if(id===null)return true;
  if(!item||!images.roomBase)return false;
  const asset=images.roomItems?.[id];return category==='chair'?Boolean(asset?.back&&asset?.front):Boolean(asset?.image);
}
export function resolveAppearance(state,images={},preview=null){
  // Keep schema2 history: null/red-scarf both mean no glasses, never no scarf.
  const previewEntries=Object.entries(preview||{}),availablePreview=previewEntries.filter(([slot,id])=>canPreview(state,images,slot,id));
  const previewAvailable=previewEntries.length>0&&availablePreview.length===previewEntries.length;
  const earned=state.collection?.owned||state.unlocked||[],unlocked=state.testAccess?.enabled?[...earned,...(state.collectionCatalog?.items||[]).filter(i=>i.assetState!=='missing').map(i=>i.id)]:earned;
  const equipment={...(state.testAccess?.enabled?state.testAccess.equipment:state.equipment),...Object.fromEntries(availablePreview)},desired={accessory:equipment.accessory==='round-glasses'?'round-glasses':null,room:equipment.chair||equipment.room||'stool'};
  const missing=[];let accessory=desired.accessory,room=desired.room;
  if(accessory==='round-glasses'&&!unlocked.includes(accessory)&&preview?.accessory!==accessory)accessory=null;
  const item=state.collectionCatalog?.items.find(i=>i.id===room&&i.category==='chair');
  if(!['stool','reading-chair'].includes(room)&&!item||room!=='stool'&&!unlocked.includes(room)&&preview?.chair!==room)room='stool';
  if(accessory==='round-glasses'&&!all(images,GLASSES_KEYS)){missing.push('圆眼镜');accessory=null;}
  if(room==='reading-chair'&&!all(images,['chairBack','chairFront'])){missing.push('阅读椅');room='stool';}
  if(!['stool','reading-chair'].includes(room)&&!images.roomItems?.[room]){missing.push(item?.name||'椅子');room='stool';}
  const names={stool:'初始凳子','reading-chair':'阅读椅','round-glasses':'圆眼镜'};
  for(const i of state.collectionCatalog?.items||[])names[i.id]=i.name;
  const visible=[names[room],'红围巾',accessory?names[accessory]:'不戴眼镜'];
  for(const category of (state.collectionCatalog?.categories||[]).map(c=>c.id).filter(c=>!['chair','accessory'].includes(c)))if(equipment[category]&&!images.roomItems?.[equipment[category]])missing.push(names[equipment[category]]||'历史收藏');
  return {desired,accessory,room,previewAvailable,equipment:{...equipment,chair:room,room},missing,key:JSON.stringify(equipment),
    summary:missing.length?'已选择'+missing.join('、')+'，画面暂未更新；当前为'+visible.join(' · '):visible.join(' · '),
    label:'红围巾猫头鹰'+(accessory?'戴着圆眼镜':'')+'坐在'+names[room]+'上，陪伴你'};
}
export function equipmentOptions(state){
  const glasses=(state.unlocked||[]).includes('round-glasses'),chair=(state.unlocked||[]).includes('reading-chair');
  return {glasses:{disabled:!glasses,label:glasses?'圆眼镜 · 可装备':'圆眼镜 · 累计5分钟解锁'},chair:{disabled:!chair,label:chair?'阅读椅 · 可装备':'阅读椅 · 累计10分钟解锁'}};
}
