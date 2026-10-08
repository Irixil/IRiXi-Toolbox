'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveCollapsedStrip, resolveExpandedTopInset, resolveNotchPaintInset } = require('../display-top-geometry');
const display = { id:1, scaleFactor:2, bounds:{x:0,y:0,width:1470,height:956}, workArea:{x:0,y:33,width:1470,height:866} };
const native = { id:1, frame:{...display.bounds}, safeAreaTop:32,
  auxiliaryTopLeftArea:{x:0,width:646}, auxiliaryTopRightArea:{x:825,width:645} };

test('measured built-in safe-area gap replaces the wider200pt strip, even with an auto-hidden menu bar', () => {
  const expected={x:646,y:0,width:179,height:32,source:'system-notch-safe-area'};
  assert.deepEqual(resolveCollapsedStrip(display,[native]),expected);
  assert.deepEqual(resolveCollapsedStrip({...display,workArea:{...display.workArea,y:0}},[native]),expected);
});
test('non-central notch and a display above/left of the primary retain actual screen coordinates', () => {
  const d={...display,id:2,bounds:{x:-1800,y:-1100,width:1800,height:1100},workArea:{x:-1800,y:-1062,width:1800,height:1030}};
  const s={id:2,frame:d.bounds,safeAreaTop:38,auxiliaryTopLeftArea:{x:-1800,width:850},auxiliaryTopRightArea:{x:-740,width:740}};
  assert.deepEqual(resolveCollapsedStrip(d,[native,s]),{x:-950,y:-1100,width:210,height:38,source:'system-notch-safe-area'});
});
test('logical geometry is unchanged by backing scale, while a genuine display zoom change is remeasured', () => {
  assert.deepEqual(resolveCollapsedStrip({...display,scaleFactor:1},[native]),resolveCollapsedStrip(display,[native]));
  const d={...display,bounds:{x:0,y:0,width:1710,height:1112}};
  const s={...native,frame:d.bounds,safeAreaTop:37,auxiliaryTopLeftArea:{x:0,width:752},auxiliaryTopRightArea:{x:958,width:752}};
  assert.deepEqual(resolveCollapsedStrip(d,[s]),{x:752,y:0,width:206,height:37,source:'system-notch-safe-area'});
});
test('no-notch or unavailable geometry uses the real menu bar; small external displays stay in bounds', () => {
  assert.deepEqual(resolveCollapsedStrip(display,[{id:1,frame:display.bounds,safeAreaTop:0}]),{x:635,y:0,width:200,height:33,source:'menu-bar-fallback'});
  const d={id:3,bounds:{x:1470,y:150,width:160,height:600},workArea:{x:1470,y:174,width:160,height:576}};
  assert.deepEqual(resolveCollapsedStrip(d),{x:1470,y:150,width:160,height:24,source:'menu-bar-fallback'});
});
test('stale screen frames and malformed native gaps cannot position the panel on the wrong display', () => {
  for(const s of [{...native,id:9},{...native,frame:{...native.frame,width:1280}}, {...native,auxiliaryTopRightArea:{x:NaN}}, {...native,safeAreaTop:500}]) {
    assert.equal(resolveCollapsedStrip(display,[s]).source,'menu-bar-fallback');
  }
});

test('expanded controls avoid the real menu input band and retain notch safety with an auto-hidden menu', () => {
  assert.equal(resolveExpandedTopInset(display,[native]),33);
  assert.equal(resolveExpandedTopInset({...display,workArea:{...display.workArea,y:0}},[native]),32);
  assert.equal(resolveExpandedTopInset(display,[]),33);
  assert.equal(resolveExpandedTopInset({...display,workArea:{...display.workArea,y:0}},[]),0);
  const external={id:2,bounds:{x:-1800,y:-1100,width:1800,height:1100},workArea:{x:-1800,y:-1076,width:1800,height:1030}};
  assert.equal(resolveExpandedTopInset(external,[]),24);
});

test('notch paint moves one physical pixel inward while measured bounds stay unchanged', () => {
  for (const scaleFactor of [1, 1.5, 2, 2.5, 3]) {
    const d = { ...display, scaleFactor };
    assert.equal(resolveNotchPaintInset(d, [native]) * scaleFactor, 1);
    assert.deepEqual(resolveCollapsedStrip(d, [native]), resolveCollapsedStrip(display, [native]));
  }
  assert.equal(resolveNotchPaintInset(display, []), 0);
  assert.equal(resolveNotchPaintInset({ ...display, scaleFactor: NaN }, [native]), 1);
});
