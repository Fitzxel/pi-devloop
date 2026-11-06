const button = document.querySelector('#toggle');
const statusText = document.querySelector('#status');
const statusDot = document.querySelector('#status-dot');
const title = document.querySelector('#activation-title');

function showState(kind, heading, message, actionLabel) {
  title.textContent = heading;
  statusText.textContent = message;
  statusText.classList.toggle('error', kind === 'error');
  statusDot.className = `status-dot${kind === 'ready' ? ' ready' : kind === 'error' ? ' error' : ''}`;
  button.textContent = actionLabel;
  button.disabled = false;
}

function showUnavailable() {
  showState('error', 'Page unavailable', 'This page cannot receive the activation message. Try a regular webpage.', 'Try again');
}

button.addEventListener('click', () => {
  button.disabled = true;
  statusText.textContent = 'Connecting to the active page…';
  statusText.classList.remove('error');
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (chrome.runtime.lastError || !tabs?.[0]?.id) {
      showUnavailable();
      return;
    }
    chrome.tabs.sendMessage(tabs[0].id, { type: 'devloop:toggle' }, (result) => {
      if (chrome.runtime.lastError || typeof result?.active !== 'boolean') {
        showUnavailable();
        return;
      }
      const active = result.active;
      showState(
        active ? 'ready' : 'idle',
        active ? 'Selection activated' : 'Selection paused',
        active ? 'Choose an element on the page to continue.' : 'Selection is off for this tab.',
        active ? 'Deactivate selection' : 'Activate selection',
      );
    });
  });
});
