'use strict';
const raw=require('../config/collection-catalog.json');
const {SLOTS,LEGACY_SLOTS,BASE_SLOTS,DEFAULTS}=require('../ui/room-slots.mjs');
const ID=/^[a-z][a-z0-9-]{0,79}$/;
function validateCatalog(value){
 if(!value||typeof value.version!=='string'||!value.version||!Array.isArray(value.items)||!Array.isArray(value.categories))throw Error('收藏目录格式无效。');
 const categories=value.categories.map(c=>c.id);if(categories.length!==SLOTS.length||new Set(categories).size!==SLOTS.length||!SLOTS.every(id=>categories.includes(id)))throw Error('收藏分类无效。');
 const ids=new Set();for(const i of value.items){if(typeof i.id!=='string'||!ID.test(i.id)||ids.has(i.id)||!SLOTS.includes(i.category)||typeof i.name!=='string'||!i.name||!['legacy','missing','ready'].includes(i.assetState)||!(i.unlockMinutes===null||Number.isSafeInteger(i.unlockMinutes)&&i.unlockMinutes>=0)||i.starter&&i.unlockMinutes!==0)throw Error('收藏物品/门槛无效。');ids.add(i.id);
  for(const p of [i.thumbnail?.src,i.thumbnail?.sprite,...(i.thumbnail?.layers||[]),i.scene?.src,i.scene?.back,i.scene?.front,i.scene?.hanging?.src].filter(Boolean))if(typeof p!=='string'||!p.startsWith('assets/')||p.includes('..')||/[\\:#?]/.test(p))throw Error('收藏资源必须为可信本地路径。');
 }
 const oldGlasses=value.items.find(i=>i.id==='round-glasses'),oldChair=value.items.find(i=>i.id==='reading-chair');if(!oldGlasses||oldGlasses.category!=='accessory'||!oldChair||oldChair.category!=='chair')throw Error('不能移除旧眼镜或椅子目录兼容项。');
 require('../ui/room-geometry.cjs').validateRoomCatalog(value);
 return structuredClone(value);
}
const CATALOG=validateCatalog(raw);
function awardOwned(s,catalog=CATALOG){
 const seen=new Set(s.collection.owned);for(const item of catalog.items)if(!item.starter&&item.unlockMinutes!==null&&s.creditedMinutes>=item.unlockMinutes)seen.add(item.id);
 s.collection.owned=[...seen];s.unlocked=[...seen];s.collection.catalogVersion=catalog.version;
}
function displayEquipment(s){return s.testAccess?.enabled?s.testAccess.equipment:s.equipment;}
function itemStates(s,catalog=CATALOG){return catalog.items.map(i=>{const owned=Boolean(i.starter||s.collection.owned.includes(i.id)),testAvailable=Boolean(s.testAccess?.enabled&&i.assetState!=='missing');return {...structuredClone(i),owned,testAvailable,canEquip:owned||testAvailable,equipped:displayEquipment(s)[i.category]===i.id,remainingMinutes:i.unlockMinutes===null?null:Math.max(0,i.unlockMinutes-s.creditedMinutes)};});}
function equip(s,slot,id,catalog=CATALOG){
 const category=slot==='room'?'chair':slot;if(!SLOTS.includes(category))throw Error('装扮位置无效。');
 const value=id===null&&category==='accessory'?null:id;
 if(value!==DEFAULTS[category]&&!(category==='accessory'&&value===null)){
  const item=catalog.items.find(i=>i.id===value);if(!item||item.category!==category)throw Error('物品类别与装备位置不匹配。');if(!item.starter&&!s.collection.owned.includes(item.id)&&!s.testAccess?.enabled)throw Error('这件物品还没有解锁。');if(item.assetState==='missing')throw Error('素材待准备，已拥有的权益仍会保留。');
 }
 const equipment=displayEquipment(s);equipment[category]=value;if(category==='chair')equipment.room=value;
}
function equipSet(s,values,expected,expectedTestEnabled,catalog=CATALOG){
 const valid=v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===SLOTS.length&&SLOTS.every(slot=>Object.hasOwn(v,slot));
 if(!valid(values)||!valid(expected)||typeof expectedTestEnabled!=='boolean')throw Error('整组装扮格式无效。');
 const current=displayEquipment(s);
 if(Boolean(s.testAccess?.enabled)!==expectedTestEnabled||SLOTS.some(slot=>current[slot]!==expected[slot]))throw Error('装扮已在其他入口改变，请重新试摆。');
 // Validate the complete trial on a copy; one rejected slot cannot partly save it.
 const candidate=structuredClone(s);
 for(const slot of SLOTS)if(values[slot]!==current[slot])equip(candidate,slot,values[slot],catalog);
 if(s.testAccess?.enabled)s.testAccess.equipment=candidate.testAccess.equipment;
 else s.equipment=candidate.equipment;
}
module.exports={SLOTS,LEGACY_SLOTS,BASE_SLOTS,DEFAULTS,ID,CATALOG,validateCatalog,awardOwned,itemStates,equip,equipSet,displayEquipment};
