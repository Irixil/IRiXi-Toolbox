'use strict';
const placementLayout=typeof module!=='undefined'?require('../src/room-layout.cjs'):globalThis.owlRoomLayout;
const geometryTools=typeof module!=='undefined'?require('./room-geometry.cjs'):globalThis.owlRoomGeometry;
const layers=typeof module!=='undefined'?require('./layer-order.cjs'):globalThis.owlLayerOrder;
const {validatePositions,constrainPosition,itemPosition}=placementLayout;
const ROOM_AREA=[0,260,1024,1000];
const point=(p={x:0,y:0})=>({x:p.x,y:p.y});
const shifted=(b,p)=>[b[0]+p.x,b[1]+p.y,b[2],b[3]];
const equalPositions=(a,b)=>{const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&a[k].x===b[k].x&&a[k].y===b[k].y&&JSON.stringify(a[k].size)===JSON.stringify(b[k].size)&&Boolean(a[k].mirrorX)===Boolean(b[k].mirrorX));};
function tabletopParent(equipment,catalog){const item=catalog?.items?.find(i=>i.id===equipment['side-furniture']);return item?.category==='side-furniture'&&item.supportsTabletop&&item.scene?.tabletopArea&&item.scene?.tabletopAnchor?item:null;}
function positionKey(item,equipment){return item.category==='tabletop'?`${equipment['side-furniture']}--${item.id}`:item.id;}
function selectedScene(item,equipment,positions,catalog){
 const original=item?.scene;if(!original)return original;
 const key=positionKey(item,equipment),saved=positions[key],flipped=Boolean(saved?.mirrorX);
 if(flipped&&!supportsSize(item))throw Error('此坐姿组不单独镜像；保留原存档。');
 if(!original.placement){
  const size=saved?.size;if(!size&&!flipped)return original;
  if(!supportsSize(item))throw Error('此物件保持原比例；保留原存档。');
  const scale=size?size[0]/original.size[0]:original.display?.scale||1;
  if(size&&Math.abs(scale-size[1]/original.size[1])>1e-9||scale<.1||scale>32)throw Error('已保存物件的比例无效；保留原存档。');
  const anchor=original.display?.anchor||original.contacts?.[0]||[original.visualBounds[0]+original.visualBounds[2]/2,original.visualBounds[1]+original.visualBounds[3]];
  return{...original,display:{scale,anchor,mirrorX:flipped}};
 }
 const custom=Object.hasOwn(positions,key),displaySize=custom?(saved.size||original.originalDisplaySize||original.placement.displaySize):original.placement.displaySize;
 const placement={...original.placement,displaySize,anchor:[...original.placement.anchor],mirrorX:Boolean(original.placement.mirrorX)!==flipped};
 if(flipped)placement.anchor[0]=original.size[0]-placement.anchor[0];
 if(item.category==='tabletop'){const parent=tabletopParent(equipment,catalog);if(!parent)return undefined;placement.position=selectedScene(parent,equipment,positions,catalog).tabletopAnchor;}
 const scale=displaySize[0]/original.size[0];if(Math.abs(scale-displaySize[1]/original.size[1])>1e-9)throw Error('已保存物件的比例无效；保留原存档。');
 const origin=placement.position.map((n,j)=>n-placement.anchor[j]*scale),reflect=r=>flipped?[original.size[0]-r[0]-r[2],r[1],r[2],r[3]]:r,transform=r=>{r=reflect(r);return[origin[0]+r[0]*scale,origin[1]+r[1]*scale,r[2]*scale,r[3]*scale];};
 const result={...original,placement,visualBounds:transform(original.sourceVisualBounds),collisionBounds:transform(original.sourceCollisionBounds)};
 if(original.sourceTabletopArea){result.tabletopArea=transform(original.sourceTabletopArea);const a=[...original.sourceTabletopAnchor];if(flipped)a[0]=original.size[0]-a[0];result.tabletopAnchor=a.map((n,j)=>origin[j]+n*scale);}
 return result;
}
function resolvedOffset(item,equipment,positions,catalog){
 const key=positionKey(item,equipment),offset=point(itemPosition(item,positions,key));
 // A newly defaulted floor lamp yields to an already customized front plant.
 // Neither a saved lamp transform nor the user's plant is ever overwritten.
 if(item.category!=='floor-light'||Object.hasOwn(positions,key))return offset;
 const plant=catalog.items.find(i=>i.id===equipment['foreground-plant']);
 if(!plant||!Object.hasOwn(positions,plant.id))return offset;
 const scene=selectedScene(item,equipment,positions,catalog),ps=selectedScene(plant,equipment,positions,catalog),pb=shifted(ps.visualBounds,point(positions[plant.id]));
 if(!geometryTools.intersects(shifted(scene.visualBounds,offset),pb))return offset;
 for(const x of [pb[0]-scene.visualBounds[2]-8-scene.visualBounds[0],pb[0]+pb[2]+8-scene.visualBounds[0]]){
  const next={x,y:offset.y},bounded=constrainPosition(next,{bounds:scene.visualBounds,area:safeArea(item)});
  if(!geometryTools.intersects(shifted(scene.visualBounds,bounded),pb))return bounded;
 }
 return offset; // Arrangement validation exposes a genuine no-space conflict.
}
function roleOffset(equipment,positions){return point(positions[equipment.chair||equipment.room]||{x:0,y:0});}
function validateDependencies(equipment,catalog){const parent=catalog.items.find(i=>i.id===equipment['side-furniture']);if(parent?.supportsTabletop&&!tabletopParent(equipment,catalog))throw Error('桌面接点尚未准备，已保留摆件选择。');}
function safeArea(item){return item.scene?.moveArea||ROOM_AREA;}
function bindings(catalog,equipment,positions={}){
 validatePositions(positions);validateDependencies(equipment,catalog);const role=roleOffset(equipment,positions),protectedRect=[380+role.x,530+role.y,290,340];const rows=[];
 for(const category of catalog.categories){
  const id=equipment[category.id];if(!id||category.id==='accessory'||category.id==='tabletop'&&!tabletopParent(equipment,catalog))continue;const item=catalog.items.find(i=>i.id===id&&i.category===category.id);if(!item||item.assetState==='missing')continue;
  let bounds,collision,area=safeArea(item),protectedRects=[];const s=selectedScene(item,equipment,positions,catalog)||{};
  if(positions[positionKey(item,equipment)]?.size&&!supportsSize(item))throw Error('此物件不支持保存展示比例；保留原存档。');
  if(category.id==='chair'){bounds=[224,458.2,576,640];collision=s.collisionBounds||[285,618,454,467];}
  else{if(!s.visualBounds||!s.collisionBounds)continue;const g=geometryTools.renderedGeometry({...s,contacts:s.contacts||[]});bounds=g.visualBounds;collision=g.collisionBounds;}
  const key=positionKey(item,equipment),offset=resolvedOffset(item,equipment,positions,catalog);let parent={x:0,y:0};
  if(category.id==='tabletop'){
   const table=catalog.items.find(i=>i.id===equipment['side-furniture']),tableScene=selectedScene(table,equipment,positions,catalog);if(!tableScene?.tabletopArea)throw Error('桌面范围尚待准备。');parent=point(itemPosition(table,positions));bounds=shifted(bounds,parent);collision=shifted(collision,parent);const a=tableScene.tabletopArea;area=shifted([a[0],a[1]-bounds[3],a[2],a[3]+bounds[3]],parent);
  }
  if(id==='rug-pattern')area=[0,260,1024,1002];
  if(category.id==='wall-art')area=s.moveArea||[0,260,1024,270];
  if(category.id==='pendant'){
   area=s.moveArea||[0,280,1024,700];
   if(s.hanging){const [x,y]=s.hanging.attachment,left=Math.min(bounds[0],x),top=Math.min(bounds[1],y);bounds=[left,top,Math.max(bounds[0]+bounds[2],x+1)-left,Math.max(bounds[1]+bounds[3],y+1)-top];}
  }
  if(['foreground-plant','pendant','wall-art','floor-light','tabletop','side-furniture'].includes(category.id))protectedRects=[protectedRect];
  // Paintings are behind the role. Reserve the actual head/cup band while
  // allowing the approved taller left-upper frame into the unused wall space.
  if(category.id==='wall-art')protectedRects=[[380+role.x,555+role.y,290,315]];
  if(category.id==='foreground-plant')protectedRects.push([480+role.x,1000+role.y,250,110]);
  // Default composition stays grounded. Editing is deliberately wider and
  // never cages editing. Collection selection and recovery handle lost props.
  const defaultGeometry={bounds,area,protectedRects},geometry={bounds,area,protectedRects:[],free:true};
  rows.push({id,key,category:category.id,item,scene:s,offset,parent,bounds,collision,geometry,defaultGeometry,protectedRects,worldBounds:shifted(bounds,offset),worldCollision:shifted(collision,offset),translation:{x:offset.x+parent.x,y:offset.y+parent.y}});
 }
 return rows;
}
function constrainItem(catalog,equipment,positions,id,next){const row=bindings(catalog,equipment,positions).find(r=>r.id===id);if(!row)throw Error('这件道具还不能布置；请先准备素材并放入房间。');return {key:row.key,position:constrainPosition(next,row.geometry)};}
function arrangementWarnings(catalog,equipment,positions){
 const rows=bindings(catalog,equipment,positions);
 const messages=[];
 for(const r of rows)if(r.protectedRects.some(p=>geometryTools.intersects(r.worldBounds,p)))messages.push(`${r.item.name}可能挡住猫头鹰或茶杯`);
 const solid=new Set(['chair','lamp','plant','floor-light','portable-light','foreground-plant','side-furniture']);
 for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){const a=rows[i],b=rows[j];if(solid.has(a.category)&&solid.has(b.category)&&geometryTools.intersects(a.worldCollision,b.worldCollision))messages.push(`${a.item.name}与${b.item.name}有重叠`);}
 return messages;
}
function validateArrangement(catalog,equipment,positions,{defaults=false,legacy=false}={}){
 const rows=bindings(catalog,equipment,positions);
 for(const r of rows){const good=constrainPosition(r.offset,defaults?r.defaultGeometry:legacy?(r.category==='tabletop'?{bounds:r.bounds,area:r.defaultGeometry.area,protectedRects:[]}:{bounds:r.bounds,area:ROOM_AREA,protectedRects:[],visibleMargin:96}):r.geometry);if(Math.abs(good.x-r.offset.x)>1e-5||Math.abs(good.y-r.offset.y)>1e-5)throw Error(`${r.item.name}超出可找回的摆放范围，请移动或恢复默认。`);}
 if(defaults){const warnings=arrangementWarnings(catalog,equipment,positions);if(warnings.length)throw Error(warnings[0]+'，请调整默认位置。');}
 return rows;
}
// Reset keeps the selected objects. If their original default footprints meet,
// find a nearby safe table position in the draft instead of leaving a dead end.
// A bounded proportional reduction can make room on a crowded foreground floor.
function defaultPositions(catalog,equipment){
 try{validateArrangement(catalog,equipment,{},{defaults:true});return {};}catch(original){
  const row=bindings(catalog,equipment,{}).find(r=>r.category==='side-furniture');
  if(!row)throw original;
  const horizontal=[0];for(let n=16;n<=384;n+=16)horizontal.push(-n,n);
  const vertical=[0];for(let n=16;n<=192;n+=16)vertical.push(n,-n);
  for(const scale of row.scene.placement?[1,.94,.88,.82,.76]:[1]){
   const size=row.scene.placement?.displaySize.map(n=>n*scale),seed={[row.key]:size?{...row.offset,size}:row.offset};
   for(const y of vertical)for(const x of horizontal){
    const {key,position}=constrainItem(catalog,equipment,seed,row.id,{x:row.offset.x+x,y:row.offset.y+y});
    const candidate={[key]:size?{...position,size}:position};
    try{
     const child=bindings(catalog,equipment,candidate).find(r=>r.category==='tabletop');
     if(child&&scale!==1){
      candidate[child.key]={...child.offset,size:child.scene.placement.displaySize.map(n=>n*scale)};
      const adjusted=constrainItem(catalog,equipment,candidate,child.id,child.offset);
      candidate[child.key]={...adjusted.position,size:candidate[child.key].size};
     }
     validateArrangement(catalog,equipment,candidate,{defaults:true});return candidate;
    }catch{}
   }
  }
  throw original;
 }
}
const SIZE_MIN=.5,SIZE_MAX=5;
function baseDisplaySize(item){const s=item?.scene;return s?.placement?[...s.placement.displaySize]:s?.size?.map(n=>n*(s.display?.scale||1));}
function supportsSize(item){return Boolean(item&&item.assetState==='ready'&&item.scene?.src&&item.category!=='chair'&&item.category!=='accessory');}
function sizeInfo(catalog,equipment,positions,id){const row=bindings(catalog,equipment,positions).find(r=>r.id===id);if(!row||!supportsSize(row.item))return {supported:false,min:SIZE_MIN,max:SIZE_MAX};const base=baseDisplaySize(row.item),size=row.scene.placement?[...row.scene.placement.displaySize]:row.item.scene.size.map(n=>n*(row.scene.display?.scale||1));return{supported:true,base,size,factor:size[0]/base[0],min:SIZE_MIN,max:SIZE_MAX};}
function resizeItem(catalog,equipment,positions,id,factor){
 const row=bindings(catalog,equipment,positions).find(r=>r.id===id),info=sizeInfo(catalog,equipment,positions,id);if(!info.supported)throw Error('椅子和猫头鹰保持坐姿原比例，可继续移动或调整前后。');if(!Number.isFinite(factor)||factor<SIZE_MIN-1e-8||factor>SIZE_MAX+1e-8)throw Error('大小范围为50%–500%。');factor=Math.max(SIZE_MIN,Math.min(SIZE_MAX,factor));
 const ratio=factor/info.factor,candidate={...positions,[row.key]:{...positions[row.key],...row.offset,size:info.base.map(n=>n*factor)}};
 if(row.category==='side-furniture'){
  const child=bindings(catalog,equipment,positions).find(r=>r.category==='tabletop');if(child){const ci=sizeInfo(catalog,equipment,positions,child.id),nextFactor=ci.factor*ratio;if(nextFactor<SIZE_MIN-1e-8||nextFactor>SIZE_MAX+1e-8)throw Error('桌面摆件已到大小边界，请先调整摆件或收起后再缩放桌子。');candidate[child.key]={...positions[child.key],x:child.offset.x*ratio,y:child.offset.y*ratio,size:ci.size.map(n=>n*ratio)};}
 }
 try{validateArrangement(catalog,equipment,candidate);}catch(error){if(/超出可找回|不适合/.test(error.message))throw Error('缩放后会移出可见范围，请先向房间内移动，再调整大小。');throw error;}return candidate;
}

