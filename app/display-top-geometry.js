'use strict';

// All coordinates are logical display points, never camera or model-specific pixels.
function resolveCollapsedStrip(display, nativeScreens = []) {
  const bounds = display.bounds;
  const menuHeight = Math.max(0, display.workArea.y - bounds.y);
  const width = Math.min(200, bounds.width);
  const fallback = { x: Math.round(bounds.x + (bounds.width - width) / 2), y: bounds.y,
    width, height: menuHeight > 0 ? menuHeight : 38, source: 'menu-bar-fallback' };
  const screen = nativeScreens.find(s => s.id === display.id && s.frame &&
    ['x', 'y', 'width', 'height'].every(k => Number.isFinite(s.frame[k]) && Math.abs(s.frame[k] - bounds[k]) <= 1));
  if (!screen) return fallback;
  const left = screen.auxiliaryTopLeftArea, right = screen.auxiliaryTopRightArea;
  const height = screen.safeAreaTop;
  if (!left || !right || !Number.isFinite(height) || height <= 0 || height > 128 ||
      ![left.x, left.width, right.x].every(Number.isFinite)) return fallback;
  const x = left.x + left.width, end = right.x;
  if (x < bounds.x || end > bounds.x + bounds.width || end - x < 8 || end - x > bounds.width / 2) return fallback;
  // BrowserWindow bounds are integers. Round endpoints together to avoid an independent centre/width drift.
  return { x: Math.round(x), y: bounds.y, width: Math.round(end) - Math.round(x),
    height: Math.round(height), source: 'system-notch-safe-area' };
}

module.exports = { resolveCollapsedStrip };
