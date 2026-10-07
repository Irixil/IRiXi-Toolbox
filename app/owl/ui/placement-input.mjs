import {containedCanvasRect} from './seat-ground.mjs';
export function bindPlacementInput({root,draft,onChange,onMessage}){
 const scene=root.querySelector('.scene'),canvas=root.querySelector('#owl-canvas'),controls=root.querySelector('#placement-controls'),toggle=root.querySelector('#placement-mode'),highlight=root.querySelector('#placement-highlight'),percent=root.querySelector('#placement-percent');
 let mode=false,selected,gesture;
 const rows=()=>draft.equipment?globalThis.owlPlacementRules.bindings(draft.catalog,draft.equipment,draft.positions):[];
 const camera=()=>{const r=containedCanvasRect(canvas),crop=JSON.parse(canvas.dataset.sourceCrop||'{}');return{...r,crop};};
 const world=e=>{const c=camera();return{x:(e.clientX-c.x)/c.scale+c.crop.x,y:(e.clientY-c.y)/c.scale+c.crop.y};};
 function clearGesture(){const old=gesture;gesture=null;if(old&&scene.hasPointerCapture?.(old.id))scene.releasePointerCapture(old.id);}
 function repaint(){
  const item=rows().find(r=>r.id===selected),c=camera();highlight.hidden=!mode||!item;
  if(item&&mode&&c.scale){const [x,y,w,h]=item.worldBounds,s=scene.getBoundingClientRect();Object.assign(highlight.style,{left:`${c.x-s.x+(x-c.crop.x)*c.scale}px`,top:`${c.y-s.y+(y-c.crop.y)*c.scale}px`,width:`${w*c.scale}px`,height:`${h*c.scale}px`});highlight.dataset.item=item.id;}
  controls.hidden=!mode;for(const b of controls.querySelectorAll('button'))b.disabled=!item;
  const info=item?globalThis.owlPlacementRules.sizeInfo(draft.catalog,draft.equipment,draft.positions,item.id):{supported:false};
  percent.disabled=!info.supported;if(document.activeElement!==percent)percent.value=info.supported?String(Math.round(info.factor*100)):'100';
  for(const b of controls.querySelectorAll('[data-size]'))b.disabled=!info.supported||(b.dataset.size==='smaller'&&info.factor<=info.min+1e-8)||(b.dataset.size==='larger'&&info.factor>=info.max-1e-8);
  const mirror=controls.querySelector('[data-placement="mirror"]');mirror.disabled=!info.supported;mirror.setAttribute('aria-pressed',String(Boolean(item&&draft.positions[item.key]?.mirrorX)));
  const remove=controls.querySelector('[data-placement="remove"]');remove.disabled=!item||item.id==='stool';remove.textContent=item?.category==='chair'?'换初凳':'卸下';
  toggle.setAttribute('aria-pressed',String(mode));
 }
 function setMode(value){mode=Boolean(value);clearGesture();root.querySelector('main').classList.toggle('arranging',mode);if(mode&&!rows().some(r=>r.id===selected))selected=rows()[0]?.id;repaint();}
 function choose(id){selected=id;repaint();}
 function apply(id,next){try{draft.move(id,next);onChange();const warnings=globalThis.owlPlacementRules.arrangementWarnings(draft.catalog,draft.equipment,draft.positions),row=rows().find(r=>r.id===id);onMessage(warnings.length?warnings[0]+'；可以继续摆放或保存。':row?.category==='tabletop'?'摆件随桌子移动，也可调整相对位置。':'拖动虚线框或点箭头调整，放好才保存。');repaint();return true;}catch(e){onMessage(e.message);return false;}}
 const down=e=>{
  if(!mode||e.button!==0||e.isPrimary===false||e.target.closest('button,input,label'))return;const p=world(e),priority=r=>draft.layerOrder.indexOf(globalThis.owlLayerOrder.groupFor(r.category))+(r.category==='tabletop'?.1:0);
  const contains=r=>p.x>=r.worldBounds[0]&&p.y>=r.worldBounds[1]&&p.x<=r.worldBounds[0]+r.worldBounds[2]&&p.y<=r.worldBounds[1]+r.worldBounds[3],items=rows();
  // The selected outline is a drag handle, including transparent artwork
  // padding. Overlapping items must not steal a deliberate selection.
  const found=items.find(r=>r.id===selected&&contains(r))||items.sort((a,b)=>priority(b)-priority(a)).find(contains);
  e.stopPropagation();e.preventDefault();if(!found)return;selected=found.id;gesture={id:e.pointerId,item:found.id,start:p,offset:{...found.offset},before:structuredClone(draft.positions)};scene.setPointerCapture?.(e.pointerId);repaint();
 };
 const move=e=>{if(!gesture||gesture.id!==e.pointerId)return;e.preventDefault();e.stopPropagation();const p=world(e);apply(gesture.item,{x:gesture.offset.x+p.x-gesture.start.x,y:gesture.offset.y+p.y-gesture.start.y});};
 const up=e=>{if(!gesture||gesture.id!==e.pointerId)return;e.preventDefault();e.stopPropagation();clearGesture();};
 const cancel=()=>{if(gesture){draft.positions=gesture.before;clearGesture();onChange();repaint();}};
 const key=e=>{if(!mode||!selected||e.target.closest('input,textarea,select'))return;const delta={ArrowLeft:[-8,0],ArrowRight:[8,0],ArrowUp:[0,-8],ArrowDown:[0,8]}[e.key];if(delta){e.preventDefault();e.stopPropagation();const r=rows().find(r=>r.id===selected);if(r)apply(selected,{x:r.offset.x+delta[0],y:r.offset.y+delta[1]});}else if(e.key==='Escape')cancel();};
 function resizeTo(factor){try{draft.resize(selected,factor);onChange();onMessage(`大小 ${Math.round(factor*100)}%（50%–500%），放好才保存。`);repaint();return true;}catch(error){onMessage(error.message);repaint();return false;}}
 const percentChange=()=>{const value=percent.value.trim();resizeTo(value===''?NaN:Number(value)/100);const info=globalThis.owlPlacementRules.sizeInfo(draft.catalog,draft.equipment,draft.positions,selected);percent.value=String(Math.round(info.factor*100));};
 const percentKey=e=>{if(e.key==='Enter'){e.preventDefault();percentChange();percent.blur();}};
 const direction=e=>{const action=e.target.closest('[data-placement]')?.dataset.placement;if(action){try{if(action==='mirror')draft.mirror(selected);else if(action==='recover')draft.recover(selected);else if(action==='remove')draft.remove(selected);onChange();onMessage(action==='mirror'?'已左右镜像，放好才保存。':action==='recover'?'已找回位置，大小和镜像保留。':'已从房间卸下，仍可在收藏箱重新放入。');repaint();}catch(error){onMessage(error.message);}return;}const button=e.target.closest('button');if(button?.dataset.size){try{const info=globalThis.owlPlacementRules.sizeInfo(draft.catalog,draft.equipment,draft.positions,selected);const factor=button.dataset.size==='reset'?1:Math.max(info.min,Math.min(info.max,Math.round((info.factor+(button.dataset.size==='larger'?.1:-.1))*100)/100));resizeTo(factor);}catch(error){onMessage(error.message);}return;}if(button?.dataset.layer){try{const old=JSON.stringify(draft.layerOrder);draft.moveLayer(selected,button.dataset.layer==='forward'?1:-1);onChange();onMessage(old===JSON.stringify(draft.layerOrder)?'已经在这一侧的最外层。':rows().find(r=>r.id===selected)?.category==='tabletop'?'桌子和桌面摆件一起调整前后，放好才保存。':'已调整前后层次，放好才保存。');repaint();}catch(error){onMessage(error.message);}return;}const delta={left:[-32,0],right:[32,0],up:[0,-32],down:[0,32]}[button?.dataset.move];if(!delta)return;const row=rows().find(r=>r.id===selected);if(row)apply(selected,{x:row.offset.x+delta[0],y:row.offset.y+delta[1]});};
 const modeClick=()=>setMode(!mode),resize=new ResizeObserver(repaint);resize.observe(scene);
 percent.addEventListener('change',percentChange);percent.addEventListener('keydown',percentKey);toggle.addEventListener('click',modeClick);controls.addEventListener('click',direction);scene.addEventListener('pointerdown',down);scene.addEventListener('pointermove',move);scene.addEventListener('pointerup',up);scene.addEventListener('pointercancel',cancel);scene.addEventListener('lostpointercapture',cancel);window.addEventListener('blur',cancel);root.addEventListener('keydown',key,true);
 return{setMode,choose,repaint,dispose(){clearGesture();resize.disconnect();percent.removeEventListener('change',percentChange);percent.removeEventListener('keydown',percentKey);toggle.removeEventListener('click',modeClick);controls.removeEventListener('click',direction);scene.removeEventListener('pointerdown',down);scene.removeEventListener('pointermove',move);scene.removeEventListener('pointerup',up);scene.removeEventListener('pointercancel',cancel);scene.removeEventListener('lostpointercapture',cancel);window.removeEventListener('blur',cancel);root.removeEventListener('keydown',key,true);}};
}
