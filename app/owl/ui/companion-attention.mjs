// Ephemeral visual state. This module has no timer, storage or IPC access.
const clamp = n => Math.max(-1, Math.min(1, Number.isFinite(n) ? n : 0));
const smooth = n => { n = Math.max(0, Math.min(1, n)); return n * n * (3 - 2 * n); };
export class CompanionAttention {
  constructor() { this.reduced = false; this.lastActivation = -Infinity; this.reset(); }
  reset() { this.x = this.y = this.targetX = this.targetY = 0; this.last = null; this.activatedAt = -Infinity; }
  setReduced(value) { this.reduced = Boolean(value); if (this.reduced) this.reset(); }
  target(x, y) { if (!this.reduced) { this.targetX = clamp(x); this.targetY = clamp(y); } }
  activate(now) {
    if (this.reduced || now - this.lastActivation < 1200) return false;
    this.lastActivation = this.activatedAt = now;
    return true;
  }
  sample(now) {
    if (this.reduced) return { x: 0, y: 0, blink: 0, nod: 0, animating: false };
    const dt = this.last === null ? 0 : Math.max(0, Math.min(100, now - this.last));
    this.last = now;
    const follow = 1 - Math.exp(-dt / 140);
    this.x += (this.targetX - this.x) * follow;
    this.y += (this.targetY - this.y) * follow;
    if (Math.abs(this.targetX - this.x) < .001) this.x = this.targetX;
    if (Math.abs(this.targetY - this.y) < .001) this.y = this.targetY;
    const age = now - this.activatedAt;
    const blinkAge = age - 80;
    const blink = blinkAge < 0 || blinkAge >= 310 ? 0 : blinkAge < 110 ? smooth(blinkAge / 110) : blinkAge < 160 ? 1 : 1 - smooth((blinkAge - 160) / 150);
    const nod = age >= 0 && age < 620 ? Math.sin(Math.PI * age / 620) ** 2 : 0;
    const look = age < 0 || age >= 620 ? 1 : age < 80 ? 1 - smooth(age / 80) : age < 390 ? 0 : smooth((age - 390) / 230);
    return { x: this.x * look, y: this.y * look, blink, nod,
      animating: age < 620 || this.x !== this.targetX || this.y !== this.targetY };
  }
}

// Shares the existing widget's 420ms / 8px boundary without capturing pointers.
// A captured long press, cancelled gesture or movement never becomes a pat.
export function bindCompanionInput({ element, locate, onTarget, onActivate, onReset, now = () => performance.now() }) {
  let gesture;
  const dragging = () => element.ownerDocument.body.hasAttribute('data-dragging');
  const doc = element.ownerDocument, win = doc.defaultView;
  const reset = () => { gesture = null; onReset(); };
  const down = e => {
    if (e.button !== 0 || e.isPrimary === false || element.inert || !locate(e)?.role || dragging()) return;
    gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, at: now(), moved: false };
  };
  const move = e => {
    if (gesture && gesture.id === e.pointerId && Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > 8) gesture.moved = true;
    if (element.inert || dragging()) { onReset(); return; }
    const p = locate(e);
    onTarget(p?.head ? p.x : 0, p?.head ? p.y : 0);
  };
  const up = e => {
    const g = gesture; if (!g || g.id !== e.pointerId) return;
    gesture = null;
    if (!g.moved && now() - g.at < 420 && Math.hypot(e.clientX - g.x, e.clientY - g.y) <= 8 && !dragging() && !element.inert && locate(e)?.role) onActivate();
  };
  const cancel = () => reset();
  const leave = () => reset();
  const key = e => {
    if (e.target !== element || element.inert || dragging() || !['Enter', ' '].includes(e.key)) return;
    e.preventDefault(); if (!e.repeat) onActivate();
  };
  element.addEventListener('pointerdown', down);
  element.addEventListener('pointermove', move);
  element.addEventListener('pointerleave', leave);
  element.addEventListener('keydown', key);
  doc.addEventListener('pointerup', up);
  doc.addEventListener('pointercancel', cancel);
  doc.addEventListener('lostpointercapture', cancel);
  win.addEventListener('blur', cancel);
  return () => {
    reset(); element.removeEventListener('pointerdown', down); element.removeEventListener('pointermove', move);
    element.removeEventListener('pointerleave', leave); element.removeEventListener('keydown', key);
    doc.removeEventListener('pointerup', up); doc.removeEventListener('pointercancel', cancel);
    doc.removeEventListener('lostpointercapture', cancel); win.removeEventListener('blur', cancel);
  };
}
