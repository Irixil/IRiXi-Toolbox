'use strict';
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { validateState, advance, interrupt, command } = require('./core.cjs');
const {CATALOG,validateCatalog,itemStates,awardOwned}=require('./collection.cjs');

class FocusService extends EventEmitter {
  constructor(store, { clock = () => ({ wall: Date.now(), mono: Number(process.hrtime.bigint() / 1_000_000n) }),
    makeId = randomUUID, maxGapMs = 15_000, catalog=CATALOG, startWithAllItems=process.argv.includes('--test-all-items') } = {}) {
    super();
    this.catalog=validateCatalog(catalog);this.store = store; this.clock = clock; this.makeId = makeId; this.maxGapMs = maxGapMs;
    this.state = structuredClone(validateState(store.read()));
    this.last = clock(); this.fault = null;
    const candidate=structuredClone(this.state);awardOwned(candidate,this.catalog);
    let changed=JSON.stringify(candidate.collection)!==JSON.stringify(this.state.collection);
    if(startWithAllItems&&candidate.testAccess===undefined){command(candidate,{type:'test-access',enabled:true,requestId:randomUUID()},this.last.wall,this.makeId,this.catalog);changed=true;}
    if (candidate.active) {
      interrupt(candidate, `上次退出时这一轮未结束，已暂停。只保留截至最后保存的有效时间（${new Date(this.state.lastSavedAt).toLocaleString('zh-CN')}）；之后的间隔未计入。请确认后继续。`, this.last.wall);
    }
    if(changed||candidate.active)this.commit(candidate,this.last);
  }
  snapshot() { return { ...structuredClone(this.state), fault: this.fault, collectionCatalog:{version:this.catalog.version,room:structuredClone(this.catalog.room),categories:structuredClone(this.catalog.categories),items:itemStates(this.state,this.catalog)} }; }
  commit(candidate, sample) {
    candidate.revision = this.state.revision + 1;
    candidate.lastSavedAt = sample.wall;
    try { this.store.write(candidate); }
    catch (e) {
      this.fault = e.focusStateReplaced
        ? `存档文件已替换，但未能确认落盘；计时已停止。请关闭后检查存储，不继续累计：${e.message}`
        : `保存失败，计时已停止；最后成功保存的进度已保留。请关闭后检查存储，不继续累计：${e.message}`;
      this.emit('change', this.snapshot());
      throw e;
    }
    this.state = candidate; this.last = sample;
    this.emit('change', this.snapshot());
  }
  settle(candidate, sample) {
    const delta = sample.mono - this.last.mono;
    const wallDelta = sample.wall - this.last.wall;
    if (candidate.active?.status !== 'running') return false;
    if (delta < 0 || delta > this.maxGapMs || Math.abs(delta - wallDelta) > 2000) {
      return interrupt(candidate, '检测到长时间中断或时钟变化，已暂停；最后保存后的间隔没有计入。请确认后继续。', sample.wall);
    }
    return advance(candidate, delta, sample.wall,this.catalog);
  }
  tick() {
    if (this.fault) return this.snapshot();
    const sample = this.clock();
    const candidate = structuredClone(this.state);
    if (this.settle(candidate, sample)) this.commit(candidate, sample);
    else this.last = sample;
    return this.snapshot();
  }
  dispatch(c) {
    if (this.fault) throw new Error(this.fault);
    const sample = this.clock();
    const candidate = structuredClone(this.state);
    const settled = this.settle(candidate, sample);
    // Settled time must survive a stale or rejected UI command too.
    let changed;
    try { changed = command(candidate, c, sample.wall, this.makeId,this.catalog); }
    catch (e) { if (settled) this.commit(candidate, sample); else this.last = sample; throw e; }
    if (settled || changed) this.commit(candidate, sample);
    else this.last = sample;
    return this.snapshot();
  }
  suspend(reason = '电脑即将休眠，已暂停；唤醒后请确认继续，休眠时间不计入。') {
    if (this.fault) return this.snapshot();
    const sample = this.clock();
    const candidate = structuredClone(this.state);
    const settled = this.settle(candidate, sample);
    const changed = interrupt(candidate, reason, sample.wall);
    if (settled || changed) this.commit(candidate, sample); else this.last = sample;
    return this.snapshot();
  }
  close() {
    try { if (!this.fault) this.suspend('窗口进程已退出，活动计时已暂停；下次打开请确认继续。'); }
    finally { this.store.close(); }
  }
}
module.exports = { FocusService };
