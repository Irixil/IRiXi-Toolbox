// Same 420ms/8px long press as the existing toolbox; controls never begin drag.
export function bindWidgetDrag(bridge){
 let gesture,timer,frame,blockClicksUntil=0;
 const point=(type,e)=>({type,pointerId:e.pointerId,screenX:e.screenX,screenY:e.screenY});
 const send=value=>{void bridge.drag(value).catch(()=>{clear();});};
 const clear=()=>{clearTimeout(timer);cancelAnimationFrame(frame);const old=gesture;gesture=null;document.body.removeAttribute('data-dragging');if(old&&document.body.hasPointerCapture?.(old.id))document.body.releasePointerCapture(old.id);};
 const cancel=()=>{const old=gesture;clear();if(old?.started){blockClicksUntil=Date.now()+260;send({type:'cancel',pointerId:old.id});}};
 const down=e=>{
  if(document.querySelector('main.arranging')||e.button!==0||e.isPrimary===false||e.target.closest('button,input,textarea,select,a,audio,[contenteditable],summary,details[open]'))return;
  if(gesture)cancel();const g={id:e.pointerId,x:e.screenX,y:e.screenY,last:e,started:false};gesture=g;
  timer=setTimeout(async()=>{if(gesture!==g)return;g.started=true;try{document.body.setAttribute('data-dragging','');document.body.setPointerCapture?.(g.id);const ok=await bridge.drag({type:'begin',pointerId:g.id,screenX:g.x,screenY:g.y});if(!ok&&gesture===g)clear();}catch{if(gesture===g)clear();}},420);
 };
 const move=e=>{const g=gesture;if(!g||g.id!==e.pointerId)return;g.last=e;if(!g.started){if(Math.hypot(e.screenX-g.x,e.screenY-g.y)>8)clear();return;}e.preventDefault();if(frame)return;frame=requestAnimationFrame(()=>{frame=null;if(gesture===g)send(point('move',g.last));});};
 const up=e=>{const g=gesture;if(!g||g.id!==e.pointerId)return;const started=g.started;clear();if(started){e.preventDefault();blockClicksUntil=Date.now()+260;send(point('end',e));}};
 const click=e=>{if(gesture?.started||Date.now()<blockClicksUntil){e.preventDefault();e.stopImmediatePropagation();}};
 const key=e=>{if(e.key==='Escape'&&gesture){e.preventDefault();cancel();}};
 const leave=()=>{if(gesture&&!gesture.started)clear();};
 document.addEventListener('pointerdown',down);document.addEventListener('pointermove',move);document.addEventListener('pointerup',up);document.addEventListener('pointercancel',cancel);document.addEventListener('lostpointercapture',cancel);document.addEventListener('pointerleave',leave);document.addEventListener('click',click,true);document.addEventListener('keydown',key);window.addEventListener('blur',cancel);
 const off=bridge.onDragReset(clear);
 return ()=>{cancel();off();document.removeEventListener('pointerdown',down);document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);document.removeEventListener('pointercancel',cancel);document.removeEventListener('lostpointercapture',cancel);document.removeEventListener('pointerleave',leave);document.removeEventListener('click',click,true);document.removeEventListener('keydown',key);window.removeEventListener('blur',cancel);};
}
