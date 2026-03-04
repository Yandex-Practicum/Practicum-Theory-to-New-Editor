import { BACKGROUND_MESSAGE_TYPES, STORAGE_KEY, TASK_STORAGE_KEY } from "../shared/constants.js";
import { isBackgroundTaskBusy } from "../shared/background-task.js";
import { loadActiveTask, loadStoredSource, subscribeToStorageChanges } from "../shared/storage.js";
import { createPopupView } from "./view.js";

const copyButton = document.getElementById("copy-source");
const insertButton = document.getElementById("insert-source");
const copyPreviewButton = document.getElementById("copy-preview");
const statusEl = document.getElementById("status");
const statusTextEl = document.getElementById("status-text");
const cancelTaskButton = document.getElementById("cancel-task");
const previewEl = document.getElementById("preview");
const sourceEl = document.getElementById("meta-source");
const documentEl = document.getElementById("meta-document");
const timeEl = document.getElementById("meta-time");

const state = {
  storedSource: null,
  activeTask: null,
  isRequestPending: false,
  unsubscribe: null
};

const view = createPopupView({
  elements: {
    copyButton,
    insertButton,
    copyPreviewButton,
    statusEl,
    statusTextEl,
    cancelTaskButton,
    previewEl,
    sourceEl,
    documentEl,
    timeEl
  },
  state
});

function debugPopup(message, details) {
  try {
    console.info(`[PH popup] ${message}`, details === undefined ? "" : details);
  } catch {
    // Debug logging must not break the popup.
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  if (copyButton) {
    copyButton.addEventListener("click", () => {
      startBackgroundAction(BACKGROUND_MESSAGE_TYPES.START_COPY_SOURCE);
    });
  }

  if (insertButton) {
    insertButton.addEventListener("click", () => {
      startBackgroundAction(BACKGROUND_MESSAGE_TYPES.START_INSERT_SOURCE);
    });
  }

  if (copyPreviewButton) {
    copyPreviewButton.addEventListener("click", () => {
      copyPreviewToClipboard();
    });
  }

  if (cancelTaskButton) {
    cancelTaskButton.addEventListener("click", () => {
      cancelBackgroundTask();
    });
  }

  view.renderPreview(null);
  view.renderTaskStatus();
  view.syncButtons();

  state.unsubscribe = subscribeToStorageChanges(changes => {
    if (Object.prototype.hasOwnProperty.call(changes, STORAGE_KEY)) {
      state.storedSource = changes[STORAGE_KEY].newValue || null;
      debugPopup("Stored source updated", {
        hasMarkdown: Boolean(state.storedSource && state.storedSource.markdown),
        markdownLength: String((state.storedSource && state.storedSource.markdown) || "").length
      });
      view.renderPreview(state.storedSource);
      view.syncButtons();
    }

    if (Object.prototype.hasOwnProperty.call(changes, TASK_STORAGE_KEY)) {
      state.activeTask = changes[TASK_STORAGE_KEY].newValue || null;
      debugPopup("Active task updated", state.activeTask);
      view.renderTaskStatus();
      view.syncButtons();
    }
  });

  await hydratePopup();
});

window.addEventListener("unload", () => {
  if (typeof state.unsubscribe === "function") {
    state.unsubscribe();
    state.unsubscribe = null;
  }
});

async function sendRuntimeMessage(message) {
  debugPopup("Sending runtime message", message);
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      debugPopup("Runtime message response", response);
      resolve(response);
    });
  });
}

async function hydratePopup() {
  async function loadInitialTask() {
    try {
      return await sendRuntimeMessage({ type: BACKGROUND_MESSAGE_TYPES.GET_ACTIVE_TASK });
    } catch {
      return {
        task: await loadActiveTask()
      };
    }
  }

  const [storedResult, taskResult] = await Promise.allSettled([
    loadStoredSource(),
    loadInitialTask()
  ]);

  if (storedResult.status === "fulfilled") {
    state.storedSource = storedResult.value || null;
    debugPopup("Initial stored source loaded", {
      hasMarkdown: Boolean(state.storedSource && state.storedSource.markdown),
      markdownLength: String((state.storedSource && state.storedSource.markdown) || "").length
    });
    view.renderPreview(state.storedSource);
  }

  if (taskResult.status === "fulfilled") {
    state.activeTask = taskResult.value && taskResult.value.task ? taskResult.value.task : null;
    debugPopup("Initial task loaded", state.activeTask);
    view.renderTaskStatus();
  } else {
    state.activeTask = null;
    debugPopup("Initial task load failed", taskResult.reason);
    view.setStatus(view.humanizeRuntimeError(taskResult.reason), "warning");
  }

  view.syncButtons();
}

async function startBackgroundAction(messageType) {
  if (state.isRequestPending || isBackgroundTaskBusy(state.activeTask)) {
    view.renderTaskStatus();
    return;
  }

  state.isRequestPending = true;
  view.setStatus(
    messageType === BACKGROUND_MESSAGE_TYPES.START_COPY_SOURCE ? "Запускаю копирование..." : "Запускаю вставку...",
    "syncing"
  );
  view.syncButtons();

  try {
    const response = await sendRuntimeMessage({ type: messageType });

    if (response && response.accepted) {
      state.activeTask = response.task || null;
      debugPopup("Background task accepted", state.activeTask);
      view.renderTaskStatus();
      return;
    }

    if (response && response.task && isBackgroundTaskBusy(response.task)) {
      state.activeTask = response.task;
      debugPopup("Background task rejected because another task is active", state.activeTask);
      view.renderTaskStatus();
      return;
    }

    view.setStatus((response && response.error) || "Не удалось запустить фоновую задачу.", "error");
  } catch (error) {
    view.setStatus(view.humanizeRuntimeError(error), "error");
  } finally {
    state.isRequestPending = false;
    view.syncButtons();
  }
}

async function cancelBackgroundTask() {
  if (state.isRequestPending || !isBackgroundTaskBusy(state.activeTask)) {
    view.renderTaskStatus();
    return;
  }

  state.isRequestPending = true;
  view.setStatus("Прерываю задачу...", "warning");
  view.syncButtons();

  try {
    const response = await sendRuntimeMessage({ type: BACKGROUND_MESSAGE_TYPES.CANCEL_ACTIVE_TASK });
    state.activeTask = response && response.task ? response.task : null;
    view.renderTaskStatus();
  } catch (error) {
    view.setStatus(view.humanizeRuntimeError(error), "error");
  } finally {
    state.isRequestPending = false;
    view.syncButtons();
  }
}

async function copyPreviewToClipboard() {
  const text = view.hasStoredPreview() ? String(state.storedSource.markdown || "").trim() : "";
  if (!text) {
    view.setStatus("Пока нечего копировать.", "warning");
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    view.setStatus("Preview скопирован в буфер обмена.", "success");
  } catch {
    view.setStatus("Не удалось скопировать preview.", "error");
  }
}