function mirrorItem(catalog,equipment,positions,id){
 const row=bindings(catalog,equipment,positions).find(r=>r.id===id);if(!row||!supportsSize(row.item))throw Error('椅子和猫头鹰保持原坐姿，不单独镜像。');
 const candidate={...positions,[row.key]:{...positions[row.key],...row.offset,size:sizeInfo(catalog,equipment,positions,id).size,mirrorX:!Boolean(positions[row.key]?.mirrorX)}};
 // Reflect the entire local tabletop arrangement, not merely the table PNG.
 if(row.category==='side-furniture'){
  const child=bindings(catalog,equipment,positions).find(r=>r.category==='tabletop');
  if(child)candidate[child.key]={...positions[child.key],x:-child.offset.x,y:child.offset.y,size:sizeInfo(catalog,equipment,positions,child.id).size,mirrorX:!Boolean(positions[child.key]?.mirrorX)};
 }
 validateArrangement(catalog,equipment,candidate);return candidate;
}

function saveRoomSet(state,c,catalog,equipSet){
 const owner=state.testAccess?.enabled?state.testAccess:state,current=validatePositions(owner.positions),next=validatePositions(c.positions),expected=validatePositions(c.expectedPositions);
 if(!equalPositions(current,expected))throw Error('房间已在其他入口改变，请重新试摆。');
 const order=layers.validateOrder(owner.layerOrder||layers.DEFAULT_ORDER),nextOrder=c.layerOrder===undefined?order:layers.validateOrder(c.layerOrder);
 if(c.layerOrder!==undefined&&JSON.stringify(order)!==JSON.stringify(layers.validateOrder(c.expectedLayerOrder)))throw Error('物件层次已在其他入口改变，请重新试摆。');
 const candidate=structuredClone(state);equipSet(candidate,c.equipment,c.expectedEquipment,c.expectedTestEnabled,catalog);const selected=candidate.testAccess?.enabled?candidate.testAccess:candidate;
 const known=new Set(catalog.items.map(i=>i.id));
 for(const key of Object.keys(next)){if(Object.hasOwn(current,key))continue;const parts=key.split('--');if(!parts.every(k=>known.has(k))||parts.length>2)throw Error('无法识别新的物件位置。');if(parts.length===2&&(!catalog.items.find(i=>i.id===parts[0])?.supportsTabletop||catalog.items.find(i=>i.id===parts[1])?.category!=='tabletop'))throw Error('桌面附着关系无效。');}
 validateArrangement(catalog,selected.equipment,next);
 selected.positions=next;
 selected.layerOrder=nextOrder;
 if(state.testAccess?.enabled){state.testAccess.equipment=selected.equipment;state.testAccess.positions=selected.positions;state.testAccess.layerOrder=selected.layerOrder;}else{state.equipment=selected.equipment;state.positions=selected.positions;state.layerOrder=selected.layerOrder;}
}
const api={SIZE_MIN,SIZE_MAX,baseDisplaySize,supportsSize,sizeInfo,resizeItem,mirrorItem,ROOM_AREA,tabletopParent,positionKey,selectedScene,resolvedOffset,roleOffset,bindings,constrainItem,validateArrangement,arrangementWarnings,defaultPositions,validateDependencies,equalPositions,saveRoomSet};
if(typeof module!=='undefined')module.exports=api;globalThis.owlPlacementRules=api;
