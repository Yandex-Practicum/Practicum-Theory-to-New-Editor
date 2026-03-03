import { BRIDGE_KINDS, EXT_BUILD } from "./constants.js";

const MISSING_RECEIVER_RE = /Receiving end does not exist|Could not establish connection/i;

export function isMissingReceiverError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return MISSING_RECEIVER_RE.test(message);
}

export function isBridgeEnvelopeValid(response, { expectedKind, expectedBridgeVersion = EXT_BUILD } = {}) {
  return Boolean(
    response &&
      typeof response === "object" &&
      response.bridgeVersion &&
      response.bridgeVersion === expectedBridgeVersion &&
      response.bridgeKind === expectedKind
  );
}

export function getStaleBridgeErrorMessage(kind) {
  if (kind === BRIDGE_KINDS.THEORY) {
    return "На вкладке работает устаревший bridge. Обновите саму страницу теории.";
  }

  return "На вкладке работает устаревший bridge. Обновите саму страницу Yonote.";
}

async function attemptSend({ tabId, message, sendMessage }) {
  try {
    const response = await sendMessage(tabId, message);
    return {
      type: "response",
      response
    };
  } catch (error) {
    return {
      type: isMissingReceiverError(error) ? "missing_receiver" : "runtime_error",
      error
    };
  }
}

export async function sendMessageWithBridgeFreshness({
  tabId,
  kind,
  message,
  sendMessage,
  injectBridge,
  expectedBridgeVersion = EXT_BUILD
}) {
  const validationOptions = {
    expectedKind: kind,
    expectedBridgeVersion
  };

  const firstAttempt = await attemptSend({ tabId, message, sendMessage });
  if (firstAttempt.type === "response" && isBridgeEnvelopeValid(firstAttempt.response, validationOptions)) {
    return firstAttempt.response;
  }

  await injectBridge(tabId, kind);

  const secondAttempt = await attemptSend({ tabId, message, sendMessage });
  if (secondAttempt.type === "response" && isBridgeEnvelopeValid(secondAttempt.response, validationOptions)) {
    return secondAttempt.response;
  }

  if (secondAttempt.type === "runtime_error") {
    throw secondAttempt.error;
  }

  throw new Error(getStaleBridgeErrorMessage(kind));
}
