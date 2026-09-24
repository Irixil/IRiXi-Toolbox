'use strict';

(() => {
  const api = window.notchAPI;
  const searchInput = document.getElementById('tools-search');
  const listElement = document.getElementById('tools-list');
  const countElement = document.getElementById('tools-count');
  const installSampleButton = document.getElementById('tools-install-sample');
  const detailEmpty = document.getElementById('tool-detail-empty');
  const detailContent = document.getElementById('tool-detail-content');
  const detailIcon = document.getElementById('tool-detail-icon');
  const detailMeta = document.getElementById('tool-detail-meta');
  const detailName = document.getElementById('tool-detail-name');
  const detailDescription = document.getElementById('tool-detail-description');
  const detailFacts = document.getElementById('tool-facts');
  const detailNotice = document.getElementById('tool-detail-notice');
  const openButton = document.getElementById('tool-open');
  const toggleButton = document.getElementById('tool-toggle');
  const uninstallButton = document.getElementById('tool-uninstall');
  const counter = document.getElementById('tool-counter');
  const counterTitle = document.getElementById('tool-counter-title');
  const counterValue = document.getElementById('tool-counter-value');
  const counterCopy = document.getElementById('tool-counter-copy');
  const counterActions = document.getElementById('tool-counter-actions');
  const nativeHelperPanel = document.getElementById('tool-native-helper');
  const nativeCapturePanel = document.getElementById('tool-native-capture');
  const nativeHelperSelection = document.getElementById('tool-native-helper-selection');
  const nativeHelperRetry = document.getElementById('tool-native-helper-retry');
  const nativeCaptureRetry = document.getElementById('tool-native-capture-retry');
  const installDialog = document.getElementById('tool-install-dialog');
  const installTitle = document.getElementById('tool-install-title');
  const installDescription = document.getElementById('tool-install-description');
  const installFacts = document.getElementById('tool-install-facts');
  const installError = document.getElementById('tool-install-error');
  const installConfirm = document.getElementById('tool-install-confirm');
  const uninstallDialog = document.getElementById('tool-uninstall-dialog');
  const uninstallError = document.getElementById('tool-uninstall-error');

  if (!listElement || !api?.listTools) return;

  const icons = {
    'builtin.todo': '✓',
    'builtin.notes': '✎',
    'builtin.recordings': '●',
    'builtin.pomodoro': '◷',
    'builtin.clip': '▣',
    'sample.counter': '＋',
  };
  const nativeHelperIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h10M9 3v3M6 10c2.2 3.5 5.2 5.7 9 7"/><path d="M13 10c-1.5 3.2-4.2 5.7-8 7M16 5h4M18 5v14M15.5 14h5"/></svg>';
  let tools = [];
  let selectedId = '';
  let loading = false;
  let uninstallId = '';

  function showDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  function capabilityLabel(capability) {
    if (capability === 'storage') return '只保存本工具内容';
    if (capability === 'local') return '使用已有本机功能';
    if (capability === 'native-module') return '由 IRiXi 主程序直接处理';
    return '未知能力';
  }

  function createFact(label, value) {
    const fragment = document.createDocumentFragment();
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value;
    fragment.append(term, description);
    return fragment;
  }

  function announce(message, tone = '') {
    if (!detailNotice) return;
    detailNotice.textContent = message;
    detailNotice.dataset.tone = tone;
  }

  function filteredTools() {
    const query = String(searchInput?.value || '').trim().toLocaleLowerCase('zh-CN');
    if (!query) return tools;
    return tools.filter((tool) => [tool.name, tool.description, tool.author]
      .some((value) => String(value || '').toLocaleLowerCase('zh-CN').includes(query)));
  }

  function toolStateLabel(tool) {
    if (tool.available === false) return '正在并入';
    if (tool.nativeAction) {
      if (tool.helperState === 'ready') return '已连接';
      if (tool.helperState === 'busy' || tool.helperState === 'starting') return '连接中';
      if (tool.helperState === 'unsupported_os') return '需要 macOS 15';
      if (['tampered', 'signature_invalid'].includes(tool.helperState)) return '安全检查未通过';
      if (tool.helperState === 'crashed' || tool.helperState === 'failed') return '需要重连';
      return '点击后连接';
    }
    if (tool.enabled) return '已启用';
    return tool.kind === 'installed' ? '已停用' : '已隐藏';
  }

  function renderList() {
    listElement.replaceChildren();
    listElement.setAttribute('aria-busy', String(loading));
    if (loading) {
      const loadingElement = document.createElement('div');
      loadingElement.className = 'tools-loading';
      loadingElement.innerHTML = '<i></i><span>正在整理工具…</span>';
      listElement.appendChild(loadingElement);
      return;
    }
    const visible = filteredTools();
    if (!visible.length) {
      const empty = document.createElement('div');
      empty.className = 'tools-empty';
      empty.innerHTML = '<strong>没有找到</strong><span>换个关键词，或清空搜索。</span>';
      listElement.appendChild(empty);
      return;
    }
    visible.forEach((tool) => {
      const row = document.createElement('article');
      row.className = `tool-row${selectedId === tool.id ? ' selected' : ''}`;
      row.dataset.toolId = tool.id;

      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'tool-row-main';
      select.setAttribute('aria-label', `查看${tool.name}`);

      const icon = document.createElement('span');
      icon.className = 'tool-row-icon';
      if (tool.nativeAction) icon.innerHTML = nativeHelperIcon;
      else icon.textContent = icons[tool.id] || '◇';
      icon.setAttribute('aria-hidden', 'true');

      const copy = document.createElement('span');
      copy.className = 'tool-row-copy';
      const name = document.createElement('strong');
      name.textContent = tool.name;
      const description = document.createElement('small');
      description.textContent = tool.description;
      copy.append(name, description);

      const state = document.createElement('span');
      state.className = 'tool-row-state';
      state.dataset.enabled = String(tool.enabled);
      state.textContent = toolStateLabel(tool);
      select.append(icon, copy, state);
      select.addEventListener('click', () => selectTool(tool.id));

      row.appendChild(select);
      if (tool.configurable || tool.kind === 'installed') {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'tool-row-toggle';
        toggle.setAttribute('role', 'switch');
        toggle.setAttribute('aria-checked', String(tool.enabled));
        toggle.setAttribute('aria-label', `${tool.enabled ? '停用' : '启用'}${tool.name}`);
        toggle.innerHTML = '<i aria-hidden="true"></i>';
        toggle.addEventListener('click', () => setEnabled(tool, !tool.enabled, toggle));
        row.appendChild(toggle);
      }
      listElement.appendChild(row);
    });
  }

  async function renderCounter(tool) {
    counter.hidden = true;
    counterActions.replaceChildren();
    if (tool.kind !== 'installed' || tool.ui?.type !== 'counter') return;
    counter.hidden = false;
    counterTitle.textContent = tool.ui.title;
    counterCopy.textContent = tool.ui.emptyText;
    counterValue.textContent = '—';
    if (!tool.enabled) {
      counterValue.textContent = '暂停';
      return;
    }
    const result = await api.getToolState(tool.id).catch(() => null);
    if (!result?.ok) {
      counterValue.textContent = '！';
      announce(result?.message || '暂时读不到这个工具的内容。', 'error');
      return;
    }
    counterValue.textContent = String(result.state.count);
    tool.actions.forEach((action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      button.dataset.actionId = action.id;
      if (action.operation === 'set') button.className = 'secondary';
      button.addEventListener('click', async () => {
        button.disabled = true;
        const actionResult = await api.runToolAction(tool.id, action.id).catch(() => null);
        button.disabled = false;
        if (!actionResult?.ok) {
          announce(actionResult?.message || '操作没有完成。', 'error');
          return;
        }
        counterValue.textContent = String(actionResult.state.count);
        announce('已保存', 'success');
      });
      counterActions.appendChild(button);
    });
  }

  function helperNotice(state, backend, isTranslation = false) {
    if (state === 'migration_pending') return { text: '这项功能正在并入 IRiXi 主程序，当前版本不会启动旧助手。', tone: '' };
    if (state === 'ready' && backend === 'module') return {
      text: isTranslation ? 'IRiXi 内置翻译和英文朗读已就绪。' : 'IRiXi 内置截图功能已就绪。',
      tone: 'success',
    };
    if (state === 'ready') return { text: '原生功能已连接，可以使用本机工具。', tone: 'success' };
    if (state === 'busy' || state === 'starting') return { text: '正在打开本机功能…', tone: '' };
    if (state === 'unsupported_os') return { text: '这些功能需要 macOS 15 或更高版本。', tone: 'error' };
    if (state === 'missing') return { text: '这份应用缺少内置原生模块。', tone: 'error' };
    if (state === 'tampered' || state === 'signature_invalid') {
      return { text: '内置原生模块的文件或签名检查没有通过，已阻止使用。', tone: 'error' };
    }
    if (state === 'crashed' || state === 'failed') return { text: '内置原生功能没有正常启动，请重新检查。', tone: 'error' };
    if (state === 'screen_recording_permission_required') return { text: '请允许“IRiXi的小工具库”录制屏幕，然后重新打开应用。', tone: 'error' };
    if (state === 'capture_failed') return { text: '区域截图没有开始，其他功能没有受到影响。', tone: 'error' };
    return { text: '当前功能不会启动第二个应用。', tone: '' };
  }

  function setNativeHelperBusy(busy) {
    [nativeHelperPanel, nativeCapturePanel].forEach((panel) => {
      panel?.querySelectorAll('button').forEach((button) => {
        button.disabled = button.dataset.migrationPending === 'true' || busy;
      });
    });
  }

  function updateNativeHelperPresentation(tool) {
    if (!tool) return;
    const notice = helperNotice(tool.helperState, tool.nativeBackend, tool.id === 'builtin.translation');
    announce(notice.text, notice.tone);
    if (selectedId === tool.id && detailFacts) {
      const currentStatus = detailFacts.querySelector('dd');
      if (currentStatus) currentStatus.textContent = toolStateLabel(tool);
    }
    [nativeHelperRetry, nativeCaptureRetry].forEach((button) => {
      if (button) button.hidden = !['crashed', 'failed'].includes(tool.helperState);
    });
  }

  async function refreshNativeHelperStatus() {
    if ((!nativeHelperPanel && !nativeCapturePanel) || !api?.getNativeModuleStatus) return;
    const moduleResult = await api.getNativeModuleStatus().catch(() => null);
    const nativeTools = tools.filter((candidate) => candidate.nativeAction);
    nativeTools.forEach((tool) => {
      const result = moduleResult;
      if (result?.ok && result.state) tool.helperState = result.state;
      else if (result?.error) tool.helperState = result.error;
      else tool.helperState = 'failed';
    });
    updateNativeHelperPresentation(nativeTools.find((tool) => tool.id === selectedId));
    renderList();
  }

  function renderNativeHelper(tool) {
    const isTranslation = tool?.id === 'builtin.translation';
    const isCapture = tool?.id === 'builtin.capture';
    if (nativeHelperPanel) nativeHelperPanel.hidden = !isTranslation;
    if (nativeCapturePanel) nativeCapturePanel.hidden = !isCapture;
    if (!isTranslation && !isCapture) return;
    updateNativeHelperPresentation(tool);
    refreshNativeHelperStatus();
  }

  function renderDetail(tool) {
    const hasTool = Boolean(tool);
    detailEmpty.hidden = hasTool;
    detailContent.hidden = !hasTool;
    if (!tool) {
      if (nativeHelperPanel) nativeHelperPanel.hidden = true;
      if (nativeCapturePanel) nativeCapturePanel.hidden = true;
      return;
    }
    if (tool.nativeAction) detailIcon.innerHTML = nativeHelperIcon;
    else detailIcon.textContent = icons[tool.id] || '◇';
    detailMeta.textContent = `${tool.kind === 'builtin' ? '内置工具' : '已安装工具'} · ${tool.author} · ${tool.version}`;
    detailName.textContent = tool.name;
    detailDescription.textContent = tool.description;
    detailFacts.replaceChildren();
    detailFacts.append(
      createFact('当前状态', toolStateLabel(tool)),
      createFact('使用能力', tool.capabilities.map(capabilityLabel).join('、')),
      createFact('联网', '不允许'),
      createFact('读取其他工具', '不允许')
    );
    announce(tool.enabled ? '这个工具可以正常使用。' : '这个工具已停用，不会在后台运行。');
    openButton.hidden = tool.kind === 'installed' || Boolean(tool.nativeAction);
    openButton.disabled = !tool.enabled;
    toggleButton.hidden = !(tool.configurable || tool.kind === 'installed');
    toggleButton.textContent = tool.enabled ? '停用' : '重新启用';
    uninstallButton.hidden = tool.kind !== 'installed';
    renderCounter(tool);
    renderNativeHelper(tool);
  }

  function selectTool(toolId) {
    selectedId = toolId;
    renderList();
    renderDetail(tools.find((tool) => tool.id === toolId));
  }

  async function loadTools(options = {}) {
    loading = true;
    renderList();
    const result = await api.listTools().catch(() => null);
    loading = false;
    if (!result?.ok) {
      tools = [];
      countElement.textContent = '读取失败';
      listElement.setAttribute('aria-busy', 'false');
      listElement.innerHTML = '<div class="tools-empty error"><strong>工具库暂时打不开</strong><span>原有工具没有被修改，请稍后重试。</span><button type="button">重试</button></div>';
      listElement.querySelector('button')?.addEventListener('click', () => loadTools());
      renderDetail(null);
      return;
    }
    tools = result.items || [];
    countElement.textContent = `${tools.length} 个`;
    installSampleButton.hidden = !result.sampleAvailable;
    if (options.selectId) selectedId = options.selectId;
    if (selectedId && !tools.some((tool) => tool.id === selectedId)) selectedId = '';
    renderList();
    renderDetail(selectedId ? tools.find((tool) => tool.id === selectedId) : null);
  }

  async function setEnabled(tool, enabled, control) {
    control.disabled = true;
    let result;
    if (tool.kind === 'builtin') {
      result = await api.setFeature(tool.featureId, enabled).catch(() => null);
    } else {
      result = await api.setToolEnabled(tool.id, enabled).catch(() => null);
    }
    control.disabled = false;
    if (!result?.ok) {
      announce(result?.message || '开关没有保存，原状态未改变。', 'error');
      return;
    }
    await loadTools({ selectId: tool.id });
    announce(enabled ? '已启用。' : '已停用，不会在后台运行。', 'success');
  }

  async function openInstallPreview() {
    installSampleButton.disabled = true;
    installTitle.textContent = '读取示例工具…';
    installDescription.textContent = '';
    installFacts.replaceChildren();
    installError.textContent = '';
    installConfirm.disabled = true;
    showDialog(installDialog);
    const result = await api.previewSampleTool().catch(() => null);
    installSampleButton.disabled = false;
    if (!result?.ok) {
      installTitle.textContent = '这个工具包不能安装';
      installError.textContent = result?.message || '工具包无法读取。';
      return;
    }
    const preview = result.preview;
    installTitle.textContent = preview.name;
    installDescription.textContent = preview.description;
    installFacts.append(
      createFact('作者与版本', `${preview.author} · ${preview.version}`),
      createFact('保存内容', preview.saves),
      createFact('联网', preview.network ? '会联网' : '不会联网'),
      createFact('控制电脑', preview.systemAccess ? '会请求' : '不允许')
    );
    installConfirm.disabled = false;
  }

  installSampleButton?.addEventListener('click', openInstallPreview);
  installConfirm?.addEventListener('click', async () => {
    installConfirm.disabled = true;
    installError.textContent = '';
    const result = await api.installSampleTool().catch(() => null);
    if (!result?.ok) {
      installConfirm.disabled = false;
      installError.textContent = result?.message || '安装没有完成。';
      return;
    }
    closeDialog(installDialog);
    await loadTools({ selectId: result.tool.id });
    announce('示例工具已安装，可以直接使用。', 'success');
  });

  openButton?.addEventListener('click', () => {
    const tool = tools.find((candidate) => candidate.id === selectedId);
    if (tool?.tab && tool.enabled) window.irixiOpenToolTab?.(tool.tab);
  });

  toggleButton?.addEventListener('click', () => {
    const tool = tools.find((candidate) => candidate.id === selectedId);
    if (tool) setEnabled(tool, !tool.enabled, toggleButton);
  });

  uninstallButton?.addEventListener('click', () => {
    const tool = tools.find((candidate) => candidate.id === selectedId && candidate.kind === 'installed');
    if (!tool) return;
    uninstallId = tool.id;
    uninstallError.textContent = '';
    showDialog(uninstallDialog);
  });

  uninstallDialog?.querySelectorAll('[data-uninstall-keep]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      uninstallError.textContent = '';
      const keepData = button.dataset.uninstallKeep === 'true';
      const result = await api.uninstallTool(uninstallId, keepData).catch(() => null);
      button.disabled = false;
      if (!result?.ok) {
        uninstallError.textContent = result?.message || '卸载没有完成。';
        return;
      }
      selectedId = '';
      uninstallId = '';
      closeDialog(uninstallDialog);
      await loadTools();
    });
  });

  nativeCaptureRetry?.addEventListener('click', refreshNativeHelperStatus);

  document.querySelectorAll('[data-helper-partner]').forEach((button) => {
    button.addEventListener('click', async () => {
      setNativeHelperBusy(true);
      announce('正在打开输入翻译…');
      const result = await api.openNativeInputTranslation(button.dataset.helperPartner).catch(() => null);
      const tool = tools.find((candidate) => candidate.id === 'builtin.translation');
      if (tool) tool.helperState = result?.ok ? 'ready' : (result?.error || 'failed');
      if (result?.ok) announce('输入翻译已打开，可直接粘贴或输入文字。', 'success');
      else updateNativeHelperPresentation(tool);
      setNativeHelperBusy(false);
      renderList();
    });
  });

  nativeHelperSelection?.addEventListener('click', async () => {
    setNativeHelperBusy(true);
    announce('正在读取你在其他应用中选中的文字…');
    const result = await api.startNativeSelectionTranslation().catch(() => null);
    const tool = tools.find((candidate) => candidate.id === 'builtin.translation');
    if (tool) tool.helperState = result?.ok ? 'ready' : (result?.error || 'failed');
    if (result?.ok) announce('划译已启动。默认快捷键是 ⌃⌥Y。', 'success');
    else updateNativeHelperPresentation(tool);
    setNativeHelperBusy(false);
    renderList();
  });

  const captureActions = [
    ['tool-capture-area', 'startNativeAreaCapture', '正在打开区域截图…'],
    ['tool-capture-window', 'startNativeWindowCapture', '正在打开窗口截图…'],
    ['tool-capture-fullscreen', 'startNativeFullscreenCapture', '正在打开全屏截图…'],
    ['tool-capture-ocr', 'startNativeOCRCapture', '正在打开识字截图…'],
    ['tool-capture-translate', 'startNativeImageTranslationCapture', '正在打开图片翻译…'],
  ];
  captureActions.forEach(([buttonId, method, progress]) => {
    document.getElementById(buttonId)?.addEventListener('click', async () => {
      setNativeHelperBusy(true);
      announce(progress);
      await window.irixiCollapsePanel?.();
      const result = await api[method]().catch(() => null);
      const tool = tools.find((candidate) => candidate.id === 'builtin.capture');
      if (tool) tool.helperState = result?.ok ? 'ready' : (result?.error || 'failed');
      if (result?.ok) {
        announce('请拖动选择区域，再复制或保存。', 'success');
      }
      else updateNativeHelperPresentation(tool);
      setNativeHelperBusy(false);
      renderList();
    });
  });

  searchInput?.addEventListener('input', renderList);
  api.onAppSettingsChanged?.(() => loadTools({ selectId: selectedId }));
  loadTools();
})();
