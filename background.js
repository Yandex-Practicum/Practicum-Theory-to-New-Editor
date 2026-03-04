import { BRIDGE_KINDS, BACKGROUND_MESSAGE_TYPES } from "./shared/constants.js";
import { sendMessageWithBridgeFreshness } from "./shared/bridge-freshness.js";
import { createBackgroundController, isBackgroundRuntimeMessage } from "./shared/background-controller.js";
import { requestYonoteNativeExport } from "./shared/native-export.js";
import { clearSourceAssets, loadSourceAssetBytes, replaceSourceAssets } from "./shared/source-assets.js";
import { loadActiveTask, loadStoredSource, saveActiveTask, saveStoredSource } from "./shared/storage.js";
import { connectToTab, executeFilesInTab, getActiveTab, reloadTab, sendMessageToTab } from "./shared/tabs.js";

async function injectBridgeFiles(tabId, kind) {
  if (kind === BRIDGE_KINDS.YONOTE) {
    await executeFilesInTab(tabId, ["bridges/common.js", "bridges/yonote-main.js"], "MAIN");
    await executeFilesInTab(tabId, ["bridges/common.js", "bridges/yonote-relay.js"], "ISOLATED");
    return;
  }

  if (kind === BRIDGE_KINDS.WIKI) {
    await executeFilesInTab(tabId, ["bridges/common.js", "bridges/wiki-main.js"], "MAIN");
    await executeFilesInTab(tabId, ["bridges/common.js", "bridges/wiki-relay.js"], "ISOLATED");
    return;
  }

  if (kind === BRIDGE_KINDS.THEORY) {
    await executeFilesInTab(tabId, ["bridges/common.js", "bridges/theory-main.js"], "MAIN");
    await executeFilesInTab(tabId, ["bridges/common.js", "bridges/theory-relay.js"], "ISOLATED");
    return;
  }

  throw new Error("Неизвестный тип bridge-инъекции.");
}

async function sendBridgeMessage({ tabId, kind, message }) {
  return sendMessageWithBridgeFreshness({
    tabId,
    kind,
    message,
    sendMessage: sendMessageToTab,
    injectBridge: injectBridgeFiles
  });
}

async function fetchSourceAssetBytes(asset) {
  const assetUrl = String((asset && (asset.path || asset.id)) || "").trim();
  if (!assetUrl) {
    return null;
  }

  try {
    const response = await fetch(assetUrl, {
      credentials: "include"
    });
    if (!response.ok) {
      return null;
    }

    const bytes = await response.arrayBuffer();
    const mimeType = String(response.headers.get("content-type") || "")
      .split(";")[0]
      .trim();

    return {
      bytes,
      mimeType: mimeType || String((asset && asset.mimeType) || "").trim(),
      byteLength: Number(bytes.byteLength || 0)
    };
  } catch {
    return null;
  }
}

const backgroundController = createBackgroundController({
  loadActiveTask,
  saveActiveTask,
  loadStoredSource,
  saveStoredSource,
  replaceSourceAssets,
  loadSourceAssetBytes,
  clearSourceAssets,
  fetchSourceAssetBytes,
  getActiveTab,
  sendBridgeMessage,
  requestNativeExport: requestYonoteNativeExport,
  openKeepAlivePort: ({ tabId, kind, taskId }) => connectToTab(tabId, `ph-keepalive:${kind}:${taskId}`),
  reloadTab
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isBackgroundRuntimeMessage(message)) {
    return undefined;
  }

  backgroundController
    .handleRuntimeMessage(message)
    .then(response => {
      sendResponse(response);
    })
    .catch(error => {
      if (message.type === BACKGROUND_MESSAGE_TYPES.GET_ACTIVE_TASK) {
        sendResponse({ task: null });
        return;
      }

      sendResponse({
        accepted: false,
        error: error instanceof Error ? error.message : "Не удалось запустить фоновую задачу."
      });
    });

  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  void backgroundController.handleTabUpdated(tabId, changeInfo);
});
