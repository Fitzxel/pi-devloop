(() => {
  if (window.__piDevloopInstalled) return;
  window.__piDevloopInstalled = true;
  const config = window.__PI_DEVLOOP__;
  if (!config?.endpoint || !config?.token) return;

  const box = document.createElement('div');
  Object.assign(box.style, { position: 'fixed', zIndex: '2147483647', pointerEvents: 'none', border: '2px solid #8b5cf6', background: 'rgba(139,92,246,.12)', display: 'none', boxSizing: 'border-box' });
  (document.documentElement || document).append(box);
  let selected = null;
  let dialog;
  const describe = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const stable = element.id ? `#${CSS.escape(element.id)}` : `${element.tagName.toLowerCase()}${[...element.classList].slice(0, 2).map((name) => `.${CSS.escape(name)}`).join('')}`;
    return {
      selector: stable,
      role: element.getAttribute('role') || element.tagName.toLowerCase(),
      text: (element.getAttribute('aria-label') || element.innerText || '').trim().slice(0, 1000),
      outerHTML: element.outerHTML.slice(0, 4000),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      styles: { display: style.display, position: style.position, color: style.color, backgroundColor: style.backgroundColor, fontSize: style.fontSize, width: style.width, height: style.height },
    };
  };
  const move = (event) => {
    if (dialog?.contains(event.target)) return;
    const element = event.target;
    if (!(element instanceof Element) || element === box || element.closest('[data-pi-devloop-ui]')) return;
    selected = element;
    const rect = element.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  };
  const showDialog = (element) => {
    dialog?.remove();
    dialog = document.createElement('form');
    dialog.dataset.piDevloopUi = 'true';
    Object.assign(dialog.style, { position: 'fixed', zIndex: '2147483647', top: '16px', right: '16px', padding: '12px', background: '#18181b', color: 'white', borderRadius: '8px', boxShadow: '0 4px 24px #0008', font: '14px sans-serif' });
    dialog.innerHTML = '<label>Describe the change<br><textarea required maxlength="4000" style="width:320px;height:80px;margin:8px 0"></textarea></label><br><button type="submit">Send to Pi</button> <button type="button" data-cancel>Cancel</button>';
    document.body.append(dialog);
    dialog.querySelector('[data-cancel]').onclick = () => dialog.remove();
    dialog.onsubmit = async (event) => {
      event.preventDefault();
      const instruction = dialog.querySelector('textarea').value.trim();
      if (!instruction) return;
      const selection = { ...describe(element), instruction, pageUrl: location.href };
      try {
        const response = await fetch(config.endpoint, { method: 'POST', mode: 'cors', headers: { 'content-type': 'application/json', authorization: `Bearer ${config.token}` }, body: JSON.stringify(selection) });
        if (!response.ok) throw new Error(`Feedback server returned ${response.status}`);
        dialog.remove();
      } catch (error) {
        const message = document.createElement('p');
        message.textContent = error.message;
        dialog.append(message);
      }
    };
  };
  document.addEventListener('pointermove', move, true);
  document.addEventListener('click', (event) => {
    if (dialog?.contains(event.target) || !selected) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showDialog(selected);
  }, true);
  window.__piDevloopDispose = () => { document.removeEventListener('pointermove', move, true); box.remove(); dialog?.remove(); delete window.__piDevloopInstalled; };
})();
