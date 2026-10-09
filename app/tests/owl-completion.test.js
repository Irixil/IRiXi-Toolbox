'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FocusService } = require('../owl/src/service.cjs');
const { initialState, validateState } = require('../owl/src/core.cjs');

function harness(saved = initialState()) {
  let state = structuredClone(saved), now = { wall: 100_000, mono: 100_000 };
  let round = 0, request = 0, writeError = null;
  const writes = [], completed = [];
  const store = {
    read: () => structuredClone(state),
    write(value) {
      if (writeError) throw writeError;
      validateState(value);
      state = structuredClone(value); writes.push(structuredClone(value));
    },
    close() {},
  };
  const service = new FocusService(store, { clock: () => ({ ...now }), makeId: () => `round-${++round}`, startWithAllItems: false });
  service.on('completed', value => {
    // The event must observe the successful persisted result, not a candidate.
    assert.equal(state.revision, service.snapshot().revision);
    completed.push(value);
  });
  return {
    service, completed, writes,
    saved: () => structuredClone(state),
    failWrite: error => { writeError = error; },
    elapse(ms, wallMs = ms) { now.mono += ms; now.wall += wallMs; },
    tick(ms = 1000, wallMs = ms) { this.elapse(ms, wallMs); return service.tick(); },
    command(value) { return service.dispatch({ requestId: `request-${++request}`, ...value }); },
    start(seconds = 3) { return this.command({ type: 'start', task: '隔离完成测试', seconds }); },
  };
}

test('natural focus completion emits saved round duration once and does not double award', () => {
  const h = harness();
  h.start(300);
  for (let i = 0; i < 30; i++) h.tick(10_000);
  const saved = h.saved();
  assert.deepEqual(h.completed, [{ sessionId: 'round-1', kind: 'focus', focusMs: 300_000,
    durationMs: 300_000, startedAt: 100_000, completedAt: 400_000 }]);
  assert.equal(Object.isFrozen(h.completed[0]), true);
  assert.equal(saved.active, null);
  assert.equal(saved.lastOutcome.sessionId, 'round-1');
  assert.equal(saved.lastOutcome.focusMs, 300_000);
  assert.equal(saved.totalFocusMs, 300_000);
  assert.equal(saved.settledFocusMs, 300_000);
  assert.equal(saved.creditedMinutes, 5);
  assert.equal(saved.collection.owned.filter(id => id === 'round-glasses').length, 1);
  h.tick(); h.tick();
  h.command({ type: 'preferences', reducedMotion: true });
  assert.equal(h.completed.length, 1);
  assert.equal(h.saved().totalFocusMs, 300_000);
  assert.deepEqual(h.saved().collection.owned, saved.collection.owned);
});

test('endpoint start-next preserves completion of old round when its outcome is cleared', () => {
  const h = harness(); h.start(); h.elapse(3000);
  const next = h.command({ type: 'start-next', sessionId: 'round-1', task: '下一轮', seconds: 7 });
  assert.equal(next.active.id, 'round-2');
  assert.equal(next.lastOutcome, null);
  assert.equal(next.totalFocusMs, 3000);
  assert.equal(h.completed.length, 1);
  assert.equal(h.completed[0].sessionId, 'round-1');
  assert.equal(h.completed[0].durationMs, 3000);
  h.tick(7000);
  assert.equal(h.completed.length, 2);
  assert.equal(h.completed[1].sessionId, 'round-2');
  assert.equal(h.completed[1].focusMs, 7000);
  assert.equal(h.saved().totalFocusMs, 10_000);
});

test('a tick beyond the endpoint reports only the completed round duration', () => {
  const h = harness(); h.start(); h.tick(4500);
  assert.equal(h.completed[0].focusMs, 3000);
  assert.equal(h.completed[0].durationMs, 3000);
  assert.equal(h.saved().totalFocusMs, 3000);
});

test('natural endpoint is persisted and announced even when the accompanying command is stale or invalid', () => {
  for (const value of [
    { type: 'pause', sessionId: 'round-1' },
    { type: 'start-next', sessionId: 'round-1', task: '下一轮', seconds: 0 },
  ]) {
    const h = harness(); h.start(); h.elapse(3000);
    assert.throws(() => h.command(value));
    assert.equal(h.saved().active, null);
    assert.equal(h.saved().totalFocusMs, 3000);
    assert.equal(h.completed.length, 1);
    h.tick();
    assert.equal(h.completed.length, 1);
  }
});

test('ending or replacing an unfinished focus round preserves actual time without celebrating', () => {
  for (const type of ['end', 'start-next']) {
    const h = harness(); h.start(10); h.elapse(3000);
    h.command({ type, sessionId: 'round-1', task: '下一轮', seconds: 7 });
    assert.equal(h.completed.length, 0);
    assert.equal(h.saved().lastOutcome.outcome, 'ended');
    assert.equal(h.saved().lastOutcome.focusMs, 3000);
    assert.equal(h.saved().lastOutcome.durationMs, 10_000);
    assert.equal(h.saved().totalFocusMs, 3000);
  }
});

