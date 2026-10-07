import { ROLE_DISPLAY } from './role-placement.mjs';
import '../src/room-layout.js';
import './room-geometry.js';
import './layer-order.js';
import './placement-rules.js';
const cache=new Map();
function image(src,size){const key=src+':'+size.join(',');if(!cache.has(key))cache.set(key,new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>i.naturalWidth===size[0]&&i.naturalHeight===size[1]?resolve(i):reject(Error('房间素材尺寸不匹配'));i.onerror=()=>reject(Error('房间素材待准备'));i.src=new URL(src,import.meta.url).href;}));return cache.get(key);}
export async function loadRoomAssets(catalog){
 const items={},missing=[];let base;
 if(catalog.room?.assetState==='ready')try{base=await image(catalog.room.src,catalog.room.size);}catch{missing.push('房间背景');}
 await Promise.all((catalog.items||[]).filter(i=>i.assetState==='ready').map(async i=>{try{const s=i.scene;if(i.developmentPlaceholder&&catalog.room.developmentPreview){const c=document.createElement('canvas');[c.width,c.height]=s.size;const g=c.getContext('2d'),b=s.sourceVisualBounds||s.visualBounds;g.fillStyle='#D7DDD0';g.fillRect(...b);g.strokeStyle='#687260';g.lineWidth=3;g.strokeRect(...b);g.fillStyle='#35422E';g.font='22px sans-serif';g.fillText('开发占位',b[0]+8,b[1]+30);g.font='16px sans-serif';g.fillText(i.name,b[0]+8,b[1]+54);items[i.id]={image:c,display:s.display,placement:s.placement,sourceSize:s.size};}else if(s.back)items[i.id]={back:await image(s.back,s.size),front:await image(s.front,s.size)};else items[i.id]={image:await image(s.src,s.size),display:s.display,placement:s.placement,sourceSize:s.size};}catch{missing.push(i.name);}}));
 await Promise.all((catalog.items||[]).filter(i=>i.assetState==='ready'&&i.scene?.hanging?.src).map(async i=>{try{if(!items[i.id])return;items[i.id].cord=await image(i.scene.hanging.src,i.scene.hanging.size);}catch{delete items[i.id];missing.push(i.name);}}));
 return {base,items,missing};
}
export function composeRoom(ctx,base,items,equipment,source,{legacyImages={},bodyAtlas,roleDisplay=ROLE_DISPLAY,positions={},catalog,layerOrder=globalThis.owlLayerOrder.DEFAULT_ORDER,camera}={}){
 ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);ctx.save();if(camera){
  // Each backing axis rounds independently; after CSS display both axes use
  // the same logical camera scale. The paper shares that exact world origin.
  ctx.scale(ctx.canvas.width/camera.width,ctx.canvas.height/camera.height);ctx.translate(-camera.x,-camera.y);
  ctx.fillStyle=ctx.createPattern(base,'repeat');ctx.fillRect(camera.x,camera.y,camera.width,camera.height);
 }else ctx.drawImage(base,0,0);
 const lookup=id=>catalog?.items.find(i=>i.id===id),offset=(id,key=id)=>lookup(id)?globalThis.owlPlacementRules.resolvedOffset(lookup(id),equipment,positions,catalog):positions[key]||{x:0,y:0},table=offset(equipment['side-furniture']);
 const draw=category=>{if(category==='tabletop'&&!globalThis.owlPlacementRules.tabletopParent(equipment,catalog))return;const id=equipment[category],item=items[id],image=item?.image;if(!image)return;const key=category==='tabletop'?`${equipment['side-furniture']}--${id}`:id,p=offset(id,key),parent=category==='tabletop'?table:{x:0,y:0};const hanging=lookup(id)?.scene?.hanging;
 if(hanging&&item.cord){const [w,h]=hanging.displaySize,x=hanging.topLeft[0]+p.x,top=hanging.ceilingY,bottom=hanging.attachment[1]+p.y;for(let y=top;y<bottom;y+=h){const slice=Math.min(h,bottom-y);ctx.drawImage(item.cord,0,0,item.cord.naturalWidth,item.cord.naturalHeight*slice/h,x,y,w,slice);}}
 const selected=globalThis.owlPlacementRules.selectedScene(lookup(id),equipment,positions,catalog);ctx.save();ctx.translate(p.x+parent.x,p.y+parent.y);if(selected?.display||item.display){const {scale,anchor}=selected?.display||item.display;ctx.translate(anchor[0],anchor[1]);ctx.scale((selected?.display||item.display).mirrorX?-scale:scale,scale);ctx.translate(-anchor[0],-anchor[1]);}if(item.placement){const v=selected?.placement||item.placement,a=v.anchor,z=v.position,w=v.displaySize,x=z[0]-a[0]*w[0]/item.sourceSize[0],y=z[1]-a[1]*w[1]/item.sourceSize[1];if(v.mirrorX){ctx.translate(x+w[0],y);ctx.scale(-1,1);ctx.drawImage(image,0,0,w[0],w[1]);}else ctx.drawImage(image,x,y,w[0],w[1]);}else ctx.drawImage(image,0,0);ctx.restore();};
 const drawSeat=()=>{
 const chair=equipment.chair||equipment.room;
 const seat=positions[chair]||{x:0,y:0};
 ctx.save();ctx.translate(seat.x,seat.y);ctx.translate(85,300);ctx.scale(.681,.681);
 const back=items[chair]?.back||(chair==='reading-chair'?legacyImages.chairBack:null);
 if(back)ctx.drawImage(back,0,0);else if(chair==='stool'&&bodyAtlas)ctx.drawImage(bodyAtlas,793,629,450,303,363,874,532,274);ctx.restore();
 ctx.drawImage(source,roleDisplay.offset[0]+seat.x,roleDisplay.offset[1]+seat.y,900*roleDisplay.scale,1000*roleDisplay.scale);
 const front=items[chair]?.front||(chair==='reading-chair'?legacyImages.chairFront:null);if(front){ctx.save();ctx.translate(seat.x,seat.y);ctx.translate(85,300);ctx.scale(.681,.681);ctx.drawImage(front,0,0);ctx.restore();}
 };
 for(const category of globalThis.owlLayerOrder.validateOrder(layerOrder)){if(category==='chair')drawSeat();else if(category==='side-furniture'){draw(category);draw('tabletop');}else draw(category);}ctx.restore();
}
