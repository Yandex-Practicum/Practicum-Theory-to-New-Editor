(function initTheoryRelayBridge() {
  const shared = globalThis.PracticumHelperBridgeShared;
  if (!shared || !shared.markBridgeInitialized("theory-relay")) {
    return;
  }

  chrome.runtime.onConnect.addListener(port => {
    if (!port || typeof port.name !== "string" || !port.name.startsWith("ph-keepalive:")) {
      return;
    }

    port.onDisconnect.addListener(() => {});
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== shared.MESSAGE_TYPES.APPEND_TEXT_BLOCKS) {
      return undefined;
    }

    const markdown = typeof message.markdown === "string" ? message.markdown : "";
    const estimatedBlocks = Math.max(1, shared.compileTheoryBlocks(markdown).length);
    const timeoutMs = Math.min(180000, Math.max(30000, estimatedBlocks * 1500 + 10000));
    const requestId = shared.createRequestId();
    const timeoutId = globalThis.setTimeout(() => {
      cleanup();
      sendResponse(
        shared.createBridgeEnvelope("theory", {
          success: false,
          error: "Praktikum bridge не ответил вовремя."
        })
      );
    }, timeoutMs);

    function onResponse(event) {
      const detail = event.detail || {};
      if (detail.requestId !== requestId) {
        return;
      }

      cleanup();

      if (shared.hasMatchingBridgeEnvelope(detail.result, "theory")) {
        sendResponse(detail.result);
        return;
      }

      sendResponse(
        shared.createBridgeEnvelope("theory", {
          success: false,
          error: "На вкладке работает устаревший bridge. Обновите саму страницу теории."
        })
      );
    }

    function cleanup() {
      globalThis.clearTimeout(timeoutId);
      globalThis.removeEventListener(shared.EVENT_TYPES.THEORY_APPEND_RESPONSE, onResponse);
    }

    globalThis.addEventListener(shared.EVENT_TYPES.THEORY_APPEND_RESPONSE, onResponse);
    globalThis.dispatchEvent(
      new CustomEvent(shared.EVENT_TYPES.THEORY_APPEND_REQUEST, {
        detail: {
          requestId,
          markdown,
          expectedBridgeVersion: message.expectedBridgeVersion
        }
      })
    );

    return true;
  });
})();
