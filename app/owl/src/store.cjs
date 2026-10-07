'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isUtf8 } = require('node:buffer');
const { initialState, validateState, migrateState } = require('./core.cjs');

class FileStore {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'focus-state.json');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.lock = path.join(dir, 'writer.lock');
    // Electron acquires its OS single-instance lock before creating this store.
    // Reclaim only a recorded, demonstrably dead writer; never an unknown lock.
    try { this.lockFd = fs.openSync(this.lock, 'wx', 0o600); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let pid;
      try { pid = JSON.parse(fs.readFileSync(this.lock, 'utf8')).pid; }
      catch { throw new Error('存档写入锁无法识别，已保留；请检查后恢复。'); }
      if (!Number.isInteger(pid) || pid <= 0) throw new Error('存档写入锁无效，已保留。');
      let dead = false;
      try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') dead = true; }
      if (!dead) throw new Error('已有写入进程使用此存档；不能打开第二个计时核心。');
      fs.unlinkSync(this.lock);
      this.lockFd = fs.openSync(this.lock, 'wx', 0o600);
    }
    fs.writeFileSync(this.lockFd, JSON.stringify({ pid: process.pid }));
  }
  read() {
    let bytes;
    try { bytes = fs.readFileSync(this.file); }
    catch (e) {
      if (e.code === 'ENOENT') return initialState();
      throw new Error(`无法读取专注存档，未覆盖原文件：${e.message}`);
    }
    try {
      if (!isUtf8(bytes)) throw new Error('存档包含损坏的 UTF-8 字节，停止读取以保护原文件。');
      const raw = JSON.parse(bytes.toString('utf8'));
      const state = migrateState(raw);
      if (raw.schema !== state.schema) {
        const hash = createHash('sha256').update(bytes).digest('hex');
        const backup = path.join(this.dir, `focus-state.schema${raw.schema}-${hash}.json`);
        if (fs.existsSync(backup)) {
          if (!fs.readFileSync(backup).equals(bytes)) throw new Error('旧存档备份内容不一致，停止迁移。');
        } else {
          const fd = fs.openSync(backup, 'wx', 0o600);
          try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        }
        const backupDir = fs.openSync(this.dir, 'r');
        try { fs.fsyncSync(backupDir); } finally { fs.closeSync(backupDir); }
        this.write(state);
      }
      return state;
    }
    catch (e) {
      const outcome = e.focusStateReplaced
        ? '迁移后的存档已替换，但未能确认目录同步；旧存档原字节备份已保留，请停止并检查存储'
        : '未覆盖原文件';
      throw new Error(`无法读取专注存档，${outcome}：${e.message}`);
    }
  }
  write(state) {
    validateState(state);
    // Archive actual bytes before first testing access; earned state stays separate.
    if(state.testAccess?.enabled&&!this.testAccessBackedUp){
      let bytes;try{bytes=fs.readFileSync(this.file);}catch(e){if(e.code!=='ENOENT')throw e;}
      if(bytes&&!JSON.parse(bytes.toString('utf8')).testAccess?.enabled){
        const digest=createHash('sha256').update(bytes).digest('hex'),backup=path.join(this.dir,`focus-state.before-test-access-${digest}.json`);
        if(fs.existsSync(backup)){if(!fs.readFileSync(backup).equals(bytes))throw Error('体验前备份内容不一致；原存档未覆盖。');}
        else{const fd=fs.openSync(backup,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
        const dir=fs.openSync(this.dir,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
      }
      this.testAccessBackedUp=true;
    }
    const temporary = this.file + '.tmp';
    let fd, replaced = false;
    try {
      fd = fs.openSync(temporary, 'w', 0o600);
      fs.writeFileSync(fd, JSON.stringify(state, null, 2));
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      fs.renameSync(temporary, this.file);
      replaced = true;
      // Flush the rename too; directories may reject fsync on some platforms.
      const dirFd = fs.openSync(this.dir, 'r');
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch (error) {
      if (replaced) error.focusStateReplaced = true;
      throw error;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  close() {
    if (this.lockFd === undefined) return;
    fs.closeSync(this.lockFd); this.lockFd = undefined;
    fs.unlinkSync(this.lock);
  }
}
module.exports = { FileStore };
