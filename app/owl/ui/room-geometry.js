'use strict';
// CommonJS in main/tests; browser adapter imports the same pure source below.
const WORLD=[1024,1536],FLOOR=1082;
const finite=a=>Array.isArray(a)&&a.every(Number.isFinite);
function rect(r){return finite(r)&&r.length===4&&r[0]>=0&&r[1]>=0&&r[2]>0&&r[3]>0&&r[0]+r[2]<=WORLD[0]&&r[1]+r[3]<=WORLD[1];}
function contains(a,b){return b[0]>=a[0]&&b[1]>=a[1]&&b[0]+b[2]<=a[0]+a[2]&&b[1]+b[3]<=a[1]+a[3];}
function intersects(a,b){return a[0]<b[0]+b[2]&&b[0]<a[0]+a[2]&&a[1]<b[1]+b[3]&&b[1]<a[1]+a[3];}
function renderedGeometry(s){
 const {scale=1,anchor=[0,0]}=s.display||{};
 if(!Number.isFinite(scale)||scale<.1||scale>32||!finite(anchor)||anchor.length!==2)throw Error('物件展示比例无效。');
 const point=p=>[anchor[0]+(p[0]-anchor[0])*scale,anchor[1]+(p[1]-anchor[1])*scale];
 const bounds=r=>{const q=point(r.slice(0,2)),w=r[2]*scale;return[s.display?.mirrorX?2*anchor[0]-q[0]-w:q[0],q[1],w,r[3]*scale];};
 return {visualBounds:bounds(s.visualBounds),collisionBounds:bounds(s.collisionBounds),contacts:s.contacts.map(p=>{const q=point(p);return s.display?.mirrorX?[2*anchor[0]-q[0],q[1]]:q;})};
}
function validateRegistration(s){
 if(!s.placement)return;
 const {anchor,position,displaySize}=s.placement;
 if(s.defaultOffset&&(!Number.isFinite(s.defaultOffset.x)||!Number.isFinite(s.defaultOffset.y)||Object.keys(s.defaultOffset).length!==2))throw Error('默认布置偏移无效。');
 if(!finite(anchor)||anchor.length!==2||!finite(position)||position.length!==2||!finite(displaySize)||displaySize.length!==2||displaySize.some(n=>n<=0)||!finite(s.size)||s.size.length!==2||s.size.some(n=>n<=0)||s.display)throw Error('物件素材注册无效。');
 const scale=displaySize[0]/s.size[0];if(Math.abs(scale-displaySize[1]/s.size[1])>1e-9)throw Error('物件必须等比展示。');
 const sourceRect=r=>finite(r)&&r.length===4&&r[0]>=0&&r[1]>=0&&r[2]>0&&r[3]>0&&r[0]+r[2]<=s.size[0]&&r[1]+r[3]<=s.size[1];
 const transform=r=>[position[0]+(r[0]-anchor[0])*scale,position[1]+(r[1]-anchor[1])*scale,r[2]*scale,r[3]*scale];
 for(const [a,b]of [['sourceVisualBounds','visualBounds'],['sourceCollisionBounds','collisionBounds'],['sourceTabletopArea','tabletopArea']]){
  if(a==='sourceTabletopArea'&&!s[a]&&!s[b])continue;
  if(!sourceRect(s[a])||!finite(s[b])||s[b].length!==4||transform(s[a]).some((n,j)=>Math.abs(n-s[b][j])>1e-6))throw Error('物件透明范围与注册坐标不一致。');
 }
 if(s.sourceTabletopArea){const a=s.sourceTabletopAnchor,r=s.sourceTabletopArea;if(!finite(a)||a.length!==2||a[0]<r[0]||a[0]>r[0]+r[2]||a[1]<r[1]||a[1]>r[1]+r[3]||!finite(s.tabletopAnchor)||s.tabletopAnchor.length!==2||a.some((n,j)=>Math.abs(position[j]+(n-anchor[j])*scale-s.tabletopAnchor[j])>1e-6))throw Error('桌面接点必须来自该桌实际素材。');}
 if(s.sourceAlphaBounds&&!sourceRect(s.sourceAlphaBounds))throw Error('物件透明像素范围无效。');
 if(s.hanging?.src){const h=s.hanging;if(!finite(h.attachment)||h.attachment.length!==2||h.attachment.some((n,j)=>n!==position[j])||!Number.isFinite(h.ceilingY)||h.ceilingY>position[1]||!finite(h.size)||h.size.some(n=>n<=0)||!finite(h.displaySize)||h.displaySize.some(n=>n<=0)||!finite(h.topLeft)||h.topLeft[1]!==h.ceilingY||h.policy!=='repeat-crop')throw Error('吊灯连接坐标无效。');}
}
function validateRoomCatalog(c){
 if(!c.room||JSON.stringify(c.room.size)!==JSON.stringify(WORLD)||c.room.floorY!==FLOOR||!['missing','ready'].includes(c.room.assetState))throw Error('房间坐标合同无效。');
 if(c.room.src!=='assets/room-v30/room-base.png'||JSON.stringify(c.room.sourceOffset)!=='[62,190]'||JSON.stringify(c.room.rigOffset)!=='[85,300]'||c.room.rigScale!==.681)throw Error('原角色注册坐标不能静默改变。');
 const d=c.room.roleDisplay;if(!d||d.scale!==.64||JSON.stringify(d.offset)!=='[224,458.2]'||JSON.stringify(d.seatSource)!=='[450,745]'||JSON.stringify(d.seatWorld)!=='[512,935]'||Math.abs(d.offset[0]+450*d.scale-512)>.001||Math.abs(d.offset[1]+745*d.scale-935)>.001)throw Error('角色等比展示必须保留落座锚点。');
 const zones={lamp:[8,330,232,762],chair:[245,570,550,522],plant:[825,580,179,512],rug:[64,975,896,280]};
 for(const i of c.items.filter(i=>i.assetState==='ready')){
  const original=i.scene,registeredRect=r=>finite(r)&&r.length===4&&r[2]>0&&r[3]>0;
  if(!original||![original.visualBounds,original.collisionBounds].every(original.placement?registeredRect:rect)||!Array.isArray(original.contacts))throw Error(`${i.id} 的原素材范围无效。`);validateRegistration(original);if(i.supportsTabletop&&(!original.sourceTabletopArea||!original.sourceTabletopAnchor||!original.tabletopAnchor))throw Error('支持摆件的桌子缺少实际桌面接点。');const s={...original,...renderedGeometry(original)};
  // The artist may declare a hardware margin inside genuine alpha but outside
  // the >4/255 visible silhouette. Keep both measured bounds unchanged.
  const collisionContained=contains(s.visualBounds,s.collisionBounds)||(original.placement&&original.sourceAlphaBounds&&contains(original.sourceAlphaBounds,original.sourceCollisionBounds));
  const offset=original.defaultOffset||{x:0,y:0},withDefault=r=>[r[0]+offset.x,r[1]+offset.y,r[2],r[3]];
  // The accepted club chair keeps its measured wide silhouette and fixed rig.
  // Only this supplied variant extends the old left guide by 3.37 world pixels.
  const zone=i.id==='chair-d-club'?[241.63,570,553.37,522]:zones[i.category];
  if(!rect(withDefault(s.visualBounds))||!rect(withDefault(s.collisionBounds))||!collisionContained||(zone&&!original.placement&&!contains(zone,s.collisionBounds)))throw Error(`${i.id} 的实体摆放范围无效。`);
  if(zones[i.category]&&(!Array.isArray(s.contacts)||!s.contacts.length||!s.contacts.every(p=>finite(p)&&p.length===2&&p[0]>=s.collisionBounds[0]&&p[0]<=s.collisionBounds[0]+s.collisionBounds[2]&&Math.abs(p[1]-FLOOR)<=1)))throw Error(`${i.id} 的接地锚点无效。`);
  const decorSize=i.category==='string-lights'?[1024,384]:i.category.startsWith('corner-')?[512,768]:undefined;
  if(JSON.stringify(s.size)!==JSON.stringify(decorSize||(i.category==='chair'?[1254,1254]:i.category==='wall-art'?[512,640]:i.category==='pendant'?[512,768]:['floor-light','portable-light','foreground-plant','side-furniture','tabletop'].includes(i.category)?[512,512]:WORLD))||s.layer!==i.category)throw Error(`${i.id} 的绘制层无效。`);
 }
 const chairs=c.items.filter(i=>i.scene?.collisionBounds&&i.category==='chair'),solids=c.items.filter(i=>i.scene?.collisionBounds&&['lamp','plant'].includes(i.category));
 for(const a of chairs)for(const b of solids)if(intersects(renderedGeometry(a.scene).collisionBounds,renderedGeometry(b.scene).collisionBounds))throw Error(`${a.id} 与 ${b.id} 的硬件相交。`);
 return c;
}
// All four host sizes keep the complete occupied room region and contacts.
// Preserve the old artwork registration while drawing beneath fixed UI.
function roomCamera(width,height,reference={x:0,y:0,width,height}){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error('房间视口无效。');
 if(![reference.x,reference.y,reference.width,reference.height].every(Number.isFinite)||reference.width<=0||reference.height<=0)throw Error('房间注册视口无效。');
 // Fit the original portrait world to the exposed pane and full window height,
 // never the changing middle row. Controls do not change this registration.
 const scale=Math.min(reference.width/WORLD[0],height/WORLD[1]);
 return {x:WORLD[0]/2-(reference.x+reference.width/2)/scale,y:WORLD[1]/2-height/2/scale,
  width:width/scale,height:height/scale,scale,offsetX:0,offsetY:0};
}
function mapPoint(p,c){return [c.offsetX+(p[0]-c.x)*c.scale,c.offsetY+(p[1]-c.y)*c.scale];}
function unmapPoint(p,c){return [c.x+(p[0]-c.offsetX)/c.scale,c.y+(p[1]-c.offsetY)/c.scale];}
if(typeof module!=='undefined')module.exports={WORLD,FLOOR,rect,contains,intersects,renderedGeometry,validateRoomCatalog,roomCamera,mapPoint,unmapPoint};
globalThis.owlRoomGeometry={WORLD,FLOOR,rect,contains,intersects,renderedGeometry,validateRoomCatalog,roomCamera,mapPoint,unmapPoint};
