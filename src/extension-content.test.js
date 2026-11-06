import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const contentScript = await readFile(new URL('../extension/content.js', import.meta.url), 'utf8');

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.children = [];
    this.classList = [];
    this.value = '';
    this.removed = false;
  }

  append(child) { child.parent = this; child.parentElement = this; this.children.push(child); }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(name, callback) { this.listeners ??= {}; this.listeners[name] = callback; }
  attachShadow({ mode }) { this.shadowRoot = new FakeShadowRoot(mode); return this.shadowRoot; }
  closest(selector) { return selector === '[data-pi-devloop-host]' && this.dataset.piDevloopHost ? this : null; }
  contains(target) { return this === target || this.children.some((child) => child.contains(target)); }
  focus() { this.focused = true; }
  remove() { this.removed = true; this.parent?.children.splice(this.parent.children.indexOf(this), 1); }
  getBoundingClientRect() { return this.rect ?? { x: 4, y: 8, left: 4, top: 8, right: 124, bottom: 40, width: 120, height: 32 }; }
  get innerText() { return 'Save'; }
  get outerHTML() { return `<${this.tagName.toLowerCase()} id="${this.id ?? ''}">Save</${this.tagName.toLowerCase()}>`; }
  get innerHTML() { return this.html ?? ''; }
  set innerHTML(value) {
    this.html = value;
    if (this.tagName !== 'FORM') return;
    for (const [tagName, className, selector, type] of [
      ['TEXTAREA', '', 'textarea', ''],
      ['BUTTON', 'cancel', '[data-cancel]', 'button'],
      ['BUTTON', 'submit', '[type="submit"]', 'submit'],
    ]) {
      const child = new FakeElement(tagName);
      child.className = className;
      child.type = type;
      if (selector === '[data-cancel]') child.dataset.cancel = 'true';
      this.append(child);
    }
  }

  querySelector(selector) {
    for (const child of this.children) {
      if ((selector === 'textarea' && child.tagName === 'TEXTAREA')
        || (selector === '[data-cancel]' && child.dataset.cancel)
        || (selector === '[type="submit"]' && child.type === 'submit')
        || (selector === '.error' && child.className === 'error')) return child;
      const match = child.querySelector(selector);
      if (match) return match;
    }
    return null;
  }
}

class FakeShadowRoot extends FakeElement {
  constructor(mode) { super('#shadow-root'); this.mode = mode; }
}

function loadContentScript(storage = createStorage(), sendMessageHandler = (_message, callback) => callback({ ok: true })) {
  const documentListeners = {};
  const runtimeListeners = [];
  const created = [];
  const document = {
    documentElement: new FakeElement('html'),
    addEventListener(name, callback) { documentListeners[name] = callback; },
    createElement(tagName) { const element = new FakeElement(tagName); created.push(element); return element; },
  };
  const sentMessages = [];
  const window = {};
  const chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener(listener) { runtimeListeners.push(listener); } },
      sendMessage(message, callback) { sentMessages.push(message); sendMessageHandler(message, callback); },
    },
  };
  runInNewContext(contentScript, {
    window, document, sessionStorage: storage, chrome, Element: FakeElement,
    CSS: { escape: (value) => value },
    getComputedStyle: (element) => ({ display: element.style.display || 'block', visibility: element.style.visibility || 'visible', position: 'static', color: 'rgb(0, 0, 0)', backgroundColor: 'rgba(0, 0, 0, 0)', fontSize: '16px', width: '120px', height: '32px' }),
    location: { href: 'http://localhost:3000/page' },
    setTimeout() { return 1; },
  });
  return { window, document, documentListeners, runtimeListeners, created, sentMessages };
}

function createStorage() {
  const values = new Map();
  return { getItem(key) { return values.get(key) ?? null; }, setItem(key, value) { values.set(key, value); } };
}

function activateAndSelect(extension) {
  let activationState;
  extension.runtimeListeners[0]({ type: 'devloop:toggle' }, null, (state) => { activationState = state; });
  assert.equal(activationState.active, true);
  const pageElement = new FakeElement('button');
  pageElement.id = 'save';
  const selectionClick = clickPageElement(extension, pageElement);
  assert.equal(selectionClick.defaultPrevented, true);
  assert.equal(selectionClick.stopped, true);
  const host = extension.document.documentElement.children[0];
  return { host, form: host.shadowRoot.children.find((child) => child.tagName === 'FORM'), pageElement };
}

