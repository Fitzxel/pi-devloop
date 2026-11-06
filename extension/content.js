(() => {
  if (window.__piDevloopActive) return;
  window.__piDevloopActive = true;

  const host = document.createElement('div');
  host.dataset.piDevloopHost = 'true';
  Object.assign(host.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    pointerEvents: 'none',
  });
  (document.documentElement || document).append(host);

  const ui = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host {
      all: initial;
      color-scheme: light dark;
      --ink: #2b2115;
      --muted: #735c3e;
      --surface: #fffaf0;
      --surface-soft: #fff0cf;
      --line: #e4d1ae;
      --field-line: #ad8753;
      --accent: #9a4d00;
      --accent-hover: #7c3900;
      --accent-ink: #fffaf2;
      --focus: #8a4600;
      --focus-halo: rgb(180 83 9 / 24%);
      --marker-fill: rgb(217 119 6 / 12%);
      --marker-keyline-light: #fffaf0;
      --marker-keyline-dark: #24180d;
      --danger: #a5271c;
      --success: #168052;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    *, *::before, *::after { box-sizing: border-box; }
    .toast, .panel {
      position: fixed;
      right: 20px;
      pointer-events: auto;
      color: var(--ink);
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 14px;
      box-shadow: 0 18px 50px rgb(20 33 57 / 18%);
      font-size: 14px;
      line-height: 1.5;
    }

    .toast {
      top: 20px;
      max-width: min(360px, calc(100vw - 32px));
      padding: 12px 16px;
      animation: arrive 180ms ease-out both;
    }

    .target-toolbar, .global-toolbar {
      position: fixed;
      left: 50%;
      display: none;
      align-items: center;
      flex-direction: row;
      gap: 8px;
      width: min(720px, calc(100vw - 24px));
      min-height: 56px;
      padding: 8px 10px;
      transform: translateX(-50%);
      color: var(--ink);
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 11px;
      box-shadow: 0 8px 24px rgb(36 24 13 / 20%);
      font-size: 12px;
      line-height: 1.3;
      pointer-events: auto;
      overflow: visible;
    }
    .target-toolbar { left: 0; top: 0; bottom: auto; transform: none; z-index: 4; }
    .global-toolbar { bottom: 16px; z-index: 5; }

    .target-toolbar-header { display: flex; flex: 0 1 320px; min-width: 0; align-items: center; justify-content: space-between; gap: 8px; }
    .target-toolbar-title { flex: 1 1 auto; min-width: 0; overflow: hidden; color: var(--ink); font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
    .toolbar-arrows { display: flex; flex: 0 0 auto; gap: 4px; }
    .toolbar-button { display: grid; width: 30px; min-height: 30px; place-items: center; padding: 0; color: var(--ink); background: var(--surface-soft); }
    .toolbar-button svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .selection-label { position: fixed; z-index: 3; max-width: min(260px, calc(100vw - 16px)); overflow: hidden; min-height: 0; padding: 4px 8px; border-radius: 5px; color: var(--accent-ink); background: var(--accent); font: 600 11px/1.3 ui-sans-serif, system-ui, sans-serif; text-overflow: ellipsis; white-space: nowrap; pointer-events: auto; }
    .selection-label:hover { background: var(--accent-hover); }
    .selection-label[data-active="true"] { box-shadow: 0 0 0 2px var(--surface); }
    .target-toolbar .label, .global-toolbar .label { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    .global-toolbar-header { display: flex; flex: 0 0 176px; min-width: 0; flex-direction: column; align-items: flex-start; justify-content: center; gap: 2px; }
    .global-toolbar-header .target-toolbar-title { max-width: 100%; }
    .global-toolbar-count { color: var(--muted); font-size: 11px; }

    .toolbar-composer {
      display: block;
      flex: 1 1 auto;
      width: auto;
      min-width: 0;
      height: 36px;
      min-height: 36px;
      max-height: 36px;
      padding: 8px 10px;
      resize: none;
      overflow: hidden;
      border-radius: 8px;
    }
    .target-toolbar .actions, .global-toolbar .actions { flex: 0 0 auto; gap: 6px; margin: 0; }
    .toolbar-submit { min-width: 56px; min-height: 32px; padding: 6px 10px; border-radius: 7px; font-size: 12px; line-height: 1.2; }
    .target-toolbar .submit-status, .global-toolbar .submit-status { flex: 0 1 auto; min-width: 0; max-width: 160px; overflow: hidden; margin: 0; text-overflow: ellipsis; white-space: nowrap; }

    @media (max-width: 540px) {
      .target-toolbar, .global-toolbar { flex-wrap: wrap; gap: 6px; padding: 8px; }
      .target-toolbar-header, .global-toolbar-header { flex: 1 1 100%; }
      .global-toolbar-header { flex-direction: row; align-items: center; justify-content: space-between; }
      .target-toolbar-title { max-width: none; }
      .target-toolbar .submit-status, .global-toolbar .submit-status { flex: 1 1 100%; max-width: none; white-space: normal; }
    }

    @media (max-height: 520px) {
      .toolbar-composer { height: 32px; min-height: 32px; max-height: 32px; }
    }

    .success-notice { border-color: var(--success); }
    .error-notice { border-color: var(--danger); }
    .feedback-notice { top: 68px; }

    .panel {
      right: 20px;
      bottom: 20px;
      width: min(380px, calc(100vw - 32px));
      padding: 20px;
      animation: arrive 180ms ease-out both;
    }

    .title {
      margin: 0 0 6px;
      font-size: 18px;
      line-height: 1.25;
      font-weight: 650;
      letter-spacing: -0.02em;
    }

    .hint { margin: 0 0 16px; color: var(--muted); }
    .target { margin: 0 0 14px; color: var(--muted); font-size: 12px; }
    .target code { color: var(--ink); font: 600 12px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace; }
    .label { display: block; margin-bottom: 7px; font-size: 13px; font-weight: 650; }

    textarea {
      display: block;
      width: 100%;
      min-height: 112px;
      resize: vertical;
      border: 1px solid var(--field-line);
      border-radius: 9px;
      padding: 11px 12px;
      color: var(--ink);
      background: var(--surface);
      font: inherit;
      outline: none;
    }

    textarea::placeholder { color: var(--muted); opacity: 1; }
    textarea:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 3px var(--focus-halo); }
    .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
    .submit-status { margin: 10px 0 0; color: var(--muted); font-size: 12px; }
    .submit-status:empty { display: none; }

    button {
      min-height: 38px;
      border: 0;
      border-radius: 8px;
      padding: 9px 13px;
      font: 600 13px/1.25 ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
    }

    button:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
    button:disabled { opacity: .62; cursor: wait; }
    .cancel { color: var(--muted); background: var(--surface-soft); }
    .submit { color: var(--accent-ink); background: var(--accent); }
    .submit:hover { background: var(--accent-hover); }
    .error { margin: 12px 0 0; color: var(--danger); }
    .marker { position: fixed; z-index: 3; pointer-events: none; border: 2px solid var(--accent); background: var(--marker-fill); box-shadow: 0 0 0 1px var(--marker-keyline-light), 0 0 0 3px var(--marker-keyline-dark); display: none; }
    .marker[data-active="true"] { border-color: var(--accent-hover); }
    .hover-marker { position: fixed; z-index: 2; display: none; pointer-events: none; border: 1px dashed var(--accent-hover); background: var(--marker-fill); box-shadow: 0 0 0 1px var(--marker-keyline-light), 0 0 0 3px var(--marker-keyline-dark); }

    @media (prefers-color-scheme: dark) {
      :host {
        --ink: #fff3e0;
        --muted: #dcc29c;
        --surface: #24180d;
        --surface-soft: #382716;
        --line: #5b4328;
        --field-line: #86663d;
        --accent: #f59e0b;
        --accent-hover: #fbbf24;
        --accent-ink: #291805;
        --focus: #fbbf24;
        --focus-halo: rgb(251 191 36 / 25%);
        --marker-fill: rgb(251 191 36 / 14%);
        --danger: #ff9b91;
        --success: #68d6a1;
      }
      .cancel { color: var(--ink); }
    }

    @keyframes arrive { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
    @media (prefers-reduced-motion: reduce) { .toast, .panel { animation: none; } }
  `;
  ui.append(style);

  const selectionToolbar = document.createElement('form');
  selectionToolbar.className = 'target-toolbar';
  selectionToolbar.setAttribute('aria-label', 'Element instruction');
  const toolbarHeader = document.createElement('div');
  toolbarHeader.className = 'target-toolbar-header';
  const toolbarTitle = document.createElement('span');
  toolbarTitle.className = 'target-toolbar-title';
  toolbarHeader.append(toolbarTitle);
  const toolbarArrows = document.createElement('div');
  toolbarArrows.className = 'toolbar-arrows';
  const parentButton = document.createElement('button');
  parentButton.className = 'toolbar-button';
  parentButton.type = 'button';
  parentButton.dataset.parent = 'true';
  parentButton.setAttribute('aria-label', 'Select parent element');
  parentButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>';
  parentButton.disabled = true;
  const childButton = document.createElement('button');
  childButton.className = 'toolbar-button';
  childButton.type = 'button';
  childButton.dataset.child = 'true';
  childButton.setAttribute('aria-label', 'Select first visible child element');
  childButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  childButton.disabled = true;
  toolbarArrows.append(parentButton);
  toolbarArrows.append(childButton);
  const removeTargetButton = document.createElement('button');
  removeTargetButton.className = 'toolbar-button remove-target-button';
  removeTargetButton.type = 'button';
  removeTargetButton.dataset.removeTarget = 'true';
  removeTargetButton.setAttribute('aria-label', 'Remove active element from selection');
  removeTargetButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 11v5m4-5v5"/></svg>';
  removeTargetButton.disabled = true;
  toolbarArrows.append(removeTargetButton);
  toolbarHeader.append(toolbarArrows);
  const targetInstructionLabel = document.createElement('label');
  targetInstructionLabel.className = 'label';
  targetInstructionLabel.textContent = 'Instruction for this element';
  const targetInstruction = document.createElement('textarea');
  targetInstruction.className = 'toolbar-composer';
  targetInstruction.maxLength = 4000;
  targetInstruction.setAttribute('maxlength', '4000');
  targetInstruction.placeholder = 'What should change for this element?';
  targetInstructionLabel.htmlFor = 'target-instruction';
  targetInstruction.id = 'target-instruction';
  const targetActions = document.createElement('div');
  targetActions.className = 'actions';
  const targetSend = document.createElement('button');
  targetSend.className = 'submit toolbar-submit';
  targetSend.type = 'submit';
  targetSend.dataset.send = 'true';
  targetSend.textContent = 'Send';
  targetSend.disabled = true;
  targetActions.append(targetSend);
  const targetStatus = document.createElement('p');
  targetStatus.className = 'submit-status';
  targetStatus.setAttribute('role', 'status');
  targetStatus.setAttribute('aria-live', 'polite');
  selectionToolbar.append(toolbarHeader);
  selectionToolbar.append(targetInstructionLabel);
  selectionToolbar.append(targetInstruction);
  selectionToolbar.append(targetActions);
  selectionToolbar.append(targetStatus);

  const globalToolbar = document.createElement('form');
  globalToolbar.className = 'global-toolbar';
  globalToolbar.setAttribute('aria-label', 'Global feedback instructions');
  const globalHeader = document.createElement('div');
  globalHeader.className = 'global-toolbar-header';
  const globalTitle = document.createElement('span');
  globalTitle.className = 'target-toolbar-title';
  globalTitle.textContent = 'Instructions for all selected elements';
  const selectionCount = document.createElement('span');
  selectionCount.className = 'global-toolbar-count';
  globalHeader.append(globalTitle);
  globalHeader.append(selectionCount);
  const globalInstructionLabel = document.createElement('label');
  globalInstructionLabel.className = 'label';
  globalInstructionLabel.textContent = 'Global instruction';
  const globalInstructionInput = document.createElement('textarea');
  globalInstructionInput.className = 'toolbar-composer';
  globalInstructionInput.id = 'global-instruction';
  globalInstructionInput.maxLength = 4000;
  globalInstructionInput.setAttribute('maxlength', '4000');
  globalInstructionInput.placeholder = 'Use element numbers to describe changes across the selection.';
  globalInstructionLabel.htmlFor = 'global-instruction';
  const globalActions = document.createElement('div');
  globalActions.className = 'actions';
  const globalSend = document.createElement('button');
  globalSend.className = 'submit toolbar-submit';
  globalSend.type = 'submit';
  globalSend.dataset.sendAll = 'true';
  globalSend.textContent = 'Send all';
  globalSend.disabled = true;
  globalActions.append(globalSend);
  const globalStatus = document.createElement('p');
  globalStatus.className = 'submit-status';
  globalStatus.setAttribute('role', 'status');
  globalStatus.setAttribute('aria-live', 'polite');
  globalToolbar.append(globalHeader);
  globalToolbar.append(globalInstructionLabel);
  globalToolbar.append(globalInstructionInput);
  globalToolbar.append(globalActions);
  globalToolbar.append(globalStatus);

  const hoverMarker = document.createElement('div');
  hoverMarker.className = 'hover-marker';
  ui.append(hoverMarker);
  let shortcutToast = null;
  ui.append(selectionToolbar);
  ui.append(globalToolbar);
  showShortcutToast();

  const targets = [];
  let nextTargetNumber = 1;
  let activeTarget = null;
  let focusReturnTarget = null;
  let globalInstruction = '';
  let globalStatusKind = '';
  let batchSending = false;
  let batchRequest = null;
  let active = false;

  const describe = (element) => {
    const rect = element.getBoundingClientRect();
    const computed = getComputedStyle(element);
    const selector = element.id
      ? `#${CSS.escape(element.id)}`
      : `${element.tagName.toLowerCase()}${[...element.classList].slice(0, 2).map((name) => `.${CSS.escape(name)}`).join('')}`;

    return {
      selector,
      role: element.getAttribute('role') || element.tagName.toLowerCase(),
      text: (element.getAttribute('aria-label') || element.innerText || '').trim().slice(0, 1000),
      outerHTML: element.outerHTML.slice(0, 4000),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      styles: {
        display: computed.display,
        position: computed.position,
        color: computed.color,
        backgroundColor: computed.backgroundColor,
        fontSize: computed.fontSize,
        width: computed.width,
        height: computed.height,
      },
    };
  };

  const isExtensionUiEvent = (event) => event.composedPath?.().includes(host) || event.target === host;

  const describeTarget = (element) => {
    const tag = element.tagName.toLowerCase();
    const label = (element.getAttribute('aria-label') || element.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    return label ? `${tag} · ${label}` : tag;
  };

  const isVisibleElement = (element) => {
    if (!(element instanceof Element) || element.closest('[data-pi-devloop-host]')) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && rect.width > 0 && rect.height > 0;
  };

  const getVisibleParent = (element) => isVisibleElement(element?.parentElement) ? element.parentElement : null;
  const getFirstVisibleChild = (element) => [...(element?.children ?? [])].find(isVisibleElement) ?? null;

  const getNavigationCandidate = (target, direction) => {
    if (!target) return null;
    const candidate = direction === 'parent' ? getVisibleParent(target.element) : getFirstVisibleChild(target.element);
    return candidate && !targets.some((other) => other !== target && other.element === candidate) ? candidate : null;
  };

  const updateToolbarAvailability = () => {
    const target = activeTarget;
    parentButton.disabled = !active || batchSending || !target || target.sending || !getNavigationCandidate(target, 'parent');
    childButton.disabled = !active || batchSending || !target || target.sending || !getNavigationCandidate(target, 'child');
    targetInstruction.disabled = !active || batchSending || !target || target.sending;
    targetSend.disabled = !active || batchSending || !target || target.sending || !target.instruction.trim();
    removeTargetButton.disabled = !active || batchSending || !target || target.sending;
  };

  const updateGlobalToolbar = () => {
    globalToolbar.style.display = active ? 'flex' : 'none';
    selectionCount.textContent = `${targets.length}/5 elements selected`;
    if (globalInstructionInput.value !== globalInstruction) globalInstructionInput.value = globalInstruction;
    const hasInstruction = Boolean(globalInstruction.trim()) || targets.some((target) => Boolean(target.instruction.trim()));
    const anyTargetSending = targets.some((target) => target.sending);
    globalInstructionInput.disabled = !active || batchSending || anyTargetSending;
    globalSend.disabled = !active || targets.length === 0 || batchSending || anyTargetSending || !hasInstruction;
    globalSend.textContent = batchSending ? 'Sending…' : 'Send all';
    globalStatus.className = `submit-status${globalStatusKind ? ` ${globalStatusKind}` : ''}`;
    globalStatus.setAttribute('role', globalStatusKind === 'error' ? 'alert' : 'status');
  };

  const positionTarget = (target) => {
    const rect = target.element.getBoundingClientRect();
    const labelHeight = target.label.offsetHeight || 24;
    const labelWidth = target.label.offsetWidth || 180;
    const maxLeft = Math.max(8, (window.innerWidth || rect.left + labelWidth + 8) - labelWidth - 8);
    const left = Math.max(8, Math.min(rect.left, maxLeft));
    const below = (rect.bottom ?? rect.top + rect.height) + 4;
    const top = window.innerHeight && below + labelHeight > window.innerHeight - 8
      ? Math.max(8, rect.top - labelHeight - 4)
      : below;
    target.marker.dataset.active = String(target === activeTarget);
    target.label.dataset.active = String(target === activeTarget);
    target.label.textContent = `${target.number} · ${describeTarget(target.element)}`;
    target.label.setAttribute('aria-label', `Select element ${target.number}: ${describeTarget(target.element)}`);
    Object.assign(target.marker.style, {
      display: 'block', left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`,
    });
    Object.assign(target.label.style, { display: 'block', left: `${left}px`, top: `${top}px` });
  };

  const positionTargetToolbar = () => {
    if (!active || !activeTarget || selectionToolbar.style.display === 'none') return;
    const targetRect = activeTarget.element.getBoundingClientRect();
    const toolbarRect = selectionToolbar.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || targetRect.right + toolbarRect.width;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || targetRect.bottom + toolbarRect.height;
    const gutter = 12;
    const gap = 12;
    const maxLeft = Math.max(gutter, viewportWidth - toolbarRect.width - gutter);
    const globalToolbarRect = globalToolbar.style.display === 'none' ? null : globalToolbar.getBoundingClientRect();
    const globalClearanceTop = globalToolbarRect?.height > 0 ? globalToolbarRect.top - gap : viewportHeight - gutter;
    const bottomLimit = Math.max(gutter, Math.min(viewportHeight - gutter, globalClearanceTop));
    const maxTop = Math.max(gutter, bottomLimit - toolbarRect.height);
    let left = targetRect.left;
    if (left + toolbarRect.width > viewportWidth - gutter) left = targetRect.right - toolbarRect.width;
    left = Math.max(gutter, Math.min(left, maxLeft));

    let top = targetRect.bottom + gap;
    if (top + toolbarRect.height > bottomLimit) {
      const aboveTarget = targetRect.top - toolbarRect.height - gap;
      top = aboveTarget >= gutter && aboveTarget <= maxTop ? aboveTarget : maxTop;
    }
    top = Math.max(gutter, Math.min(top, maxTop));

    Object.assign(selectionToolbar.style, {
      left: `${left}px`,
      top: `${top}px`,
      right: 'auto',
      bottom: 'auto',
      transform: 'none',
    });
  };

  const updateTargetPositions = () => {
    if (!active) return;
    for (const target of targets) positionTarget(target);
    positionTargetToolbar();
  };

  window.addEventListener('resize', updateTargetPositions, { passive: true });
  window.addEventListener('scroll', updateTargetPositions, { passive: true, capture: true });

  const hideHoverPreview = () => { hoverMarker.style.display = 'none'; };

  const onPointerMove = (event) => {
    const element = event.target;
    if (!active || isExtensionUiEvent(event) || !(element instanceof Element) ||
      element === document.documentElement || element === document.body ||
      element.closest('[data-pi-devloop-host]') || !isVisibleElement(element) ||
      targets.some((target) => target.element === element)) {
      hideHoverPreview();
      return;
    }

    const rect = element.getBoundingClientRect();
    Object.assign(hoverMarker.style, {
      display: 'block', left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`,
    });
  };

  const updateTargetToolbar = () => {
    if (!active || !activeTarget) {
      selectionToolbar.style.display = 'none';
      updateGlobalToolbar();
      return;
    }
    selectionToolbar.style.display = 'flex';
    toolbarTitle.textContent = `Element ${activeTarget.number}: ${describeTarget(activeTarget.element)}`;
    selectionToolbar.setAttribute('aria-label', `Instructions for element ${activeTarget.number}`);
    targetInstructionLabel.textContent = `Instruction for element ${activeTarget.number}`;
    if (targetInstruction.value !== activeTarget.instruction) targetInstruction.value = activeTarget.instruction;
    targetStatus.textContent = activeTarget.status || '';
    targetStatus.className = `submit-status${activeTarget.statusKind ? ` ${activeTarget.statusKind}` : ''}`;
    targetStatus.setAttribute('role', activeTarget.statusKind === 'error' ? 'alert' : 'status');
    targetSend.textContent = activeTarget.sending ? 'Sending…' : 'Send';
    removeTargetButton.setAttribute('aria-label', `Remove element ${activeTarget.number} from selection`);
    for (const target of targets) positionTarget(target);
    updateToolbarAvailability();
    updateGlobalToolbar();
    positionTargetToolbar();
  };

  const saveActiveInstruction = () => {
    if (activeTarget && !activeTarget.sending) activeTarget.instruction = targetInstruction.value;
  };

  const setActiveTarget = (target, focusInput = false) => {
    if (activeTarget !== target) saveActiveInstruction();
    activeTarget = target;
    updateTargetToolbar();
    if (focusInput) targetInstruction.focus();
  };

  const addTarget = (element) => {
    const existing = targets.find((target) => target.element === element);
    if (existing) {
      setActiveTarget(existing, true);
      return;
    }
    if (targets.length >= 5) {
      showFeedbackNotice('You can select up to five elements. Press Escape to start over.', 'error');
      return;
    }
    if (targets.length === 0 && !focusReturnTarget) focusReturnTarget = ui.activeElement || document.activeElement;
    if (!Number.isSafeInteger(nextTargetNumber)) {
      showFeedbackNotice('No more target numbers are available. Press Escape to reset.', 'error');
      return;
    }
    const target = {
      number: nextTargetNumber,
      element,
      instruction: '',
      sending: false,
      status: '',
      statusKind: '',
      marker: document.createElement('div'),
      label: document.createElement('button'),
    };
    target.marker.className = 'marker';
    target.label.className = 'selection-label';
    target.label.type = 'button';
    target.label.dataset.number = String(target.number);
    target.label.addEventListener('click', () => setActiveTarget(target, true));
    nextTargetNumber += 1;
    targets.push(target);
    ui.append(target.marker);
    ui.append(target.label);
    setActiveTarget(target, true);
  };

  const removeActiveTarget = () => {
    const target = activeTarget;
    if (!target || target.sending || batchSending) return;
    saveActiveInstruction();
    const removedIndex = targets.indexOf(target);
    if (removedIndex < 0) return;
    target.marker.remove();
    target.label.remove();
    targets.splice(removedIndex, 1);
    activeTarget = targets[Math.min(removedIndex, targets.length - 1)] ?? null;
    if (!activeTarget) {
      targetInstruction.value = '';
      targetStatus.textContent = '';
      targetStatus.className = 'submit-status';
    }
    updateTargetToolbar();
    if (activeTarget) targetInstruction.focus();
    else globalInstructionInput.focus();
  };

  const clearTargets = () => {
    for (const target of targets) {
      target.marker.remove();
      target.label.remove();
    }
    targets.length = 0;
    nextTargetNumber = 1;
    activeTarget = null;
    hideHoverPreview();
    selectionToolbar.style.display = 'none';
    targetInstruction.value = '';
    targetStatus.textContent = '';
    globalInstruction = '';
    globalInstructionInput.value = '';
    globalStatus.textContent = '';
    globalStatusKind = '';
    batchSending = false;
    batchRequest = null;
    updateGlobalToolbar();
    const returnTarget = focusReturnTarget;
    focusReturnTarget = null;
    if (returnTarget && returnTarget.isConnected !== false) returnTarget.focus?.({ preventScroll: true });
  };

  const navigateActiveTarget = (direction) => {
    const target = activeTarget;
    const candidate = getNavigationCandidate(target, direction);
    if (!active || !candidate) return;
    saveActiveInstruction();
    target.element = candidate;
    target.status = '';
    target.statusKind = '';
    updateTargetToolbar();
    targetInstruction.focus();
  };

  targetInstruction.addEventListener('input', () => {
    if (!activeTarget || activeTarget.sending) return;
    activeTarget.instruction = targetInstruction.value;
    activeTarget.status = '';
    activeTarget.statusKind = '';
    updateToolbarAvailability();
    updateGlobalToolbar();
  });

  selectionToolbar.onsubmit = (event) => {
    event.preventDefault();
    const target = activeTarget;
    if (!active || !target || target.sending) return;
    target.instruction = targetInstruction.value.trim();
    if (!target.instruction) return;

    target.sending = true;
    target.status = 'Sending feedback…';
    target.statusKind = '';
    updateTargetToolbar();
    const selection = {
      version: 2,
      mode: 'individual',
      pageUrl: location.href,
      targets: [{ number: target.number, ...describe(target.element), instruction: target.instruction }],
    };
    chrome.runtime.sendMessage({ type: 'devloop:submit', selection }, (result) => {
      target.sending = false;
      if (chrome.runtime.lastError || !result?.ok) {
        target.status = result?.error || chrome.runtime.lastError?.message || 'Feedback could not be sent.';
        target.statusKind = 'error';
        updateTargetToolbar();
        showFeedbackNotice(target.status, 'error');
        return;
      }
      target.instruction = '';
      target.status = 'Sent to Pi.';
      target.statusKind = 'success';
      updateTargetToolbar();
      showFeedbackNotice(`Element ${target.number} sent to Pi.`, 'success');
    });
  };

  globalInstructionInput.addEventListener('input', () => {
    globalInstruction = globalInstructionInput.value;
    globalStatus.textContent = '';
    globalStatusKind = '';
    updateGlobalToolbar();
  });

  globalToolbar.onsubmit = (event) => {
    event.preventDefault();
    saveActiveInstruction();
    globalInstruction = globalInstructionInput.value.trim();
    if (!active || batchSending || targets.length === 0 || targets.some((target) => target.sending)) return;
    const hasInstruction = Boolean(globalInstruction) || targets.some((target) => Boolean(target.instruction.trim()));
    if (!hasInstruction) return;

    const selection = {
      version: 2,
      mode: 'batch',
      pageUrl: location.href,
      targets: targets.map((target) => ({
        number: target.number,
        ...describe(target.element),
        ...(target.instruction.trim() ? { instruction: target.instruction.trim() } : {}),
      })),
      ...(globalInstruction ? { globalInstruction } : {}),
    };
    const request = {};
    batchRequest = request;
    batchSending = true;
    globalStatus.textContent = 'Sending feedback…';
    globalStatusKind = '';
    updateTargetToolbar();
    updateGlobalToolbar();
    chrome.runtime.sendMessage({ type: 'devloop:submit', selection }, (result) => {
      if (batchRequest !== request) return;
      batchRequest = null;
      batchSending = false;
      if (chrome.runtime.lastError || !result?.ok) {
        globalStatus.textContent = result?.error || chrome.runtime.lastError?.message || 'Feedback could not be sent.';
        globalStatusKind = 'error';
        updateTargetToolbar();
        updateGlobalToolbar();
        showFeedbackNotice(globalStatus.textContent, 'error');
        return;
      }
      for (const target of targets) {
        target.instruction = '';
        target.status = 'Sent with batch.';
        target.statusKind = 'success';
      }
      globalInstruction = '';
      globalInstructionInput.value = '';
      globalStatus.textContent = 'Batch sent to Pi.';
      globalStatusKind = 'success';
      updateTargetToolbar();
      updateGlobalToolbar();
      showFeedbackNotice('Feedback batch sent to Pi.', 'success');
    });
  };

  parentButton.addEventListener('click', () => navigateActiveTarget('parent'));
  childButton.addEventListener('click', () => navigateActiveTarget('child'));
  removeTargetButton.addEventListener('click', removeActiveTarget);

  const onClick = (event) => {
    if (!active || isExtensionUiEvent(event)) return;
    const element = event.target;
    if (!(element instanceof Element) || element.closest('[data-pi-devloop-host]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    addTarget(element);
    hideHoverPreview();
  };

  const onKeyDown = (event) => {
    if (event.key !== 'Escape' || !active) return;
    event.preventDefault();
    active = false;
    clearTargets();
  };

  document.addEventListener('pointermove', onPointerMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === 'devloop:get-state') {
      respond?.({ active });
      return;
    }
    if (message?.type === 'devloop:activate') active = true;
    else if (message?.type === 'devloop:toggle') active = !active;
    else return;

    if (!active) clearTargets();
    else updateTargetToolbar();
    respond?.({ active });
  });

  function showShortcutToast() {
    let shouldShow = true;
    try {
      const key = 'pi-devloop-shortcut-toast-shown';
      shouldShow = sessionStorage.getItem(key) !== 'true';
      if (shouldShow) sessionStorage.setItem(key, 'true');
    } catch {
      // Restricted pages may deny storage; still show the one-time hint for this document.
    }
    if (!shouldShow) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.dataset.piDevloopToast = 'true';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = 'Pi Devloop is ready. Press Alt+Shift+E to select an element.';
    shortcutToast = toast;
    ui.append(toast);
    setTimeout(() => {
      toast.remove();
      if (shortcutToast === toast) shortcutToast = null;
    }, 5000);
  }

  function showFeedbackNotice(message, kind) {
    shortcutToast?.remove();
    shortcutToast = null;
    const toast = document.createElement('div');
    toast.className = `toast feedback-notice ${kind}-notice`;
    toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    toast.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
    toast.textContent = message;
    ui.append(toast);
    setTimeout(() => toast.remove(), 3500);
  }
})();
