/*
 * Public-source fallback effects for IRiXi Toolbox.
 * This file intentionally contains no code derived from the previously
 * referenced Vue Bits Color Bends implementation.
 */
(function bootstrapFallbackEffects() {
  'use strict';

  const canvas = document.getElementById('music-color-bends');
  const tile = canvas?.parentElement;
  let panelExpanded = document.getElementById('app')?.classList.contains('expanded') === true;
  let pointerInside = false;

  function musicIsVisible() {
    return window.NotchHome?.isVisible?.('music') !== false && !tile?.hidden;
  }

  function setEnabled(enabled = pointerInside) {
    if (!canvas) return;
    const running = Boolean(enabled && pointerInside && panelExpanded && musicIsVisible());
    canvas.dataset.effectRunning = running ? 'true' : 'false';
  }

  function refreshLists() {
    setEnabled();
  }

  if (canvas) canvas.dataset.effectRunning = 'false';
  tile?.addEventListener('pointerenter', () => {
    pointerInside = true;
    setEnabled(true);
  });
  tile?.addEventListener('pointerleave', () => {
    pointerInside = false;
    setEnabled(false);
  });

  document.addEventListener('notch:home-modules-changed', () => setEnabled());
  document.addEventListener('notch:modechange', (event) => {
    panelExpanded = event.detail?.expanded === true;
    setEnabled();
  });
  window.DynamicPanelEffects = {
    redraw: setEnabled,
    refreshLists,
  };
})();