function clickPageElement(extension, element) {
  const event = {
    target: element,
    composedPath: () => [element, extension.document.documentElement],
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.stopped = true; },
  };
  extension.documentListeners.click(event);
  return event;
}

function getShadow(extension) {
  return extension.document.documentElement.children[0].shadowRoot;
}

function findElement(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
}


test('pins numbered targets on page clicks and leaves them unchanged on hover', () => {
  const extension = loadContentScript();
  extension.runtimeListeners[0]({ type: 'devloop:toggle' }, null, () => {});
  const first = new FakeElement('button');
  first.id = 'first';
  const second = new FakeElement('button');
  second.id = 'second';
  const third = new FakeElement('button');
  third.id = 'third';

  clickPageElement(extension, first);
  extension.documentListeners.pointermove?.({ target: second });
  assert.deepEqual(getShadow(extension).children.filter((node) => node.className === 'selection-label').map((node) => node.textContent), ['1 · button · Save']);
  clickPageElement(extension, second);
  extension.documentListeners.pointermove?.({ target: third });
  assert.deepEqual(getShadow(extension).children.filter((node) => node.className === 'selection-label').map((node) => node.textContent), ['1 · button · Save', '2 · button · Save']);
  clickPageElement(extension, first);
  assert.equal(getShadow(extension).children.filter((node) => node.className === 'selection-label').length, 2, 'clicking an existing target should activate it, not duplicate it');

  for (let number = 3; number <= 6; number += 1) clickPageElement(extension, new FakeElement('button'));
  assert.equal(getShadow(extension).children.filter((node) => node.className === 'selection-label').length, 5);
  assert.ok(getShadow(extension).children.find((node) => node.className?.includes('error-notice')));
});

test('chevrons navigate the active numbered target without changing its identity', () => {
  const extension = loadContentScript();
  extension.runtimeListeners[0]({ type: 'devloop:toggle' }, null, () => {});
  const parent = new FakeElement('section');
  parent.id = 'card';
  const hidden = new FakeElement('button');
  hidden.style.display = 'none';
  const child = new FakeElement('button');
  child.id = 'save';
  child.setAttribute('aria-label', 'Save changes');
  parent.append(hidden);
  parent.append(child);
  clickPageElement(extension, parent);

  const shadow = getShadow(extension);
  const label = shadow.children.find((node) => node.className === 'selection-label');
  const toolbar = shadow.children.find((node) => node.className === 'target-toolbar');
  const parentButton = findElement(toolbar, (node) => node.dataset.parent);
  const childButton = findElement(toolbar, (node) => node.dataset.child);
  assert.equal(parentButton.disabled, true);
  assert.equal(childButton.disabled, false);
  childButton.listeners.click();
  assert.equal(label.dataset.number, '1');
  assert.equal(label.textContent, '1 · button · Save changes');
  assert.equal(parentButton.disabled, false);
  extension.documentListeners.pointermove?.({ target: new FakeElement('article') });
  assert.equal(label.textContent, '1 · button · Save changes');
  parentButton.listeners.click();
  assert.equal(label.textContent, '1 · section · Save');
});

