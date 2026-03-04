(function initWikiRelayBridge() {
  const shared = globalThis.PracticumHelperBridgeShared;
  if (!shared || !shared.markBridgeInitialized("wiki-relay")) {
    return;
  }

  chrome.runtime.onConnect.addListener(port => {
    if (!port || typeof port.name !== "string" || !port.name.startsWith("ph-keepalive:")) {
      return;
    }

    port.onDisconnect.addListener(() => {});
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== shared.MESSAGE_TYPES.COPY_FROM_WIKI) {
      return undefined;
    }

    const requestId = shared.createRequestId();
    const timeoutId = globalThis.setTimeout(() => {
      cleanup();
      sendResponse(
        shared.createBridgeEnvelope("wiki", {
          success: false,
          error: "Wiki bridge не ответил вовремя."
        })
      );
    }, 15000);

    function onResponse(event) {
      const detail = event.detail || {};
      if (detail.requestId !== requestId) {
        return;
      }

      cleanup();

      if (shared.hasMatchingBridgeEnvelope(detail.result, "wiki")) {
        sendResponse(detail.result);
        return;
      }

      sendResponse(
        shared.createBridgeEnvelope("wiki", {
          success: false,
          error: "На вкладке работает устаревший bridge. Обновите саму страницу wiki."
        })
      );
    }

    function cleanup() {
      globalThis.clearTimeout(timeoutId);
      globalThis.removeEventListener(shared.EVENT_TYPES.WIKI_COPY_RESPONSE, onResponse);
    }

    globalThis.addEventListener(shared.EVENT_TYPES.WIKI_COPY_RESPONSE, onResponse);
    globalThis.dispatchEvent(
      new CustomEvent(shared.EVENT_TYPES.WIKI_COPY_REQUEST, {
        detail: {
          requestId,
          expectedBridgeVersion: message.expectedBridgeVersion
        }
      })
    );

    return true;
  });
})();
