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
      --ink: #142139;
      --muted: #596b84;
      --surface: #ffffff;
      --surface-soft: #f3f6fb;
      --line: #d8e0eb;
      --accent: #315bd6;
      --accent-hover: #254bb9;
      --focus: #7897f0;
      --danger: #b42318;
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
      border: 1px solid #aebdd0;
      border-radius: 9px;
      padding: 11px 12px;
      color: var(--ink);
      background: var(--surface);
      font: inherit;
      outline: none;
    }

    textarea::placeholder { color: var(--muted); opacity: 1; }
    textarea:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 3px rgb(49 91 214 / 20%); }
    .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }

    button {
      min-height: 38px;
      border: 0;
      border-radius: 8px;
      padding: 9px 13px;
      font: 600 13px/1.25 ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
    }

    button:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
    .cancel { color: #344256; background: var(--surface-soft); }
    .submit { color: #fff; background: var(--accent); }
    .submit:hover { background: var(--accent-hover); }
    .error { margin: 12px 0 0; color: var(--danger); }
    .marker { position: fixed; pointer-events: none; border: 2px solid var(--accent); background: rgb(49 91 214 / 10%); display: none; }

    @media (prefers-color-scheme: dark) {
      :host {
        --ink: #edf2fb;
        --muted: #b2bfd2;
        --surface: #182235;
        --surface-soft: #28364d;
        --line: #3c4b62;
        --accent: #8ba8ff;
        --accent-hover: #a2b8ff;
        --focus: #9bb2ff;
        --danger: #ff9b91;
      }
      .submit { color: #101a2c; }
      .cancel { color: var(--ink); }
      textarea { border-color: #61718a; }
      .marker { background: rgb(139 168 255 / 14%); }
    }

    @keyframes arrive { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
    @media (prefers-reduced-motion: reduce) { .toast, .panel { animation: none; } }
  `;
  ui.append(style);

  const marker = document.createElement('div');
  marker.className = 'marker';
  ui.append(marker);
  showShortcutToast();

  let selected = null;
  let form = null;
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

  const closeForm = () => {
    form?.remove();
    form = null;
  };

  const move = (event) => {
    if (!active || form || isExtensionUiEvent(event)) return;
    const element = event.target;
    if (!(element instanceof Element) || element.closest('[data-pi-devloop-host]')) return;

    selected = element;
    const rect = element.getBoundingClientRect();
    Object.assign(marker.style, {
      display: 'block',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  };

  const onClick = (event) => {
    if (!active || isExtensionUiEvent(event) || !selected) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (form) return;

    form = document.createElement('form');
    form.className = 'panel';
    form.setAttribute('aria-label', 'Send feedback');
    form.innerHTML = '<h2 class="title">Describe the change</h2><p class="hint">Your selected element will be sent with this instruction.</p><label class="label" for="instruction">Instruction</label><textarea id="instruction" required maxlength="4000" placeholder="What should change?"></textarea><div class="actions"><button class="cancel" type="button" data-cancel>Cancel</button><button class="submit" type="submit">Send to Pi</button></div>';
    ui.append(form);

    form.querySelector('[data-cancel]').addEventListener('click', closeForm);
    form.onsubmit = (submitEvent) => {
      submitEvent.preventDefault();
      const instruction = form.querySelector('textarea').value.trim();
      if (!instruction) return;

      chrome.runtime.sendMessage({
        type: 'devloop:submit',
        selection: { ...describe(selected), instruction, pageUrl: location.href },
      }, (result) => {
        if (chrome.runtime.lastError || !result?.ok) {
          const error = document.createElement('p');
          error.className = 'error';
          error.setAttribute('role', 'alert');
          error.textContent = result?.error || chrome.runtime.lastError?.message || 'Feedback could not be sent.';
          form?.append(error);
          return;
        }
        closeForm();
      });
    };
    form.querySelector('textarea').focus();
  };

  const onKeyDown = (event) => {
    if (event.key !== 'Escape' || !active) return;
    event.preventDefault();
    closeForm();
    active = false;
    selected = null;
    marker.style.display = 'none';
  };

  document.addEventListener('pointermove', move, true);
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

    if (!active) {
      closeForm();
      selected = null;
      marker.style.display = 'none';
    }
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
    ui.append(toast);
    setTimeout(() => toast.remove(), 5000);
  }
})();
