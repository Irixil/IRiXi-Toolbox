// Registration is the existing unmodified 1254px seat art in the v7 rig.
// Scan alpha at the four leg zones; do not move or animate the chair.
export function contactsFromSeatPixels({ data, width, height }) {
  const zones = [[350, 470], [470, 550], [700, 790], [790, 915]];
  const contacts = [];
  for (const [start, end] of zones) {
    let bottom = -1;
    for (let y = 950; y < height; y++) for (let x = start; x < Math.min(end, width); x++) {
      if (data[(y * width + x) * 4 + 3] > 80) bottom = Math.max(bottom, y);
    }
    if (bottom < 0) continue;
    let left = end, right = start;
    for (let y = Math.max(950, bottom - 3); y <= bottom; y++) for (let x = start; x < Math.min(end, width); x++) {
      if (data[(y * width + x) * 4 + 3] > 80) { left = Math.min(left, x); right = Math.max(right, x); }
    }
    if (right - left + 1 >= 6) contacts.push({ x: 23 + (left + right + 1) / 2 * .681, y: 110 + (bottom + 1) * .681, width: (right - left + 1) * .681 });
  }
  if (!contacts.length) throw Error('座位接地点无法读取');
  return { groundY: Math.max(...contacts.map(p => p.y)), contacts };
}
export function measureSeatGround(bodyAtlas, chairFront, makeCanvas) {
  const c = makeCanvas(1254, 1254), ctx = c.getContext('2d', { willReadFrequently: true });
  const measure = draw => { ctx.clearRect(0, 0, 1254, 1254); draw(); return contactsFromSeatPixels(ctx.getImageData(0, 0, 1254, 1254)); };
  const result = { stool: measure(() => ctx.drawImage(bodyAtlas, 793, 629, 450, 303, 363, 874, 532, 274)) };
  if (chairFront) result['reading-chair'] = measure(() => ctx.drawImage(chairFront, 0, 0));
  return result;
}
function softEllipse(ctx, x, y, rx, ry, alpha) {
  ctx.save(); ctx.translate(x, y); ctx.scale(rx, ry);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, `rgba(91,70,48,${alpha})`); gradient.addColorStop(1, 'rgba(91,70,48,0)');
  ctx.fillStyle = gradient; ctx.beginPath(); ctx.ellipse(0, 0, 1, 1, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}
export function paintSeatGround(ctx, metrics, crop) {
  if (!metrics) return;
  const xs = metrics.contacts.map(p => p.x), left = Math.min(...xs), right = Math.max(...xs);
  ctx.save(); ctx.translate(-crop.x, -crop.y);
  softEllipse(ctx, (left + right) / 2, metrics.groundY + 2, (right - left) / 2 + 40, 9, .08);
  for (const p of metrics.contacts) {
    softEllipse(ctx, p.x, p.y + .4, p.width / 2 + 7, 3.2, .16);
    softEllipse(ctx, p.x, p.y, Math.max(3, p.width / 2), 1.25, .18);
  }
  ctx.restore();
}
export function containedCanvasRect(canvas) {
  const r = canvas.getBoundingClientRect(), crop=canvas.dataset?.sourceCrop?JSON.parse(canvas.dataset.sourceCrop):{width:canvas.width,height:canvas.height}, scale = Math.min(r.width / crop.width, r.height / crop.height);
  return { scale, x: r.left + (r.width - crop.width * scale) / 2, y: r.top + (r.height - crop.height * scale) / 2 };
}