test('individual Send contains only its numbered target and preserves other drafts', () => {
  const extension = loadContentScript();
  extension.runtimeListeners[0]({ type: 'devloop:toggle' }, null, () => {});
  const first = new FakeElement('button');
  first.id = 'first';
  const second = new FakeElement('button');
  second.id = 'second';
  clickPageElement(extension, first);
  clickPageElement(extension, second);
  const shadow = getShadow(extension);
  const toolbar = shadow.children.find((node) => node.className === 'target-toolbar');
  const labels = shadow.children.filter((node) => node.className === 'selection-label');
  const textarea = toolbar.querySelector('textarea');
  const sendButton = findElement(toolbar, (node) => node.dataset.send);

  textarea.value = 'Rewrite the second element';
  textarea.listeners.input({ target: textarea });
  const globalToolbar = findElement(shadow, (node) => node.className === 'global-toolbar');
  const globalInstruction = globalToolbar.querySelector('textarea');
  globalInstruction.value = 'Place them together';
  globalInstruction.listeners.input({ target: globalInstruction });
  labels[0].listeners.click();
  const firstTextarea = toolbar.querySelector('textarea');
  firstTextarea.value = 'Rewrite the first element';
  firstTextarea.listeners.input({ target: firstTextarea });
  assert.equal(findElement(toolbar, (node) => node.dataset.send).disabled, false);
  toolbar.onsubmit({ preventDefault() {} });

  const message = extension.sentMessages[0];
  assert.equal(message.type, 'devloop:submit');
  assert.equal(message.selection.version, 2);
  assert.equal(message.selection.mode, 'individual');
  assert.equal(message.selection.targets.length, 1);
  assert.equal(message.selection.targets[0].number, 1);
  assert.equal(message.selection.targets[0].selector, '#first');
  assert.equal(message.selection.targets[0].instruction, 'Rewrite the first element');
  assert.equal(message.selection.globalInstruction, undefined, 'individual Send excludes global instructions');
  assert.equal(globalInstruction.value, 'Place them together', 'individual Send leaves the global draft intact');
  assert.equal(labels[1].dataset.number, '2');
  labels[1].listeners.click();
  assert.equal(toolbar.querySelector('textarea').value, 'Rewrite the second element');
  globalToolbar.onsubmit({ preventDefault() {} });
  const followUp = extension.sentMessages[1].selection;
  assert.equal(followUp.mode, 'batch');
  assert.equal(followUp.globalInstruction, 'Place them together');
  assert.equal(followUp.targets[0].instruction, undefined, 'an instruction already sent independently is not repeated');
  assert.equal(followUp.targets[1].instruction, 'Rewrite the second element');
});

test('general Send batches numbered targets and instruction drafts with retry-safe feedback', () => {
  const callbacks = [];
  const extension = loadContentScript(createStorage(), (_message, callback) => callbacks.push(callback));
  extension.runtimeListeners[0]({ type: 'devloop:toggle' }, null, () => {});
  const first = new FakeElement('button');
  first.id = 'first';
  const second = new FakeElement('button');
  second.id = 'second';
  clickPageElement(extension, first);
  clickPageElement(extension, second);
  const shadow = getShadow(extension);
  const targetToolbar = findElement(shadow, (node) => node.className === 'target-toolbar');
  const globalToolbar = findElement(shadow, (node) => node.className === 'global-toolbar');
  const labels = shadow.children.filter((node) => node.className === 'selection-label');
  const targetInstruction = targetToolbar.querySelector('textarea');
  targetInstruction.value = 'Change target 2';
  targetInstruction.listeners.input({ target: targetInstruction });
  labels[0].listeners.click();
  targetToolbar.querySelector('textarea').value = 'Rewrite target 1 in English';
  targetToolbar.querySelector('textarea').listeners.input({ target: targetToolbar.querySelector('textarea') });
  const globalInstruction = globalToolbar.querySelector('textarea');
  globalInstruction.value = 'Move 1 to where 2 is';
  globalInstruction.listeners.input({ target: globalInstruction });
  const sendAll = findElement(globalToolbar, (node) => node.dataset.sendAll);
  const status = findElement(globalToolbar, (node) => node.className?.startsWith('submit-status'));
  assert.equal(sendAll.disabled, false);

  globalToolbar.onsubmit({ preventDefault() {} });
  const batch = extension.sentMessages[0].selection;
  assert.equal(batch.version, 2);
  assert.equal(batch.mode, 'batch');
  assert.equal(batch.pageUrl, 'http://localhost:3000/page');
  assert.equal(batch.globalInstruction, 'Move 1 to where 2 is');
  assert.deepEqual(JSON.parse(JSON.stringify(batch.targets.map(({ number, selector, instruction }) => ({ number, selector, instruction })))), [
    { number: 1, selector: '#first', instruction: 'Rewrite target 1 in English' },
    { number: 2, selector: '#second', instruction: 'Change target 2' },
  ]);
  assert.equal(status.textContent, 'Sending feedback…');
  globalToolbar.onsubmit({ preventDefault() {} });
  assert.equal(extension.sentMessages.length, 1, 'duplicate batch sends are blocked while pending');

  callbacks[0]({ ok: false, error: 'Receiver unavailable' });
  assert.equal(status.textContent, 'Receiver unavailable');
  assert.equal(globalInstruction.value, 'Move 1 to where 2 is');
  assert.equal(sendAll.disabled, false);
  globalToolbar.onsubmit({ preventDefault() {} });
  callbacks[1]({ ok: true });
  assert.equal(globalInstruction.value, '');
  labels[0].listeners.click();
  assert.equal(targetToolbar.querySelector('textarea').value, '');
  labels[1].listeners.click();
  assert.equal(targetToolbar.querySelector('textarea').value, '');
  assert.equal(status.textContent, 'Batch sent to Pi.');
  assert.equal(sendAll.disabled, true);
});

