import { BACKGROUND_MESSAGE_TYPES, STORAGE_KEY, TASK_STORAGE_KEY } from "../shared/constants.js";
import { getBackgroundTaskStatus, isBackgroundTaskBusy } from "../shared/background-task.js";
import { loadActiveTask, loadStoredSource, subscribeToStorageChanges } from "../shared/storage.js";

const copyButton = document.getElementById("copy-source");
const insertButton = document.getElementById("insert-source");
const copyPreviewButton = document.getElementById("copy-preview");
const statusEl = document.getElementById("status");
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

  renderPreview(null);
  renderTaskStatus();
  syncButtons();

  state.unsubscribe = subscribeToStorageChanges(changes => {
    if (Object.prototype.hasOwnProperty.call(changes, STORAGE_KEY)) {
      state.storedSource = changes[STORAGE_KEY].newValue || null;
      debugPopup("Stored source updated", {
        hasMarkdown: Boolean(state.storedSource && state.storedSource.markdown),
        markdownLength: String((state.storedSource && state.storedSource.markdown) || "").length
      });
      renderPreview(state.storedSource);
      syncButtons();
    }

    if (Object.prototype.hasOwnProperty.call(changes, TASK_STORAGE_KEY)) {
      state.activeTask = changes[TASK_STORAGE_KEY].newValue || null;
      debugPopup("Active task updated", state.activeTask);
      renderTaskStatus();
      syncButtons();
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

function setStatus(message, type = "info") {
  if (!statusEl) {
    return;
  }

  statusEl.textContent = message;
  statusEl.className = type === "info" ? "" : type;
}

function renderTaskStatus() {
  const status = getBackgroundTaskStatus(state.activeTask);
  setStatus(status.message, status.type);
}

function truncate(text, maxLength = 120) {
  if (!text) {
    return "-";
  }

  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function formatDate(isoDate) {
  if (!isoDate) {
    return "-";
  }

  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString("ru-RU");
}

function setDocumentMeta(label, href) {
  if (!documentEl) {
    return;
  }

  const safeLabel = label || "-";
  const safeHref = String(href || "").trim();
  documentEl.textContent = safeLabel;
  documentEl.title = safeHref || safeLabel;
  documentEl.href = safeHref || "#";
  documentEl.classList.toggle("is-empty", !safeHref || safeLabel === "-");
}

function renderPreview(data) {
  if (!data) {
    if (previewEl) {
      previewEl.textContent = "Пока ничего не скопировано.";
    }
    if (sourceEl) {
      sourceEl.textContent = "-";
    }
    setDocumentMeta("-", "");
    if (timeEl) {
      timeEl.textContent = "-";
    }
    return;
  }

  if (previewEl) {
    previewEl.textContent = data.markdown || "Пустой результат.";
  }
  if (sourceEl) {
    sourceEl.textContent = truncate(data.providerLabel || data.provider || "-", 48);
  }
  setDocumentMeta(truncate(data.title || data.sourceSlug || data.documentId || "-", 72), data.sourceUrl || "");
  if (timeEl) {
    timeEl.textContent = formatDate(data.capturedAt);
  }
}

function hasStoredPreview() {
  return Boolean(state.storedSource && String(state.storedSource.markdown || "").trim());
}

function syncButtons() {
  const disableActions = state.isRequestPending || isBackgroundTaskBusy(state.activeTask);

  if (copyButton) {
    copyButton.disabled = disableActions;
  }

  if (insertButton) {
    insertButton.disabled = disableActions;
  }

  if (copyPreviewButton) {
    copyPreviewButton.disabled = !hasStoredPreview();
  }
}

function humanizeRuntimeError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/Receiving end does not exist/i.test(message) || /Could not establish connection/i.test(message)) {
    return "Перезагрузите расширение: background worker еще не подключен.";
  }

  return message || "Неизвестная ошибка.";
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
    renderPreview(state.storedSource);
  }

  if (taskResult.status === "fulfilled") {
    state.activeTask = taskResult.value && taskResult.value.task ? taskResult.value.task : null;
    debugPopup("Initial task loaded", state.activeTask);
    renderTaskStatus();
  } else {
    state.activeTask = null;
    debugPopup("Initial task load failed", taskResult.reason);
    setStatus(humanizeRuntimeError(taskResult.reason), "warning");
  }

  syncButtons();
}

async function startBackgroundAction(messageType) {
  if (state.isRequestPending || isBackgroundTaskBusy(state.activeTask)) {
    renderTaskStatus();
    return;
  }

  state.isRequestPending = true;
  setStatus(
    messageType === BACKGROUND_MESSAGE_TYPES.START_COPY_SOURCE ? "Запускаю копирование..." : "Запускаю вставку...",
    "syncing"
  );
  syncButtons();

  try {
    const response = await sendRuntimeMessage({ type: messageType });

    if (response && response.accepted) {
      state.activeTask = response.task || null;
      debugPopup("Background task accepted", state.activeTask);
      renderTaskStatus();
      return;
    }

    if (response && response.task && isBackgroundTaskBusy(response.task)) {
      state.activeTask = response.task;
      debugPopup("Background task rejected because another task is active", state.activeTask);
      renderTaskStatus();
      return;
    }

    setStatus((response && response.error) || "Не удалось запустить фоновую задачу.", "error");
  } catch (error) {
    setStatus(humanizeRuntimeError(error), "error");
  } finally {
    state.isRequestPending = false;
    syncButtons();
  }
}

async function copyPreviewToClipboard() {
  const text = hasStoredPreview() ? String(state.storedSource.markdown || "").trim() : "";
  if (!text) {
    setStatus("Пока нечего копировать.", "warning");
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    setStatus("Preview скопирован в буфер обмена.", "success");
  } catch {
    setStatus("Не удалось скопировать preview.", "error");
  }
}
