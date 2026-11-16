const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('favorites and readable content survive overflow, clear, and two Electron process restarts', { timeout: 90000 }, t => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'irixi-clipboard-retention-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const processes = new Set();
  for (const phase of ['overflow', 'clear', 'reopen']) {
    const result = spawnSync(require('electron'), [path.join(__dirname, 'clipboard-restart.electron.js'), profile, phase], {
      env, encoding: 'utf8', timeout: 25000,
    });
    assert.equal(result.status, 0, `${phase}: ${result.error || ''}\n${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(result.stdout.trim().split('\n').find(line => line.startsWith('{"phase":')));
    assert.equal(report.passed, true);
    processes.add(report.processId);
    t.diagnostic(JSON.stringify(report));
  }
  assert.equal(processes.size, 3, 'Each phase must start a fresh Electron process');
});
