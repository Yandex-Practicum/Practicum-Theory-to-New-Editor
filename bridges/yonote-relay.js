(function initYonoteRelayBridge() {
  const shared = globalThis.PracticumHelperBridgeShared;
  if (!shared || !shared.markBridgeInitialized("yonote-relay")) {
    return;
  }

  chrome.runtime.onConnect.addListener(port => {
    if (!port || typeof port.name !== "string" || !port.name.startsWith("ph-keepalive:")) {
      return;
    }

    port.onDisconnect.addListener(() => {});
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== shared.MESSAGE_TYPES.COPY_FROM_YONOTE) {
      return undefined;
    }

    const timeoutMs =
      message.preferredMode === "native-export" || message.preferredMode === "native-export-context"
        ? 45000
        : 15000;
    const requestId = shared.createRequestId();
    const timeoutId = globalThis.setTimeout(() => {
      cleanup();
      sendResponse(
        shared.createBridgeEnvelope("yonote", {
          success: false,
          error: "Yonote bridge не ответил вовремя."
        })
      );
    }, timeoutMs);

    function onResponse(event) {
      const detail = event.detail || {};
      if (detail.requestId !== requestId) {
        return;
      }

      cleanup();

      if (shared.hasMatchingBridgeEnvelope(detail.result, "yonote")) {
        sendResponse(detail.result);
        return;
      }

      sendResponse(
        shared.createBridgeEnvelope("yonote", {
          success: false,
          error: "На вкладке работает устаревший bridge. Обновите саму страницу Yonote."
        })
      );
    }

    function cleanup() {
      globalThis.clearTimeout(timeoutId);
      globalThis.removeEventListener(shared.EVENT_TYPES.YONOTE_COPY_RESPONSE, onResponse);
    }

    globalThis.addEventListener(shared.EVENT_TYPES.YONOTE_COPY_RESPONSE, onResponse);
    globalThis.dispatchEvent(
      new CustomEvent(shared.EVENT_TYPES.YONOTE_COPY_REQUEST, {
        detail: {
          requestId,
          preferredMode: message.preferredMode,
          expectedBridgeVersion: message.expectedBridgeVersion
        }
      })
    );

    return true;
  });
})();
