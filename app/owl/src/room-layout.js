'use strict';
// Pure placement foundation. No IO, timer, rewards or production migration.
// Offsets use the existing portrait-room coordinates, never viewport pixels.
const WORLD=Object.freeze({width:1024,height:1536});
const ID=/^[a-z][a-z0-9-]{0,79}$/;
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const overlaps=(a,b)=>a[0]<b[0]+b[2]&&b[0]<a[0]+a[2]&&a[1]<b[1]+b[3]&&b[1]<a[1]+a[3];
function validatePositions(value,{legacy=false}={}){
 if(!plain(value)||Object.keys(value).length>64)throw Error('布置记录无效；保留原存档。');
 for(const [id,p] of Object.entries(value))if(!ID.test(id)||!plain(p)||Object.keys(p).some(k=>!(legacy?['x','y','size']:['x','y','size','mirrorX']).includes(k))||!Object.hasOwn(p,'x')||!Object.hasOwn(p,'y')||!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>(legacy?WORLD.width:32768)||Math.abs(p.y)>(legacy?WORLD.height:32768)||Object.hasOwn(p,'size')&&(!Array.isArray(p.size)||p.size.length!==2||!p.size.every(n=>Number.isFinite(n)&&n>0&&n<=(legacy?4096:32768))))throw Error('物件位置无效；保留原存档。');
 for(const p of Object.values(value))if(Object.hasOwn(p,'mirrorX')&&typeof p.mirrorX!=='boolean')throw Error('镜像记录无效；保留原存档。');
 return structuredClone(value);
}
function effectivePositions(state){const owner=state.testAccess?.enabled?state.testAccess:state;if(!plain(owner))throw Error('布置状态无效；保留原存档。');return validatePositions(Object.hasOwn(owner,'positions')?owner.positions:{});}
// Saved offsets retain their original registration basis. Defaults are used
// only for absent entries; even an explicitly saved zero is a custom position.
function itemPosition(item,positions,key=item?.id){return positions[key]||item?.scene?.defaultOffset||{x:0,y:0};}
function rectangle(v){return Array.isArray(v)&&v.length===4&&v.every(Number.isFinite)&&v[2]>0&&v[3]>0;}
function constrainPosition(position,{bounds,area=[0,260,1024,1000],protectedRects=[],visibleMargin=0,free=false}={}){
 if(free){validatePositions({item:position});return {x:position.x,y:position.y};}
 if(!plain(position)||!Number.isFinite(position.x)||!Number.isFinite(position.y)||!rectangle(bounds)||!rectangle(area)||!Array.isArray(protectedRects)||!protectedRects.every(rectangle))throw Error('布置边界无效。');
 const [ax,ay,aw,ah]=area,[bx,by,bw,bh]=bounds;
 if(!Number.isFinite(visibleMargin)||visibleMargin<0)throw Error('布置可见范围无效。');
 if(!visibleMargin&&(aw<bw||ah<bh))throw Error('此物件不适合当前摆放区。');
 const vx=Math.min(visibleMargin,bw,aw),vy=Math.min(visibleMargin,bh,ah);
 const x=Math.max(ax-bx-(visibleMargin?bw-vx:0),Math.min(ax+aw-bx-(visibleMargin?vx:bw),position.x)),y=Math.max(ay-by-(visibleMargin?bh-vy:0),Math.min(ay+ah-by-(visibleMargin?vy:bh),position.y));
 if(protectedRects.some(p=>overlaps([bx+x,by+y,bw,bh],p)))throw Error('请留出猫头鹰的脸、茶杯和互动区域。');
 return {x,y};
}
function screenDeltaToRoom(dx,dy,camera){
 if(!Number.isFinite(dx)||!Number.isFinite(dy)||!Number.isFinite(camera?.scale)||camera.scale<=0)throw Error('房间视口无效。');
 return {x:dx/camera.scale,y:dy/camera.scale};
}
class PlacementDraft {
 begin(state){this.base=effectivePositions(state);this.positions=structuredClone(this.base);this.testEnabled=Boolean(state.testAccess?.enabled);}
 move(id,position,geometry){if(!this.positions||!ID.test(id))throw Error('请先进入布置模式。');this.positions[id]=constrainPosition(position,geometry);}
 reset(id){if(!this.positions||!ID.test(id))throw Error('请先进入布置模式。');delete this.positions[id];}
 resetAll(){if(!this.positions)throw Error('请先进入布置模式。');this.positions={};}
 stale(state){return Boolean(this.positions&&(this.testEnabled!==Boolean(state.testAccess?.enabled)||!same(effectivePositions(state),this.base)));}
 command(){if(!this.positions)throw Error('请先进入布置模式。');return {positions:validatePositions(this.positions),expectedPositions:validatePositions(this.base),expectedTestEnabled:this.testEnabled};}
 cancel(){const original=this.base&&structuredClone(this.base);this.base=this.positions=null;return original;}
}
function same(a,b){const k=Object.keys(a),l=Object.keys(b);return k.length===l.length&&k.every(id=>Object.hasOwn(b,id)&&a[id].x===b[id].x&&a[id].y===b[id].y&&JSON.stringify(a[id].size)===JSON.stringify(b[id].size)&&Boolean(a[id].mirrorX)===Boolean(b[id].mirrorX));}
function applyPlacementSet(state,command,validateItem){
 if(!command||typeof command.expectedTestEnabled!=='boolean'||typeof validateItem!=='function')throw Error('布置提交无效。');
 const candidate=validatePositions(command.positions),expected=validatePositions(command.expectedPositions),current=effectivePositions(state);
 if(Boolean(state.testAccess?.enabled)!==command.expectedTestEnabled||!same(current,expected))throw Error('布置已在另一入口改变，请重新打开。');
 // Check every item before one assignment; rejects never save half a group.
 for(const [id,position] of Object.entries(candidate))validateItem(id,position,state);
 if(state.testAccess?.enabled)state.testAccess.positions=candidate;else state.positions=candidate;
 return state;
}
const roomLayoutAPI={WORLD,validatePositions,effectivePositions,itemPosition,constrainPosition,screenDeltaToRoom,PlacementDraft,applyPlacementSet};
if(typeof module!=='undefined')module.exports=roomLayoutAPI;globalThis.owlRoomLayout=roomLayoutAPI;
