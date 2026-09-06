'use strict';

(function bootstrapAgentPanel() {
  const api = window.notchAPI;
  if (!api || !document.getElementById('tab-agent')) return;

  const $ = (id) => document.getElementById(id);
  const elements = {
    service: $('agent-service-state'),
    empty: $('agent-empty-state'),
    task: $('agent-task-state'),
    offline: $('agent-offline-state'),
    offlineCopy: $('agent-offline-copy'),
    workspace: $('agent-workspace-path'),
    chooseWorkspace: $('agent-workspace-choose'),
    goal: $('agent-goal'),
    start: $('agent-start-button'),
    retry: $('agent-retry-button'),
    refresh: $('agent-refresh-button'),
    status: $('agent-task-status'),
    taskGoal: $('agent-task-goal'),
    taskWorkspace: $('agent-task-workspace'),
    conversation: $('agent-conversation'),
    handoff: $('agent-handoff'),
    handoffVersion: $('agent-handoff-version'),
    handoffDetails: $('agent-handoff-details'),
    result: $('agent-result'),
    resultState: $('agent-result-state'),
    resultSummary: $('agent-result-summary'),
    resultEvidence: $('agent-result-evidence'),
    replyForm: $('agent-reply-form'),
    replyInput: $('agent-reply-input'),
    confirm: $('agent-confirm-button'),
    cancel: $('agent-cancel-button'),
    accept: $('agent-accept-button'),
    continue: $('agent-continue-button'),
    rollback: $('agent-rollback-button'),
    end: $('agent-end-button'),
    notice: $('agent-inline-notice'),
    remote: $('agent-remote-button'),
    reminderBanner: $('agent-reminder-banner'),
    reminderEnabled: $('agent-reminder-enabled'),
    endTime: $('agent-end-time'),
    leadMinutes: $('agent-lead-minutes'),
    reminderNext: $('agent-reminder-next'),
    reminderSave: $('agent-reminder-save'),
    reminderSnooze: $('agent-reminder-snooze'),
    reminderSkip: $('agent-reminder-skip'),
  };

  const terminalStates = new Set(['succeeded', 'completed', 'partial', 'failed', 'cancelled']);
  const statusCopy = {
    clarifying: '正在和你对齐',
    awaiting_confirmation: '等你核对交接单',
    awaiting_confirm: '等你核对交接单',
    queued: '已经排好，准备开始',
    running: 'Agent 正在继续',
    waiting_user: '停下来等你回复',
    resuming: '收到回复，正在继续',
    stopping: '正在安全停止',
    succeeded: '已经完成，可以验收',
    completed: '已经完成，可以验收',
    partial: '只完成了一部分',
    failed: '遇到问题，已经停下',
    cancelled: '任务已经停止',
  };
  const handoffLabels = {
    goal: '最终目标',
    deliverable: '要交付什么',
    workspacePath: '唯一工作区',
    requestedActions: '准备怎么做',
    allowedActions: '允许的操作',
    completionCriteria: '怎样才算完成',
    deadline: '最晚做到',
    forbiddenActions: '不能做的事',
    limits: '执行上限',
    stopWhen: '遇到什么必须停',
  };

  let currentTask = null;
  let pollTimer = 0;
  let noticeTimer = 0;
  let busy = false;
  let lastSignal = '';
  let lastRenderKey = '';
  let panelExpanded = document.getElementById('app')?.classList.contains('expanded') || false;
  let agentTabActive = document.getElementById('tab-agent')?.classList.contains('active') || false;

  function workspaceName(value) {
    return String(value || '').split(/[\\/]/).filter(Boolean).at(-1) || '当前工作区';
  }

  function errorText(error, fallback = '操作没有完成，请重试。') {
    const text = String(error && error.message || '').replace(/^Error invoking remote method '[^']+':\s*/i, '').trim();
    return text || fallback;
  }

  function showNotice(text, tone = 'info') {
    window.clearTimeout(noticeTimer);
    elements.notice.textContent = text;
    elements.notice.dataset.tone = tone;
    elements.notice.hidden = false;
    if (tone !== 'error') {
      noticeTimer = window.setTimeout(() => { elements.notice.hidden = true; }, 4200);
    }
  }

  function setServiceState(state, detail = '') {
    const raw = String(state || 'stopped');
    const key = raw === 'running' ? 'ready' : raw === 'failed' ? 'error' : raw;
    const copy = {
      ready: 'Agent 已就绪',
      starting: '正在启动 Agent',
      stopped: 'Agent 未启动',
      error: 'Agent 需要处理',
    }[key] || '正在读取 Agent 状态';
    elements.service.dataset.state = key;
    elements.service.querySelector('span').textContent = detail || copy;
  }

  function showView(name) {
    elements.empty.hidden = name !== 'empty';
    elements.task.hidden = name !== 'task';
    elements.offline.hidden = name !== 'offline';
  }

  function setBusy(value) {
    busy = value;
    elements.task.setAttribute('aria-busy', String(value));
    document.querySelectorAll('#tab-agent button, #tab-agent textarea, #tab-agent input, #tab-agent select')
      .forEach((control) => {
        if (control.id === 'agent-reminder-enabled') return;
        control.disabled = value;
      });
    if (!value && currentTask) renderActions(currentTask, String(currentTask.status || ''));
  }

  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function renderMessages(messages) {
    const previousTop = elements.conversation.scrollTop;
    const wasNearBottom = elements.conversation.scrollHeight - previousTop - elements.conversation.clientHeight < 28;
    elements.conversation.replaceChildren();
    if (!messages.length) {
      const empty = document.createElement('p');
      empty.className = 'agent-conversation-empty';
      empty.textContent = 'Agent 的问题和你的回复会出现在这里。';
      elements.conversation.append(empty);
      return;
    }
    messages.forEach((message) => {
      const article = document.createElement('article');
      const role = message.role === 'user' ? 'user' : message.role === 'system' ? 'system' : 'agent';
      article.dataset.role = role;
      const meta = document.createElement('div');
      const author = document.createElement('span');
      author.textContent = role === 'user' ? '你' : role === 'system' ? '任务记录' : 'Agent';
      meta.append(author);
      if (message.createdAt) {
        const time = document.createElement('time');
        time.textContent = formatTime(message.createdAt);
        meta.append(time);
      }
      const copy = document.createElement('p');
      copy.textContent = String(message.text || '');
      article.append(meta, copy);
      elements.conversation.append(article);
    });
    elements.conversation.scrollTop = wasNearBottom
      ? elements.conversation.scrollHeight
      : Math.min(previousTop, elements.conversation.scrollHeight);
  }

  function valueText(value, key = '') {
    if (key === 'limits' && value && typeof value === 'object') {
      const minutes = Number(value.maxMinutes) || 0;
      const events = Number(value.maxEvents) || 0;
      const retries = Number(value.retriesPerStep) || 0;
      return `${minutes} 分钟；最多 ${events} 个步骤；每步最多重试 ${retries} 次`;
    }
    if (Array.isArray(value)) return value.map((item) => valueText(item)).filter(Boolean).join('、');
    if (value && typeof value === 'object') return Object.values(value).map((item) => valueText(item)).filter(Boolean).join('；');
    return value == null ? '' : String(value);
  }

  function renderHandoff(task) {
    const card = task.handoffCard;
    elements.handoff.hidden = !card;
    elements.handoffDetails.replaceChildren();
    if (!card) return;
    elements.handoffVersion.textContent = `第 ${Number(task.instructionVersion || 1)} 版`;
    Object.entries(handoffLabels).forEach(([key, label]) => {
      const text = valueText(card[key], key);
      if (!text) return;
      const term = document.createElement('dt');
      term.textContent = label;
      const description = document.createElement('dd');
      description.textContent = text;
      elements.handoffDetails.append(term, description);
    });
  }

  function renderResult(task, status) {
    const visible = terminalStates.has(status);
    elements.result.hidden = !visible;
    elements.resultEvidence.replaceChildren();
    if (!visible) return;
    elements.resultState.textContent = statusCopy[status] || '等待验收';
    const result = task.result || {};
    elements.resultSummary.textContent = String(result.summary || task.error || '查看下面的改动和检查记录。');
    const rows = [];
    if (result.stopReason) rows.push({ tone: 'reason', title: '停止原因', detail: String(result.stopReason) });
    if (Array.isArray(result.unresolved)) {
      rows.push(...result.unresolved.map((item) => ({ tone: 'warning', title: '还需确认', detail: String(item) })));
    }
    if (Array.isArray(task.changes)) {
      rows.push(...task.changes.map((change) => ({
        tone: 'change',
        title: change.kind === 'created' ? '新建文件' : change.kind === 'modified' ? '修改文件' : '文件改动',
        detail: String(change.path || '未命名文件'),
      })));
    }
    if (Array.isArray(task.checks)) {
      rows.push(...task.checks.map((check) => ({
        tone: check.passed ? 'passed' : 'failed',
        title: `${check.passed ? '检查通过' : '检查未通过'} · ${check.name || '未命名检查'}`,
        detail: String(check.evidence || '没有提供更多证据'),
      })));
    }
    rows.forEach(({ tone, title, detail }) => {
      const row = document.createElement('div');
      row.dataset.tone = tone;
      const heading = document.createElement('strong');
      heading.textContent = title;
      const copy = document.createElement('span');
      copy.textContent = detail;
      row.append(heading, copy);
      elements.resultEvidence.append(row);
    });
  }

  function renderActions(task, status) {
    const terminal = terminalStates.has(status);
    const confirm = status === 'awaiting_confirmation' || status === 'awaiting_confirm';
    elements.confirm.hidden = !confirm;
    elements.cancel.hidden = terminal;
    elements.accept.hidden = !(terminal && ['succeeded', 'completed', 'partial'].includes(status));
    elements.accept.disabled = Boolean(task.acceptedAt);
    elements.accept.textContent = task.acceptedAt ? '已接受' : '接受结果';
    elements.continue.hidden = !terminal;
    elements.end.hidden = !terminal;
    elements.rollback.hidden = !(terminal && Array.isArray(task.changes) && task.changes.length && !task.rolledBackAt);
    elements.replyForm.hidden = !(status === 'clarifying' || status === 'waiting_user');
  }

  function renderTask(task) {
    if (!task) {
      currentTask = null;
      lastRenderKey = '';
      showView('empty');
      return;
    }
    const renderKey = `${task.id}:${Number(task.seq || 0)}:${task.status || ''}:${task.updatedAt || ''}`;
    currentTask = task;
    showView('task');
    if (renderKey === lastRenderKey) return;
    lastRenderKey = renderKey;
    const status = String(task.status || 'clarifying');
    elements.status.textContent = statusCopy[status] || '状态更新中';
    elements.status.dataset.state = status;
    elements.taskGoal.textContent = task.goal || '还没有写明任务目标';
    elements.taskWorkspace.textContent = workspaceName(task.workspacePath);
    renderMessages(Array.isArray(task.messages) ? task.messages : []);
    renderHandoff(task);
    renderResult(task, status);
    renderActions(task, status);

    const signal = `${task.id}:${Number(task.seq || 0)}:${status}`;
    if (signal !== lastSignal && ['waiting_user', 'succeeded', 'partial', 'failed', 'cancelled'].includes(status)) {
      lastSignal = signal;
      api.signalAgentState({ id: task.id, seq: task.seq, status, workspaceName: workspaceName(task.workspacePath) }).catch(() => {});
    }
  }

  function clearPoll() {
    window.clearTimeout(pollTimer);
    pollTimer = 0;
  }

  function shouldPoll() {
    return panelExpanded && agentTabActive;
  }

  function schedulePoll() {
    clearPoll();
    if (!shouldPoll()) return;
    pollTimer = window.setTimeout(loadCurrent, 1800);
  }

  async function loadCurrent() {
    clearPoll();
    if (busy) {
      schedulePoll();
      return;
    }
    try {
      const data = await api.agentCurrent();
      setServiceState('ready');
      renderTask(data && data.task || null);
      schedulePoll();
    } catch (error) {
      setServiceState('error');
      showView('offline');
      elements.offlineCopy.textContent = errorText(error, '本机 Agent 服务没有响应。请手动重试。');
      window.clearTimeout(pollTimer);
    }
  }

  async function runAction(method, payload, successCopy) {
    if (busy) return false;
    setBusy(true);
    try {
      const data = await api[method](payload);
      renderTask(data && data.task || null);
      if (successCopy) showNotice(successCopy, 'success');
      return true;
    } catch (error) {
      showNotice(errorText(error), 'error');
      return false;
    } finally {
      setBusy(false);
      schedulePoll();
    }
  }

  function renderReminder(reminder) {
    if (!reminder) return;
    elements.reminderEnabled.checked = reminder.enabled !== false;
    elements.endTime.value = reminder.endTime || '18:00';
    elements.leadMinutes.value = String(reminder.leadMinutes || 15);
    if (reminder.enabled === false) {
      elements.reminderNext.textContent = '提醒已关闭';
    } else if (reminder.nextAt) {
      const next = new Date(reminder.nextAt);
      const today = next.toDateString() === new Date().toDateString();
      elements.reminderNext.textContent = `${today ? '今天' : '下次'} ${formatTime(next)} 提醒`;
    } else {
      elements.reminderNext.textContent = '保存后开始提醒';
    }
  }

  async function initialize() {
    try {
      const status = await api.agentStatus();
      const service = status && status.service || {};
      setServiceState(service.state || service.status || 'starting');
      renderReminder(status && status.reminder);
    } catch (error) {
      setServiceState('error');
    }
    await loadCurrent();
  }

  elements.chooseWorkspace.addEventListener('click', async () => {
    const result = await api.chooseAgentWorkspace().catch((error) => ({ error }));
    if (result && result.path) {
      elements.workspace.value = result.path;
    } else if (result && result.error) {
      showNotice(errorText(result.error), 'error');
    }
  });

  elements.start.addEventListener('click', async () => {
    const workspacePath = elements.workspace.value.trim();
    const goal = elements.goal.value.trim();
    if (!workspacePath) return showNotice('先选择 Agent 可以处理的文件夹。', 'error');
    if (!goal) return showNotice('先写清楚你希望 Agent 继续做什么。', 'error');
    await runAction('agentCreate', { workspacePath, goal }, '交接已开始，先回答 Agent 的问题。');
  });

  elements.replyForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = elements.replyInput.value.trim();
    if (!currentTask || !text) return;
    const sent = await runAction('agentMessage', {
      id: currentTask.id,
      messageId: window.crypto.randomUUID(),
      text,
    });
    if (sent) elements.replyInput.value = '';
  });

  elements.confirm.addEventListener('click', () => currentTask && runAction('agentConfirm', {
    id: currentTask.id,
    expectedVersion: currentTask.instructionVersion,
  }, 'Agent 已开始执行。'));
  elements.cancel.addEventListener('click', () => {
    if (!currentTask || !window.confirm('确定停止这项任务吗？Agent 会保留已经产生的可核对结果。')) return;
    runAction('agentCancel', { id: currentTask.id }, '任务已安全停止。');
  });
  elements.accept.addEventListener('click', () => currentTask && runAction('agentAccept', { id: currentTask.id }, '结果已接受。'));
  elements.continue.addEventListener('click', () => currentTask && runAction('agentContinue', { id: currentTask.id }, '告诉 Agent 还需要怎么改。'));
  elements.rollback.addEventListener('click', () => {
    if (!currentTask || !window.confirm('撤回会恢复被修改的文件，并删除本轮新建的文件。确定继续吗？')) return;
    runAction('agentRollback', { id: currentTask.id }, '已撤回 Agent 本轮改动。');
  });
  elements.end.addEventListener('click', async () => {
    if (!currentTask) return;
    const ended = await runAction('agentEnd', { id: currentTask.id });
    if (ended) document.dispatchEvent(new CustomEvent('notch:collapse-request'));
  });
  elements.refresh.addEventListener('click', loadCurrent);

  elements.retry.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    setServiceState('starting');
    try {
      await api.agentRestart();
      showNotice('Agent 服务已重新启动。', 'success');
      setBusy(false);
      await loadCurrent();
      return;
    } catch (error) {
      showView('offline');
      elements.offlineCopy.textContent = errorText(error, '重新启动失败，请检查 Codex。');
      setServiceState('error');
    } finally {
      setBusy(false);
    }
  });

  elements.remote.addEventListener('click', async () => {
    const opened = await api.openAgentRemoteSettings().catch(() => false);
    showNotice(opened ? '已打开 Codex 远程连接设置。' : '没有找到 Codex 远程连接设置。', opened ? 'success' : 'error');
  });

  elements.reminderSave.addEventListener('click', async () => {
    const result = await api.setAgentReminder({
      enabled: elements.reminderEnabled.checked,
      endTime: elements.endTime.value,
      leadMinutes: Number(elements.leadMinutes.value),
    }).catch((error) => ({ error }));
    if (result && result.reminder) {
      renderReminder(result.reminder);
      showNotice('下班提醒已保存。', 'success');
    } else {
      showNotice(errorText(result && result.error), 'error');
    }
  });
  elements.reminderSnooze.addEventListener('click', async () => {
    const result = await api.snoozeAgentReminder(15).catch((error) => ({ error }));
    if (result && result.ok && result.reminder) {
      renderReminder(result.reminder);
      elements.reminderBanner.hidden = true;
      showNotice('15 分钟后再提醒。', 'success');
    } else {
      showNotice(errorText(result && result.error, '稍后提醒保存失败，请重试。'), 'error');
    }
  });
  elements.reminderSkip.addEventListener('click', async () => {
    const result = await api.skipAgentReminderToday().catch((error) => ({ error }));
    if (result && result.ok && result.reminder) {
      renderReminder(result.reminder);
      elements.reminderBanner.hidden = true;
      showNotice('今天不再提醒。', 'success');
    } else {
      showNotice(errorText(result && result.error, '跳过提醒保存失败，请重试。'), 'error');
    }
  });

  api.onAgentReminder?.(() => { elements.reminderBanner.hidden = false; });
  api.onAgentReminderChanged?.(renderReminder);
  document.addEventListener('notch:tabchange', (event) => {
    agentTabActive = event.detail && event.detail.tab === 'agent';
    if (shouldPoll()) loadCurrent();
    else clearPoll();
  });
  document.addEventListener('notch:modechange', (event) => {
    panelExpanded = Boolean(event.detail && event.detail.expanded);
    if (shouldPoll()) loadCurrent();
    else clearPoll();
  });
  window.addEventListener('beforeunload', clearPoll);

  initialize();
})();