test('target toolbar shows per-element navigation and labels remain attached to the numbered marker', () => {
  const extension = loadContentScript();
  extension.runtimeListeners[0]({ type: 'devloop:toggle' }, null, () => {});
  const parent = new FakeElement('section');
  parent.id = 'card';
  parent.rect = { x: 10, y: 10, left: 10, top: 10, right: 210, bottom: 40, width: 200, height: 30 };
  parent.setAttribute('aria-label', 'Card');
  const hiddenChild = new FakeElement('button');
  hiddenChild.style.display = 'none';
  const child = new FakeElement('button');
  child.id = 'save';
  child.rect = { x: 30, y: 50, left: 30, top: 50, right: 130, bottom: 70, width: 100, height: 20 };
  child.setAttribute('aria-label', 'Save changes');
  parent.append(hiddenChild);
  parent.append(child);
  clickPageElement(extension, parent);

  const shadow = getShadow(extension);
  const toolbar = shadow.children.find((node) => node.className === 'target-toolbar');
  const label = shadow.children.find((node) => node.className === 'selection-label');
  const marker = shadow.children.find((node) => node.className === 'marker');
  const parentButton = findElement(toolbar, (node) => node.dataset.parent);
  const childButton = findElement(toolbar, (node) => node.dataset.child);
  assert.equal(toolbar.style.display, 'flex');
  assert.equal(label.dataset.number, '1');
  assert.equal(label.textContent, '1 · section · Card');
  assert.equal(marker.style.left, '10px');
  assert.equal(marker.style.top, '10px');
  assert.equal(marker.style.width, '200px');
  assert.equal(marker.style.height, '30px');
  assert.equal(label.style.left, marker.style.left);
  assert.equal(label.style.top, '44px');
  assert.equal(parentButton.disabled, true);
  assert.equal(childButton.disabled, false);

  childButton.listeners.click();
  assert.equal(label.dataset.number, '1');
  assert.equal(label.textContent, '1 · button · Save changes');
  assert.equal(marker.style.left, '30px');
  assert.equal(marker.style.top, '50px');
  assert.equal(marker.style.width, '100px');
  assert.equal(marker.style.height, '20px');
  assert.equal(label.style.left, marker.style.left);
  assert.equal(label.style.top, '74px');
  extension.window.innerHeight = 80;
  parentButton.listeners.click();
  assert.equal(label.style.top, '44px');
  childButton.listeners.click();
  assert.equal(label.style.top, '22px', 'label flips above when there is no room below');
  extension.documentListeners.pointermove?.({ target: parent });
  assert.equal(label.textContent, '1 · button · Save changes', 'hover must not change the pinned element');
});

