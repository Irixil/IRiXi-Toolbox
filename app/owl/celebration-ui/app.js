const bridge = window.owlCompletion;
const stage = document.querySelector('#celebration');
const card = document.querySelector('#completion-card');
const title = document.querySelector('#completion-title');
const avatar = document.querySelector('#owl-avatar');
// Reuse the original front-facing head atlas unchanged. The square source crop
// keeps the feather texture, face shape, yellow eyes and original proportions.
const originalHead = new Image();
originalHead.addEventListener('load', () => {
  const context = avatar.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(originalHead, 0, 0, 418, 418, 0, 0, avatar.width, avatar.height);
  avatar.dataset.source = 'head-poses.png:0,0,418,418';
});
originalHead.src = new URL('../ui/assets/motion-v7/head-poses.png', import.meta.url).href;
const media = window.matchMedia('(prefers-reduced-motion: reduce)');
const colors = ['#8c9c77', '#d3b779', '#cba299', '#b4a6bd', '#ead9b2'];
const kinds = new Set(['meteors', 'fireworks', 'ribbons', 'flowers']);
const animations = new Set();
const timers = new Set();
let entryFrame = null;
let current = null;

const random = (min, max) => min + Math.random() * (max - min);
const color = index => colors[index % colors.length];
const svg = (width, height, content) => `<svg class="doodle" viewBox="0 0 ${width} ${height}" aria-hidden="true">${content}</svg>`;

function later(callback, delay) {
  const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay);
  timers.add(timer);
}

function animate(element, frames, options) {
  const animation = element.animate(frames, { fill: 'both', ...options });
  animations.add(animation);
  animation.finished.then(() => {
    animations.delete(animation);
    element.style.removeProperty('will-change');
    if (element.classList.contains('particle') || element.classList.contains('launch')) element.remove();
  }).catch(() => {});
  return animation;
}

function particle(art, x, y, width, height = width, className = 'particle') {
  const element = document.createElement('div');
  element.className = className;
  element.style.left = `${x}px`;
  element.style.top = `${y}px`;
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
  element.innerHTML = art;
  stage.append(element);
  return element;
}

function clearEffect() {
  if (entryFrame !== null) cancelAnimationFrame(entryFrame);
  entryFrame = null;
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  for (const animation of animations) animation.cancel();
  animations.clear();
  stage.replaceChildren();
}

