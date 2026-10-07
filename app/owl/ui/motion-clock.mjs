// Visual time only. Never writes, advances or awards the focus timer.
export const CLIPS = Object.freeze([
  { name: 'tea', start: 0, end: 9.75 },
  { name: 'blink', start: 10.1875, end: 11.125 },
  { name: 'look-around', start: 11.1875, end: 16.25 },
  { name: 'sway', start: 17.0625, end: 21.8125 },
]);
export function visualPolicy(state, systemReduced = false) {
  return { kind: state.active?.kind || 'idle',
    held: Boolean(state.fault || state.active?.status === 'paused'),
    reduced: Boolean(systemReduced || state.preferences?.reducedMotion) };
}
export class MotionClock {
  constructor(random = Math.random) {
    this.random = random; this.policy = {kind:'idle',held:false,reduced:false};
    this.last = null; this.focusSeconds = 0; this.previous = null;
    this.frame = { seconds:0, focus:true }; this.resetIdle();
  }
  unit() { const n=this.random(); return Number.isFinite(n) ? Math.max(0,Math.min(.999999,n)) : 0; }
  resetIdle() { this.clip=null; this.clipSeconds=0; this.quietMs=8000+this.unit()*15000; }
  update(state, systemReduced = false) {
    const next=visualPolicy(state,systemReduced),old=this.policy;
    if (old.kind!==next.kind || old.reduced!==next.reduced) {
      this.resetIdle();this.focusSeconds=0;this.frame={seconds:0,focus:true};
    }
    if(old.kind!==next.kind||old.reduced!==next.reduced||old.held!==next.held)this.last=null;
    this.policy=next;
  }
  resetWallAnchor() { this.last=null; }
  sample(now) {
    if(this.policy.reduced)return {seconds:0,focus:true,animating:false,wakeAfterMs:null};
    if(this.policy.held)return {...this.frame,animating:false,wakeAfterMs:null};
    const raw=this.last===null?0:Math.max(0,now-this.last);this.last=now;
    if(this.policy.kind==='focus') {
      this.focusSeconds+=(raw<=250?raw:0)/1000;
      this.frame={seconds:this.focusSeconds,focus:true};
      return {...this.frame,animating:true,wakeAfterMs:null};
    }
    if(!this.clip) {
      this.quietMs-=raw;
      if(this.quietMs>0)return {seconds:0,focus:true,animating:false,wakeAfterMs:this.quietMs};
      const choices=CLIPS.filter(clip=>clip.name!==this.previous);
      this.clip=choices[Math.floor(this.unit()*choices.length)];this.previous=this.clip.name;this.clipSeconds=0;
    }else this.clipSeconds+=(raw<=250?raw:0)/1000;
    if(this.clipSeconds>=this.clip.end-this.clip.start) {
      this.resetIdle();this.frame={seconds:0,focus:true};
      return {...this.frame,animating:false,wakeAfterMs:this.quietMs};
    }
    this.frame={seconds:this.clip.start+this.clipSeconds,focus:false};
    return {...this.frame,name:this.clip.name,animating:true,wakeAfterMs:null};
  }
}