test('mounts the interface in a closed shadow root and submits the existing bounded selection payload', () => {
  const extension = loadContentScript();
  const { host, form } = activateAndSelect(extension);
  assert.equal(host.shadowRoot.mode, 'closed');
  const textarea = form.querySelector('textarea');
  assert.equal(textarea.focused, true);
  textarea.value = 'Give this button more spacing';

  const extensionUiClick = {
    target: host,
    composedPath: () => [host, extension.document.documentElement],
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.stopped = true; },
  };
  extension.documentListeners.click(extensionUiClick);
  assert.equal(extensionUiClick.defaultPrevented, undefined, 'overlay controls must not be intercepted as page selections');

  form.onsubmit({ preventDefault() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(extension.sentMessages)), [{
    type: 'devloop:submit',
    selection: {
      version: 2, mode: 'individual', pageUrl: 'http://localhost:3000/page',
      targets: [{
        number: 1, selector: '#save', role: 'button', text: 'Save', outerHTML: '<button id="save">Save</button>',
        rect: { x: 4, y: 8, width: 120, height: 32 },
        styles: { display: 'block', position: 'static', color: 'rgb(0, 0, 0)', backgroundColor: 'rgba(0, 0, 0, 0)', fontSize: '16px', width: '120px', height: '32px' },
        instruction: 'Give this button more spacing',
      }],
    },
  }]);
  assert.equal(form.style.display, 'flex', 'the element toolbar remains available for the pinned target');
  assert.equal(form.querySelector('textarea').value, '', 'successful individual sends clear only that element instruction');
  const labels = host.shadowRoot.children.filter((node) => node.className === 'selection-label');
  assert.deepEqual(labels.map((node) => node.dataset.number), ['1']);
});

test('submission disables duplicate sends, recovers from errors, and confirms success', () => {
  const callbacks = [];
  const extension = loadContentScript(createStorage(), (_message, callback) => callbacks.push(callback));
  const focusTarget = new FakeElement('button');
  extension.document.activeElement = focusTarget;
  const { form } = activateAndSelect(extension);
  form.querySelector('textarea').value = 'Describe this page element';
  const submit = findElement(form, (node) => node.dataset.send);
  const submitStatus = findElement(form, (node) => node.className?.startsWith('submit-status'));
  assert.ok(submitStatus);

  form.onsubmit({ preventDefault() {} });
  assert.equal(submitStatus.textContent, 'Sending feedback…');
  assert.equal(submit.disabled, true);
  assert.equal(submit.textContent, 'Sending…');
  form.onsubmit({ preventDefault() {} });
  assert.equal(extension.sentMessages.filter((message) => message.type === 'devloop:submit').length, 1);

  callbacks[0]({ ok: false, error: 'Receiver unavailable' });
  assert.equal(submit.disabled, false);
  assert.equal(submit.textContent, 'Send');
  assert.equal(submitStatus.textContent, 'Receiver unavailable');
  assert.equal(submitStatus.attributes.role, 'alert');

  form.onsubmit({ preventDefault() {} });
  callbacks[1]({ ok: true });
  assert.equal(form.removed, false, 'the element toolbar remains for follow-up edits');
  assert.equal(form.querySelector('textarea').value, '');
  assert.equal(submit.disabled, true, 'Send is disabled after the draft is cleared');
  const success = getShadow(extension).children.find((node) => node.className?.includes('success-notice'));
  assert.equal(success?.textContent, 'Element 1 sent to Pi.');
});

test('Escape clears pinned targets, stops selection, and restores prior focus', () => {
  const extension = loadContentScript();
  const focusTarget = new FakeElement('button');
  extension.document.activeElement = focusTarget;
  const { host, form } = activateAndSelect(extension);
  const label = host.shadowRoot.children.find((node) => node.className === 'selection-label');
  const marker = host.shadowRoot.children.find((node) => node.className === 'marker');
  extension.documentListeners.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(form.style.display, 'none');
  assert.equal(label.removed, true);
  assert.equal(marker.removed, true);
  assert.equal(focusTarget.focused, true);
  let state;
  extension.runtimeListeners[0]({ type: 'devloop:get-state' }, null, (result) => { state = result; });
  assert.equal(state.active, false);
});

test('automatically shows the Alt+Shift+E toast only once per tab session', () => {
  const storage = createStorage();
  const firstLoad = loadContentScript(storage);
  const firstShadow = firstLoad.document.documentElement.children[0].shadowRoot;
  const toast = firstShadow.children.find((node) => node.dataset.piDevloopToast === 'true');
  assert.ok(toast, 'the initial page load should show a shortcut toast');
  assert.match(toast.textContent, /Alt\+Shift\+E/);

  const secondLoad = loadContentScript(storage);
  const secondShadow = secondLoad.document.documentElement.children[0].shadowRoot;
  assert.equal(secondShadow.children.filter((node) => node.dataset.piDevloopToast === 'true').length, 0);
});
