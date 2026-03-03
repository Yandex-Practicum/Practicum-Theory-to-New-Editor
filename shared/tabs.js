export function getActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve(tabs[0]);
    });
  });
}

export function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, response => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve(response);
    });
  });
}

export function executeFilesInTab(tabId, files, world = "ISOLATED") {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        files,
        world
      },
      () => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        resolve();
      }
    );
  });
}

export function reloadTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.reload(tabId, {}, () => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve();
    });
  });
}

export function connectToTab(tabId, name = "ph-keepalive") {
  return chrome.tabs.connect(tabId, { name });
}

export function waitForTabComplete(tabId, timeoutMs = 8000) {
  return new Promise(resolve => {
    let settled = false;

    function finish(value) {
      if (settled) {
        return;
      }

      cleanup();
      resolve(value);
    }

    const timeoutId = globalThis.setTimeout(() => {
      chrome.tabs.get(tabId, tab => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          finish(false);
          return;
        }

        finish(Boolean(tab && tab.status === "complete"));
      });
    }, timeoutMs);

    function handleUpdated(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") {
        return;
      }

      finish(true);
    }

    function cleanup() {
      if (settled) {
        return;
      }

      settled = true;
      globalThis.clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
    }

    chrome.tabs.onUpdated.addListener(handleUpdated);
    chrome.tabs.get(tabId, tab => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        return;
      }

      if (tab && tab.status === "complete") {
        finish(true);
      }
    });
  });
}
