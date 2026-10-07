import { containedCanvasRect } from './seat-ground.mjs';

// Rendering, companion hits and placement all decode the published camera.
// CSS pixels are independent of the rounded high-DPI canvas backing size.
export function canvasRoomPoint(canvas, x, y) {
  const viewport = containedCanvasRect(canvas);
  const camera = JSON.parse(canvas.dataset.sourceCrop || '{}');
  if (!viewport.scale || !Number.isFinite(camera.x) || !Number.isFinite(camera.y)) return null;
  return { x: camera.x + (x - viewport.x) / viewport.scale,
    y: camera.y + (y - viewport.y) / viewport.scale };
}
