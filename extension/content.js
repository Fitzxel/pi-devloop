(() => {
  if (window.__piDevloopActive) return;
  window.__piDevloopActive = true;
  const box = document.createElement('div');
  Object.assign(box.style, { position: 'fixed', zIndex: '2147483647', pointerEvents: 'none', border: '2px solid #8b5cf6', background: 'rgba(139,92,246,.12)', display: 'none', boxSizing: 'border-box' });
  (document.documentElement || document).append(box);
  let selected = null;
  let dialog;
  let active = false;
  const describe = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const stable = element.id ? `#${CSS.escape(element.id)}` : `${element.tagName.toLowerCase()}${[...element.classList].slice(0, 2).map((name) => `.${CSS.escape(name)}`).join('')}`;
    return { selector: stable, role: element.getAttribute('role') || element.tagName.toLowerCase(), text: (element.getAttribute('aria-label') || element.innerText || '').trim().slice(0, 1000), outerHTML: element.outerHTML.slice(0, 4000), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, styles: { display: style.display, position: style.position, color: style.color, backgroundColor: style.backgroundColor, fontSize: style.fontSize, width: style.width, height: style.height } };
  };
  const move = (event) => {
    if (!active || dialog?.contains(event.target)) return;
    const element = event.target;
    if (!(element instanceof Element) || element === box || element.closest('[data-pi-devloop-ui]')) return;
    selected = element;
    const rect = element.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  };
  const onClick = (event) => {
    if (!active || dialog?.contains(event.target) || !selected) return;
    event.preventDefault(); event.stopImmediatePropagation();
    dialog?.remove();
    dialog = document.createElement('form'); dialog.dataset.piDevloopUi = 'true';
    Object.assign(dialog.style, { position: 'fixed', zIndex: '2147483647', top: '16px', right: '16px', padding: '12px', background: '#18181b', color: 'white', borderRadius: '8px', boxShadow: '0 4px 24px #0008', font: '14px sans-serif' });
    dialog.innerHTML = '<label>Describe the change<br><textarea required maxlength="4000" style="width:320px;height:80px;margin:8px 0"></textarea></label><br><button type="submit">Send to Pi</button> <button type="button" data-cancel>Cancel</button>';
    document.body.append(dialog);
    dialog.querySelector('[data-cancel]').onclick = () => dialog.remove();
    dialog.onsubmit = (submitEvent) => {
      submitEvent.preventDefault();
      const instruction = dialog.querySelector('textarea').value.trim();
      if (!instruction) return;
      chrome.runtime.sendMessage({ type: 'devloop:submit', selection: { ...describe(selected), instruction, pageUrl: location.href } }, (result) => {
        if (chrome.runtime.lastError || !result?.ok) { const error = document.createElement('p'); error.textContent = result?.error || chrome.runtime.lastError.message; dialog.append(error); }
        else dialog.remove();
      });
    };
  };
  document.addEventListener('pointermove', move, true);
  document.addEventListener('click', onClick, true);
  chrome.runtime.onMessage.addListener((message) => { if (message?.type === 'devloop:activate') { active = true; box.style.display = 'block'; } });
})();
