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

  append(child) { child.parent = this; this.children.push(child); }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(name, callback) { this.listeners ??= {}; this.listeners[name] = callback; }
  attachShadow({ mode }) { this.shadowRoot = new FakeShadowRoot(mode); return this.shadowRoot; }
  closest(selector) { return selector === '[data-pi-devloop-host]' && this.dataset.piDevloopHost ? this : null; }
  contains(target) { return this === target || this.children.some((child) => child.contains(target)); }
  focus() { this.focused = true; }
  remove() { this.removed = true; this.parent?.children.splice(this.parent.children.indexOf(this), 1); }
  getBoundingClientRect() { return { x: 4, y: 8, left: 4, top: 8, width: 120, height: 32 }; }
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
        || (selector === '[type="submit"]' && child.type === 'submit')) return child;
      const match = child.querySelector(selector);
      if (match) return match;
    }
    return null;
  }
}

class FakeShadowRoot extends FakeElement {
  constructor(mode) { super('#shadow-root'); this.mode = mode; }
}

function loadContentScript(storage = createStorage()) {
  const documentListeners = {};
  const runtimeListeners = [];
  const created = [];
  const document = {
    documentElement: new FakeElement('html'),
    addEventListener(name, callback) { documentListeners[name] = callback; },
    createElement(tagName) { const element = new FakeElement(tagName); created.push(element); return element; },
  };
  const sentMessages = [];
  const chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener(listener) { runtimeListeners.push(listener); } },
      sendMessage(message, callback) { sentMessages.push(message); callback({ ok: true }); },
    },
  };
  runInNewContext(contentScript, {
    window: {}, document, sessionStorage: storage, chrome, Element: FakeElement,
    CSS: { escape: (value) => value },
    getComputedStyle: () => ({ display: 'block', position: 'static', color: 'rgb(0, 0, 0)', backgroundColor: 'rgba(0, 0, 0, 0)', fontSize: '16px', width: '120px', height: '32px' }),
    location: { href: 'http://localhost:3000/page' },
    setTimeout() { return 1; },
  });
  return { document, documentListeners, runtimeListeners, created, sentMessages };
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
  extension.documentListeners.pointermove({ target: pageElement });
  const selectionClick = {
    target: pageElement,
    composedPath: () => [pageElement, extension.document.documentElement],
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.stopped = true; },
  };
  extension.documentListeners.click(selectionClick);
  assert.equal(selectionClick.defaultPrevented, true);
  assert.equal(selectionClick.stopped, true);
  const host = extension.document.documentElement.children[0];
  return { host, form: host.shadowRoot.children.find((child) => child.tagName === 'FORM') };
}

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
      selector: '#save', role: 'button', text: 'Save', outerHTML: '<button id="save">Save</button>',
      rect: { x: 4, y: 8, width: 120, height: 32 },
      styles: { display: 'block', position: 'static', color: 'rgb(0, 0, 0)', backgroundColor: 'rgba(0, 0, 0, 0)', fontSize: '16px', width: '120px', height: '32px' },
      instruction: 'Give this button more spacing', pageUrl: 'http://localhost:3000/page',
    },
  }]);
  assert.equal(form.removed, true, 'successful submission closes the form');
});

test('cancel closes feedback without submitting it', () => {
  const extension = loadContentScript();
  const { form } = activateAndSelect(extension);
  form.querySelector('[data-cancel]').listeners.click();
  assert.equal(form.removed, true);
  assert.deepEqual(extension.sentMessages, []);
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
