const button = document.querySelector('#toggle');
const statusText = document.querySelector('#status');
function showState(kind, message, actionLabel) {
  statusText.textContent = message;
  statusText.classList.toggle('error', kind === 'error');
  button.textContent = actionLabel;
  button.disabled = false;
}

function showUnavailable() {
  showState('error', 'This page cannot receive the activation message. Try a regular webpage.', 'Try again');
}

function showSelectionState(active) {
  showState(
    active ? 'ready' : 'idle',
    active ? 'Choose an element on the page to continue.' : 'Selection is off for this tab.',
    active ? 'Deactivate selection' : 'Activate selection',
  );
}

function querySelectionState() {
  button.disabled = true;
  statusText.textContent = 'Checking selection state…';
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (chrome.runtime.lastError || !tabs?.[0]?.id) {
      showUnavailable();
      return;
    }
    chrome.tabs.sendMessage(tabs[0].id, { type: 'devloop:get-state' }, (result) => {
      if (chrome.runtime.lastError || typeof result?.active !== 'boolean') {
        showUnavailable();
        return;
      }
      showSelectionState(result.active);
    });
  });
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
      showSelectionState(result.active);
    });
  });
});

querySelectionState();