test('pause, long gaps, clock changes and suspend do not credit or celebrate missed time', () => {
  const paused = harness(); paused.start();
  paused.command({ type: 'pause', sessionId: 'round-1' }); paused.tick(30_000);
  assert.equal(paused.completed.length, 0);
  assert.equal(paused.saved().totalFocusMs, 0);
  paused.command({ type: 'resume', sessionId: 'round-1' }); paused.tick(3000);
  assert.equal(paused.completed.length, 1);
  assert.equal(paused.completed[0].focusMs, 3000);

  for (const [mono, wall] of [[16_000, 16_000], [1000, 5000], [-1000, -1000]]) {
    const h = harness(); h.start(); h.tick(mono, wall);
    assert.equal(h.saved().active.status, 'paused');
    assert.equal(h.saved().totalFocusMs, 0);
    assert.equal(h.completed.length, 0);
  }
  const asleep = harness(); asleep.start(10); asleep.elapse(1000); asleep.service.suspend();
  asleep.tick(60_000);
  assert.equal(asleep.saved().active.status, 'paused');
  assert.equal(asleep.saved().totalFocusMs, 1000);
  assert.equal(asleep.completed.length, 0);
});

test('a round genuinely reaching its endpoint during suspend is saved and announced once', () => {
  const h = harness(); h.start(); h.elapse(3000); h.service.suspend();
  assert.equal(h.saved().active, null);
  assert.equal(h.completed.length, 1);
  h.service.suspend(); h.tick(60_000);
  assert.equal(h.completed.length, 1);
});

test('break completion and reopening a completed or interrupted save never replay focus celebration', () => {
  const resting = harness(); resting.command({ type: 'break', seconds: 3 }); resting.tick(3000);
  assert.equal(resting.saved().lastOutcome.kind, 'break');
  assert.equal(resting.saved().lastOutcome.focusMs, 0);
  assert.equal(resting.completed.length, 0);

  const h = harness(); h.start(); h.tick(3000);
  const reopened = harness(h.saved()); reopened.tick();
  assert.equal(reopened.completed.length, 0);
  assert.equal(reopened.saved().totalFocusMs, 3000);

  const running = harness(); running.start(10); running.tick();
  const interrupted = harness(running.saved()); interrupted.tick(10_000);
  assert.equal(interrupted.saved().active.status, 'paused');
  assert.equal(interrupted.saved().totalFocusMs, 1000);
  assert.equal(interrupted.completed.length, 0);
});

test('failed completion persistence emits no celebration and keeps last successfully saved time', () => {
  for (const replaced of [false, true]) {
    const h = harness(); h.start(); h.tick();
    const error = new Error('隔离写入失败'); error.focusStateReplaced = replaced;
    h.failWrite(error);
    assert.throws(() => h.tick(2000), /隔离写入失败/);
    assert.equal(h.completed.length, 0);
    assert.equal(h.service.snapshot().active.elapsedMs, 1000);
    assert.equal(h.service.snapshot().totalFocusMs, 1000);
    assert.ok(h.service.snapshot().fault);
    h.tick(3000);
    assert.equal(h.completed.length, 0);
  }
});

test('a failed completion observer cannot break saved state, once semantics or other observers', t => {
  const h = harness(); h.start();
  const errors = t.mock.method(console, 'error', () => {});
  let once = 0, later = 0;
  h.service.once('completed', () => { once++; throw new Error('隔离浮层失败'); });
  h.service.on('completed', () => { later++; });
  assert.doesNotThrow(() => h.tick(3000));
  assert.equal(h.saved().lastOutcome.outcome, 'completed');
  assert.equal(h.service.snapshot().fault, null);
  assert.equal(once, 1); assert.equal(later, 1); assert.equal(errors.mock.callCount(), 1);
  h.start(); h.tick(3000);
  assert.equal(once, 1); assert.equal(later, 2); assert.equal(h.completed.length, 2);
  assert.equal(h.saved().totalFocusMs, 6000);
});

test('an asynchronous completion observer rejection does not create a storage fault', async t => {
  const h = harness(); h.start();
  const errors = t.mock.method(console, 'error', () => {});
  h.service.on('completed', async () => { throw new Error('隔离异步浮层失败'); });
  h.tick(3000);
  await Promise.resolve();
  assert.equal(errors.mock.callCount(), 1);
  assert.equal(h.service.snapshot().fault, null);
  assert.equal(h.saved().totalFocusMs, 3000);
  h.tick();
  assert.equal(h.completed.length, 1);
});

test('legacy outcomes remain readable, while incomplete or false completed metadata is rejected', () => {
  const h = harness(); h.start(); h.tick(3000);
  const current = h.saved();
  const legacy = structuredClone(current);
  for (const field of ['sessionId', 'durationMs', 'focusMs', 'startedAt']) delete legacy.lastOutcome[field];
  assert.doesNotThrow(() => validateState(legacy));
  const partial = structuredClone(current); delete partial.lastOutcome.sessionId;
  assert.throws(() => validateState(partial), /本轮完成记录/);
  const wrong = structuredClone(current); wrong.lastOutcome.focusMs = 2000;
  assert.throws(() => validateState(wrong), /本轮完成记录/);
});
