import { createOwlRenderer } from './renderers/owl-equipped.mjs';
import { GLASSES_REGISTRATION } from './glasses-registration.mjs';
// Fixed scarf identity. Only reward eyewear and seat are visual choices.
export function createOutfitRenderer(canvas,base,images={},options={}){
  let appearance={accessory:null,room:'stool'};
  const glasses={front:images.glassesFront,up:images.glassesUp,left30:images.glassesLeft30,left60:images.glassesLeft60,right30:images.glassesRight30,right60:images.glassesRight60,registration:GLASSES_REGISTRATION};
  const renderer=createOwlRenderer(canvas,base,{...options,
      drawSeat(ctx){if(options.separateSeat?.())return true;const next=images.roomItems?.[appearance.room];if(next?.back&&next?.front){ctx.drawImage(next.back,0,0);return true;}if(appearance.room!=='reading-chair')return false;if(!images.chairBack||!images.chairFront)throw Error('椅子素材尚未就绪');ctx.drawImage(images.chairBack,0,0);return true;},
      drawFrontSeat(ctx){if(options.separateSeat?.())return;const front=images.roomItems?.[appearance.room]?.front||(appearance.room==='reading-chair'?images.chairFront:null);if(front)ctx.drawImage(front,0,0);},
      drawHeadOverlay(_ctx,s,draw){if(appearance.accessory==='round-glasses')draw(glasses,s);},
    });
  return {
    renderAt(seconds,{focus=false,appearance:next,interaction}={}){
      appearance=next||{accessory:null,room:'stool'};
      return renderer.renderAt(seconds,{focus,interaction});
    },
  };
}
