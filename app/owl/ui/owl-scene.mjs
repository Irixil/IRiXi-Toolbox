import { createOutfitRenderer } from './outfit-renderer.mjs';
import { MotionClock } from './motion-clock.mjs';
import { loadOutfitAssets, OUTFIT_PACK } from './outfit-assets.mjs';
import { resolveAppearance } from './equipment-view.mjs';
import { CompanionAttention, bindCompanionInput } from './companion-attention.mjs';
import { measureSeatGround, paintSeatGround, containedCanvasRect } from './seat-ground.mjs';
import { loadRoomAssets,composeRoom } from './room-assets.mjs';
import { ROLE_DISPLAY,roomToSource } from './role-placement.mjs';
import './room-geometry.js';

const loadImage = src => new Promise((resolve,reject)=>{
  const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('动画素材无法读取'));
  image.src=new URL(src,import.meta.url).href;
});
export function createOwlScene({canvas,fallback,notice,onAppearance=()=>{},outfitPack=OUTFIT_PACK,interactionElement,roomElement,response}) {
  const clock=new MotionClock(),media=window.matchMedia('(prefers-reduced-motion: reduce)');
  const attention=new CompanionAttention();let grounds,interactionPaused=false,responseCount=0;
  let renderer,latest,images={},appearance,raf=null,wake=null,disposed=false,failed=false,lastPaint=-Infinity,lastPose,visible=true;
  const source=document.createElement('canvas');source.width=900;source.height=1000;
  let crop,previewEquipment=null,previewPositions=null,previewLayerOrder=null,roomPack={items:{}},roomSignature,bodyAtlasImage,roomLoading=false;
  function layoutRoomCamera(){
    if(!roomPack.base)return false;
    const scene=canvas.closest?.('.scene'),reference=(scene||interactionElement||canvas).getBoundingClientRect();if(!reference||reference.width<=0||reference.height<=0)return false;
    const controls=scene?.querySelector('#placement-controls'),bar=controls&&!controls.hidden?parseFloat(getComputedStyle(scene).gridTemplateRows.split(' ').at(-1))||0:0;
    if(interactionElement){interactionElement.style.left=`${reference.left}px`;interactionElement.style.width=`${reference.width}px`;}
    const box=(interactionElement||canvas).getBoundingClientRect();if(box.width<=0||box.height<=0)return false;
    const next=globalThis.owlRoomGeometry.roomCamera(box.width,box.height,{x:reference.left-box.left,y:reference.top-box.top,width:reference.width,height:Math.max(1,reference.height-bar)}),ratio=Math.min(window.devicePixelRatio||1,2),width=Math.max(1,Math.round(box.width*ratio)),height=Math.max(1,Math.round(box.height*ratio));
    const changed=JSON.stringify(next)!==JSON.stringify(crop)||canvas.width!==width||canvas.height!==height;
    if(changed){crop=next;canvas.width=width;canvas.height=height;canvas.dataset.sourceCrop=JSON.stringify(crop);lastPose=undefined;}
    return changed;
  }
  function resetAttention(){attention.reset();lastPose=undefined;kick();}
  function kick(){if(disposed||failed||!renderer||!latest)return;cancel();frame(performance.now(),true);}
  function locate(event){
    if(!crop||failed||canvas.hidden||interactionPaused)return;
    const r=containedCanvasRect(canvas);if(!r.scale)return;
    const worldPoint={x:(event.clientX-r.x)/r.scale+crop.x,y:(event.clientY-r.y)/r.scale+crop.y};
    const pos=previewPositions||(latest.testAccess?.enabled?latest.testAccess.positions:latest.positions)||{},seat=pos[appearance?.equipment.chair]||{x:0,y:0},display=latest.collectionCatalog?.room?.roleDisplay||ROLE_DISPLAY;const effectiveDisplay={...display,offset:[display.offset[0]+seat.x,display.offset[1]+seat.y]};
    const {x,y}=roomPack.base?roomToSource(worldPoint,effectiveDisplay):worldPoint;
    if(x<0||y<0||x>=900||y>=1000)return;
    const opaque=source.getContext('2d').getImageData(Math.floor(x),Math.floor(y),1,1).data[3]>20;
    return {role:opaque&&y<780,head:opaque&&Math.abs(x-453)<174&&Math.abs(y-293)<145,x:(x-453)/174,y:(y-293)/145};
  }
  const disposeInput=interactionElement?bindCompanionInput({element:interactionElement,locate,
    onTarget(x,y){attention.target(x,y);kick();},onReset:resetAttention,
    onActivate(){if(failed||interactionPaused)return;if(response)response.textContent='猫头鹰在这里陪着你。';
      if(attention.activate(performance.now())){interactionElement.dataset.responses=String(++responseCount);kick();}}
  }):()=>{};
  function groundLayout(){
    if(roomPack.base&&layoutRoomCamera()){kick();}
    if(roomPack.base){const pos=previewPositions||(latest.testAccess?.enabled?latest.testAccess.positions:latest.positions)||{},seat=pos[appearance?.equipment.chair]||{x:0,y:0};canvas.dataset.ground=JSON.stringify({groundY:1082+seat.y,contacts:(latest?.collectionCatalog?.items.find(i=>i.id===appearance?.room)?.scene.contacts||[]).map(([x,y])=>[x+seat.x,y+seat.y]),world:true});return;}
    const metrics=grounds?.[appearance?.room];if(!metrics||!crop||!roomElement||canvas.hidden)return;
    const r=containedCanvasRect(canvas),main=roomElement.getBoundingClientRect(),scene=canvas.closest('.scene').getBoundingClientRect();
    const floor=r.y-main.top+(metrics.groundY-crop.y)*r.scale-Math.min(20,scene.height*.06);
    roomElement.style.setProperty('--floor-line',`${floor}px`);
    canvas.dataset.ground=JSON.stringify({...metrics,floorLine:floor});
  }
  const resize=roomElement?new ResizeObserver(groundLayout):null;
  if(resize){resize.observe(roomElement);resize.observe(canvas);if(interactionElement)resize.observe(interactionElement);}
  function measureCrop(){
    let left=900,top=1000,right=0,bottom=0;
    const context=source.getContext('2d',{willReadFrequently:true});
    // Union of original poses and both seats; transparent atlas padding is not artwork.
    for(const room of ['stool','reading-chair'])for(let step=0;step<=48;step++){
      renderer.renderAt(step*24.25/48,{appearance:{accessory:'round-glasses',room}});
      const pixels=context.getImageData(0,0,900,1000).data;
      for(let y=0;y<1000;y+=2)for(let x=0;x<900;x+=2)if(pixels[(y*900+x)*4+3]>8){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
    }
    if(right<=left||bottom<=top)throw Error('Empty artwork bounds');
    const margin=12;left=Math.max(0,left-margin);top=Math.max(0,top-margin);right=Math.min(900,right+margin);bottom=Math.min(1000,bottom+margin);
    crop={x:left,y:top,width:right-left,height:bottom-top};canvas.width=crop.width;canvas.height=crop.height;canvas.dataset.sourceCrop=JSON.stringify(crop);
  }
  function cancel(){if(raf!==null)cancelAnimationFrame(raf);if(wake!==null)clearTimeout(wake);raf=wake=null;}
  function publishAppearance(){if(!latest)return;appearance=resolveAppearance(latest,images,previewEquipment);onAppearance({...appearance,canConfirmPreview:Boolean(renderer)&&!failed&&!roomLoading&&appearance.previewAvailable,summary:failed?'画面暂不可用；已保留原始参考形象，装扮选择仍保存在记录中。':appearance.summary});canvas.setAttribute('aria-label',appearance.label);interactionElement?.setAttribute('aria-label',appearance.label+'，点一下打个招呼');}
  function requestRoomAssets(){const c=latest?.collectionCatalog;if(!c)return;const signature=JSON.stringify([c.version,c.room,c.items.map(i=>[i.id,i.assetState,i.scene])]);if(signature===roomSignature)return;roomSignature=signature;roomLoading=true;loadRoomAssets(c).then(pack=>{if(disposed||signature!==roomSignature)return;roomLoading=false;roomPack=pack;images.roomItems=pack.items;images.roomBase=pack.base;if(pack.base){layoutRoomCamera();canvas.dataset.roomMode='portrait';roomElement?.classList.add('portrait-room');}canvas.dataset.roomAssets=JSON.stringify({base:Boolean(pack.base),loaded:Object.keys(pack.items),missing:pack.missing});publishAppearance();lastPose=undefined;refresh();});}
  function fail(){failed=true;cancel();canvas.hidden=true;fallback.hidden=false;notice.textContent='动画暂不可用，已保留静态形象。';publishAppearance();}
  function frame(now,initial=false) {
    raf=null;wake=null;if(disposed||failed||!visible||!renderer||(!initial&&document.hidden)||!latest)return;
    try {
      layoutRoomCamera();
      const sample=clock.sample(now),interaction=attention.sample(now),layerOrder=previewLayerOrder||globalThis.owlLayerOrder.effectiveOrder(latest),pose=[sample.seconds,sample.focus,appearance?.key,JSON.stringify(previewPositions||(latest.testAccess?.enabled?latest.testAccess.positions:latest.positions)||{}),JSON.stringify(layerOrder),...[interaction.x,interaction.y,interaction.blink,interaction.nod].map(n=>n.toFixed(3))].join(':');
      const budget=clock.policy.kind==='focus'?1000/30:1000/60;
      if(pose!==lastPose&&(now-lastPaint>=budget||!sample.animating)) {
        const rendered=renderer.renderAt(sample.seconds,{focus:sample.focus,appearance,interaction});
        const display=canvas.getContext('2d');display.clearRect(0,0,canvas.width,canvas.height);if(roomPack.base){const roleDisplay=latest.collectionCatalog.room.roleDisplay||ROLE_DISPLAY;composeRoom(display,roomPack.base,roomPack.items,appearance.equipment,source,{legacyImages:images,bodyAtlas:bodyAtlasImage,roleDisplay,positions:previewPositions||(latest.testAccess?.enabled?latest.testAccess.positions:latest.positions)||{},catalog:latest.collectionCatalog,layerOrder,camera:crop});canvas.dataset.layerOrder=JSON.stringify(layerOrder);const seat=(previewPositions||(latest.testAccess?.enabled?latest.testAccess.positions:latest.positions)||{})[appearance.equipment.chair]||{x:0,y:0};canvas.dataset.roleDisplay=JSON.stringify({...roleDisplay,offset:[roleDisplay.offset[0]+seat.x,roleDisplay.offset[1]+seat.y]});canvas.dataset.positions=JSON.stringify(previewPositions||(latest.testAccess?.enabled?latest.testAccess.positions:latest.positions)||{});}else{paintSeatGround(display,grounds?.[appearance?.room],crop);display.drawImage(source,crop.x,crop.y,crop.width,crop.height,0,0,canvas.width,canvas.height);}lastPaint=now;lastPose=pose;
        if(interactionElement)canvas.dataset.attention=JSON.stringify({...interaction,yaw:rendered.state.yaw||0,head:rendered.state.head,blink:rendered.state.blink||0});
        canvas.dataset.equipment=JSON.stringify(appearance.equipment);canvas.dataset.preview=String(Boolean(previewEquipment));canvas.hidden=false;fallback.hidden=true;
        groundLayout();
      }
      if(document.hidden)return;
      if(sample.animating||interaction.animating)raf=requestAnimationFrame(frame);
      else if(sample.wakeAfterMs!==null)wake=setTimeout(()=>{wake=null;raf=requestAnimationFrame(frame);},Math.max(1,sample.wakeAfterMs));
    }catch(error){canvas.dataset.renderError=error.message;fail();}
  }
  function refresh(){cancel();if(!disposed&&!failed&&latest){clock.update(latest,media.matches);attention.setReduced(Boolean(media.matches||latest.preferences?.reducedMotion||interactionPaused));frame(performance.now(),true);}}
  function visibility(){cancel();attention.reset();clock.resetWallAnchor();lastPose=undefined;lastPaint=-Infinity;if(!document.hidden)refresh();}
  function preference(){lastPose=undefined;refresh();}
  document.addEventListener('visibilitychange',visibility);media.addEventListener('change',preference);
  Promise.all([loadImage('./assets/motion-v7/body-parts.png'),loadImage('./assets/motion-v7/head-poses.png'),loadImage('./assets/motion-v7/head-up-sip.png'),loadOutfitAssets(loadImage,outfitPack)]).then(([bodyAtlas,headAtlas,pitchHead,pack])=>{
    if(disposed)return;
    try{
      if(bodyAtlas.naturalWidth!==1254||bodyAtlas.naturalHeight!==1254||headAtlas.naturalWidth!==1254||headAtlas.naturalHeight!==1254||pitchHead.naturalWidth!==1254||pitchHead.naturalHeight!==1254)throw new Error('素材尺寸不匹配');
      bodyAtlasImage=bodyAtlas;images={...pack.images,roomItems:roomPack.items,roomBase:roomPack.base};renderer=createOutfitRenderer(source,{bodyAtlas,headAtlas,pitchHead},images,{transparentBackground:true,showLabels:false,showGround:false,separateSeat:()=>Boolean(roomPack.base)});measureCrop();if(roomPack.base){layoutRoomCamera();}
      if(roomElement)grounds=measureSeatGround(bodyAtlas,images.chairFront,(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;});
      notice.textContent=pack.missing.length?'随专注状态切换动作；减少动效时保持静态。眼镜与椅子素材尚待补齐。':'随专注状态切换动作；减少动效时保持静态。';publishAppearance();refresh();
    }catch(error){canvas.dataset.renderError=error.message;fail();}
  }).catch(fail);
  return {
    update(state){latest=state;requestRoomAssets();publishAppearance();refresh();},
    setVisible(value){visible=Boolean(value);if(!visible)cancel();else refresh();},
    setPreviewEquipment(value,positions,layerOrder){previewEquipment=value?{...value}:null;previewPositions=value?structuredClone(positions||{}):null;previewLayerOrder=value?globalThis.owlLayerOrder.validateOrder(layerOrder||globalThis.owlLayerOrder.effectiveOrder(latest)):null;publishAppearance();lastPose=undefined;refresh();},
    setInteractionPaused(value){interactionPaused=Boolean(value);if(interactionElement){interactionElement.inert=false;interactionElement.tabIndex=interactionPaused?-1:0;interactionElement.setAttribute('aria-disabled',String(interactionPaused));}attention.reset();lastPose=undefined;refresh();},
    dispose(){disposed=true;disposeInput();resize?.disconnect();cancel();document.removeEventListener('visibilitychange',visibility);media.removeEventListener('change',preference);renderer=null;}
  };
}