function durationText(durationMs) {
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${seconds} 秒`;
  return rest === 0 ? `${minutes} 分钟` : `${minutes} 分钟 ${rest} 秒`;
}

function star(fill, tail = false) {
  return svg(tail ? 130 : 32, tail ? 130 : 32, tail
    ? `<path d="M31 94 117 8m-75 94L127 17M26 85l63-63" stroke="${fill}" opacity=".64" stroke-width="2.5"/><path d="m23 91 4 12 13 3-12 5-3 13-5-12-13-4 12-4Z" fill="${fill}" stroke="#958363" stroke-width="1.3"/>`
    : `<path d="m16 2 4 10 10 4-10 4-4 10-4-10-10-4 10-4Z" fill="${fill}" stroke="#958363" stroke-width="1.4"/>`);
}

function flower(fill) {
  return svg(40, 40, `<path d="M20 12c-8-15-21-2-11 6-17-1-12 19 2 12-4 16 15 18 17 3 12 11 23-5 9-12 16-7 2-20-8-9 1-17-19-14-16 1Z" transform="translate(-2 -1) scale(.83)" fill="${fill}" stroke="#9c8972" stroke-width="1.4"/><path d="M24 18c5 5-1 13-7 9-6-4-1-13 7-9Z" fill="#e6cc8c" stroke="#a99465" stroke-width="1.2"/>`);
}

function petal(fill) {
  return svg(24, 34, `<path d="M11 31C-3 23 0 5 18 2c9 13 1 24-7 29Z" fill="${fill}" stroke="#a39179" stroke-width="1.3"/><path d="M11 26q2-10 6-17" stroke="#a39179" opacity=".6"/>`);
}

function meteors() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  for (let i = 0; i < 13; i++) {
    const size = random(66, 124);
    const x = width * random(.7, 1.08);
    const y = height * random(-.13, .34);
    const element = particle(star(color(i), true), x, y, size);
    const dx = -width * random(.27, .54);
    const dy = height * random(.3, .58);
    animate(element, [
      { opacity: 0, transform: 'translate(0, 0) scale(.78)', offset: 0 },
      { opacity: .95, transform: `translate(${dx * .12}px, ${dy * .12}px) scale(1)`, offset: .16 },
      { opacity: .8, transform: `translate(${dx * .82}px, ${dy * .82}px) scale(.92)`, offset: .8 },
      { opacity: 0, transform: `translate(${dx}px, ${dy}px) scale(.7)` },
    ], { duration: random(1400, 2200), delay: i * 165, easing: 'linear' });
  }
}

function fireworks() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const origins = [.12, .31, .74, .9];
  origins.forEach((fraction, burst) => {
    const x = width * fraction;
    const rise = Math.min(height * random(.24, .39), 340);
    const y = height - rise;
    const launch = particle(svg(18, 78, `<path d="M9 70 8 20m5 51V34" stroke="${color(burst)}" stroke-width="2" opacity=".65"/><path d="m9 4 3 8 4 3-6 2-2 6-2-6-4-3 5-2Z" fill="${color(burst)}"/>`), x - 9, height - 25, 18, 78, 'launch');
    animate(launch, [
      { opacity: 0, transform: 'translateY(0)' },
      { opacity: .8, transform: `translateY(${-rise * .15}px)`, offset: .15 },
      { opacity: .85, transform: `translateY(${-rise * .91}px)`, offset: .85 },
      { opacity: 0, transform: `translateY(${-rise}px)` },
    ], { duration: 750, delay: burst * 500, easing: 'cubic-bezier(.25,.46,.45,.94)' });
    later(() => burstAt(x, y, burst), 620 + burst * 500);
  });
}

function burstAt(x, y, burst) {
  for (let i = 0; i < 19; i++) {
    const angle = (i / 19) * Math.PI * 2 + random(-.045, .045);
    const radius = random(72, 135);
    const dx = Math.cos(angle) * radius;
    const dy = Math.sin(angle) * radius;
    const fill = color(i + burst);
    const art = i % 5 === 0 ? star(fill) : svg(12, 28, `<path d="M6 3q-3 6 1 11l-2 9" stroke="#928063" stroke-width="4.3" opacity=".72"/><path d="M6 3q-3 6 1 11l-2 9" stroke="${fill}" stroke-width="3.2"/><path d="M9 3q-2 6 0 8" stroke="#9d8b6d" stroke-width=".8" opacity=".65"/>`);
    const element = particle(art, x - 8, y - 14, i % 5 === 0 ? 24 : 12, i % 5 === 0 ? 24 : 28);
    const rotation = angle * 180 / Math.PI + 90;
    animate(element, [
      { opacity: 0, transform: `translate(0,0) rotate(${rotation}deg) scale(.15)` },
      { opacity: 1, transform: `translate(${dx * .72}px,${dy * .72}px) rotate(${rotation}deg) scale(.95)`, offset: .28 },
      { opacity: .9, transform: `translate(${dx}px,${dy + 8}px) rotate(${rotation + 15}deg) scale(1)`, offset: .65 },
      { opacity: 0, transform: `translate(${dx * 1.09}px,${dy + 40}px) rotate(${rotation + 30}deg) scale(.65)` },
    ], { duration: random(1350, 1950), easing: 'linear' });
  }
}

function ribbons() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  for (let i = 0; i < 31; i++) {
    const fill = color(i);
    const isCurl = i % 3 === 0;
    const art = isCurl
      ? svg(32, 64, `<path d="M8 3C32 7 31 28 9 27s-12 24 11 29" stroke="${fill}" stroke-width="5"/><path d="M7 4c25 2 22 23 3 23" stroke="#a18f78" stroke-width=".8" opacity=".7"/>`)
      : svg(28, 46, `<path d="M7 3 21 7 16 39 2 35Z" fill="${fill}" stroke="#a18f78" stroke-width="1.2"/><path d="m10 8-4 22" stroke="#fbf4e3" stroke-width="1.4" opacity=".7"/>`);
    const element = particle(art, width * random(-.06, .3), height * random(-.15, .08), random(12, 26), isCurl ? 47 : 32);
    const dx = width * random(.2, .65);
    const dy = height * random(.56, .96);
    const rotate = random(80, 230);
    animate(element, [
      { opacity: 0, transform: `translate(0,0) rotate(${-rotate / 2}deg)` },
      { opacity: .98, transform: `translate(${dx * .12}px,${dy * .08}px) rotate(0deg)`, offset: .12 },
      { opacity: .95, transform: `translate(${dx * .66}px,${dy * .64}px) rotate(${rotate}deg)`, offset: .7 },
      { opacity: 0, transform: `translate(${dx}px,${dy}px) rotate(${rotate * 1.6}deg)` },
    ], { duration: random(2300, 3400), delay: i * 38, easing: 'linear' });
  }
}

function giftArt() {
  return svg(135, 146, `<path d="M26 73 112 71l-4 61-76 2Z" fill="#b4be9e" stroke="#918465" stroke-width="2"/><path d="m64 73 11-1 1 60-11 1Z" fill="#ead9b2" stroke="#ad9a71" stroke-width="1.2"/><path d="m34 84 21-1m31-1 18-1" stroke="#f4ebd7" stroke-width="1.3" opacity=".7"/><g class="gift-lid"><path d="m22 61 94-3 1 20-94 2Z" fill="#c8cfb0" stroke="#918465" stroke-width="2"/><path d="m62 59 12-1 2 20-13 1Z" fill="#ead9b2" stroke="#ad9a71" stroke-width="1.2"/><path d="M68 58C36 65 31 26 55 34c9 4 10 15 13 24Zm0 0c28 3 35-31 14-27-10 3-11 19-14 27Z" fill="#e5d09c" stroke="#a08a60" stroke-width="1.7"/><path d="m65 60-13 9m20-9 15 8" stroke="#a08a60" stroke-width="1.4"/></g><path d="M20 138q52 7 97-2" stroke="#ac9b7b" stroke-width="2" opacity=".35"/>`);
}

function flowers() {
  const gift = document.createElement('div');
  gift.className = 'gift';
  gift.innerHTML = giftArt();
  stage.append(gift);
  animate(gift, [
    { opacity: 0, transform: 'translateY(82px) rotate(4deg)' },
    { opacity: 1, transform: 'translateY(-5px) rotate(-2deg)', offset: .8 },
    { opacity: 1, transform: 'translateY(0) rotate(0)' },
  ], { duration: 340, easing: 'cubic-bezier(.22,1,.36,1)' });
  later(() => {
    animate(gift.querySelector('.gift-lid'), [
      { transform: 'translate(0,0) rotate(0)' },
      { transform: 'translate(-19px,-42px) rotate(-23deg)' },
    ], { duration: 430, easing: 'cubic-bezier(.22,1,.36,1)' });
    const bounds = gift.getBoundingClientRect();
    const x = bounds.left + bounds.width * .53;
    const y = bounds.top + bounds.height * .49;
    for (let i = 0; i < 26; i++) {
      const isFlower = i % 3 === 0;
      const size = isFlower ? random(29, 44) : random(13, 22);
      const element = particle(isFlower ? flower(color(i)) : petal(color(i)), x - size / 2, y - size / 2, size, isFlower ? size : size * 1.4);
      const dx = random(-215, 76);
      const dy = random(-245, -96);
      const rotation = random(-90, 90);
      animate(element, [
        { opacity: 0, transform: `translate(0,0) rotate(0deg) scale(.3)` },
        { opacity: 1, transform: `translate(${dx * .64}px,${dy}px) rotate(${rotation}deg) scale(1)`, offset: .34 },
        { opacity: .95, transform: `translate(${dx}px,${dy * .57}px) rotate(${rotation + 85}deg) scale(1)`, offset: .73 },
        { opacity: 0, transform: `translate(${dx * 1.16}px,${dy * .13 + 45}px) rotate(${rotation + 180}deg) scale(.75)` },
      ], { duration: random(1900, 2850), delay: i * 33, easing: 'cubic-bezier(.25,.46,.45,.94)' });
    }
  }, 360);
  later(() => animate(gift, [
    { opacity: 1, transform: 'translateY(0)' },
    { opacity: 0, transform: 'translateY(18px)' },
  ], { duration: 250, easing: 'ease-out' }), 4200);
}

function show(payload) {
  if (!payload || !Number.isFinite(payload.durationMs) || payload.durationMs < 1000) return;
  clearEffect();
  current = { ...payload, kind: kinds.has(payload.kind) ? payload.kind : 'flowers' };
  const reducedMotion = payload.reducedMotion === true || media.matches;
  document.body.classList.toggle('reduced-motion', reducedMotion);
  document.body.dataset.kind = current.kind;
  title.textContent = `刚刚成功专注 ${durationText(payload.durationMs)}`;
  card.classList.remove('visible');
  card.hidden = false;
  bridge?.interactive(false);
  entryFrame = requestAnimationFrame(() => {
    entryFrame = null;
    card.classList.add('visible');
    if (!reducedMotion) ({ meteors, fireworks, ribbons, flowers })[current.kind]();
  });
}

card.addEventListener('pointerenter', () => bridge?.interactive(true));
card.addEventListener('pointerleave', () => bridge?.interactive(false));
document.querySelector('#dismiss').addEventListener('click', () => {
  clearEffect();
  card.hidden = true;
  card.classList.remove('visible');
  bridge?.interactive(false);
  bridge?.dismiss();
});

media.addEventListener('change', () => {
  if (media.matches) {
    clearEffect();
    document.body.classList.add('reduced-motion');
    card.classList.add('visible');
  }
});

window.addEventListener('pagehide', () => {
  clearEffect();
  bridge?.interactive(false);
});
bridge?.onShow(show);
