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
    if (!message || (message.type !== shared.MESSAGE_TYPES.APPEND_TEXT_BLOCKS && message.type !== shared.MESSAGE_TYPES.UPLOAD_THEORY_RESOURCE)) {
      return undefined;
    }

    const isAppendRequest = message.type === shared.MESSAGE_TYPES.APPEND_TEXT_BLOCKS;
    const markdown = isAppendRequest && typeof message.markdown === "string" ? message.markdown : "";
    const timeoutMs = isAppendRequest
      ? Math.min(180000, Math.max(30000, Math.max(1, shared.compileTheoryBlocks(markdown).length) * 1500 + 10000))
      : 60000;
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
      globalThis.removeEventListener(
        isAppendRequest ? shared.EVENT_TYPES.THEORY_APPEND_RESPONSE : shared.EVENT_TYPES.THEORY_UPLOAD_RESOURCE_RESPONSE,
        onResponse
      );
    }

    globalThis.addEventListener(
      isAppendRequest ? shared.EVENT_TYPES.THEORY_APPEND_RESPONSE : shared.EVENT_TYPES.THEORY_UPLOAD_RESOURCE_RESPONSE,
      onResponse
    );
    globalThis.dispatchEvent(
      new CustomEvent(isAppendRequest ? shared.EVENT_TYPES.THEORY_APPEND_REQUEST : shared.EVENT_TYPES.THEORY_UPLOAD_RESOURCE_REQUEST, {
        detail: {
          requestId,
          markdown,
          fileName: typeof message.fileName === "string" ? message.fileName : "",
          mimeType: typeof message.mimeType === "string" ? message.mimeType : "",
          bytesBase64: typeof message.bytesBase64 === "string" ? message.bytesBase64 : "",
          expectedBridgeVersion: message.expectedBridgeVersion
        }
      })
    );

    return true;
  });
})();
