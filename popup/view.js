import { getBackgroundTaskStatus, isBackgroundTaskBusy } from "../shared/background-task.js";

export function createPopupView({ elements, state }) {
  const {
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
  } = elements;

  function setStatus(message, type = "info") {
    if (!statusEl) {
      return;
    }

    if (statusTextEl) {
      statusTextEl.textContent = message;
    } else {
      statusEl.textContent = message;
    }
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
    const showCancel = isBackgroundTaskBusy(state.activeTask);

    if (copyButton) {
      copyButton.disabled = disableActions;
    }

    if (insertButton) {
      insertButton.disabled = disableActions;
    }

    if (copyPreviewButton) {
      copyPreviewButton.disabled = !hasStoredPreview();
    }

    if (cancelTaskButton) {
      cancelTaskButton.hidden = !showCancel;
      cancelTaskButton.disabled = state.isRequestPending || !showCancel;
    }
  }

  function humanizeRuntimeError(error) {
    const message = error instanceof Error ? error.message : String(error || "");
    if (/Receiving end does not exist/i.test(message) || /Could not establish connection/i.test(message)) {
      return "Перезагрузите расширение: background worker еще не подключен.";
    }

    if (/message (?:channel|port) closed before a response was received/i.test(message)) {
      return "Расширение не дождалось ответа. Повторите действие после перезагрузки страницы.";
    }

    return message || "Неизвестная ошибка.";
  }

  return {
    setStatus,
    renderTaskStatus,
    renderPreview,
    hasStoredPreview,
    syncButtons,
    humanizeRuntimeError
  };
}
