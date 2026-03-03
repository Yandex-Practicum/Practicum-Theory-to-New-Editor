import {
  BACKGROUND_MESSAGE_TYPES,
  BRIDGE_KINDS,
  EXT_BUILD,
  MESSAGE_TYPES,
  getSourceProvider,
  isTheoryUrl
} from "./constants.js";
import {
  BACKGROUND_TASK_KINDS,
  BACKGROUND_TASK_STAGES,
  createBackgroundTask,
  isBackgroundTaskBusy,
  stampBackgroundTask
} from "./background-task.js";

const RELOAD_TIMEOUT_MS = 15000;
const DEBUG_LOG_LIMIT = 25;
const TASK_STALE_TIMEOUT_MS = 15000;
const ACTIVE_RUNTIME_MESSAGE_TYPES = new Set(Object.values(BACKGROUND_MESSAGE_TYPES));

function defaultScheduleTask(callback) {
  callback();
}

function toErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/Receiving end does not exist/i.test(message) || /Could not establish connection/i.test(message)) {
    return "Перезагрузите страницу: bridge-скрипт еще не подключен.";
  }

  return message || "Неизвестная ошибка.";
}

function buildBusyTaskError() {
  return "Фоновая задача уже выполняется.";
}

function normalizeDate(input) {
  const date = input instanceof Date ? input : new Date(input);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function estimateBlockCount(markdown) {
  return String(markdown || "")
    .trim()
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean).length;
}

function normalizeHeadingText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function ensureLeadingTitleHeading(title, markdown) {
  const normalizedTitle = String(title || "").trim();
  const body = String(markdown || "").replace(/\r\n?/g, "\n").trim();

  if (!normalizedTitle) {
    return body;
  }

  const match = body.match(/^#\s+(.+)$/m);
  if (match && normalizeHeadingText(match[1]) === normalizeHeadingText(normalizedTitle)) {
    return body;
  }

  return body ? `# ${normalizedTitle}\n\n${body}` : `# ${normalizedTitle}`;
}

function buildCopyPayload(response, provider, fallbackCapturedAt) {
  const payload = response && response.payload ? response.payload : null;
  if (!payload || !payload.markdown) {
    throw new Error(response && response.error ? response.error : "Не удалось получить markdown из источника.");
  }

  return {
    ...payload,
    provider: provider.id,
    providerLabel: payload.providerLabel || provider.label,
    bridgeVersion: payload.bridgeVersion || response.bridgeVersion || EXT_BUILD,
    capturedAt: payload.capturedAt || normalizeDate(fallbackCapturedAt).toISOString(),
    diagnostics: payload.diagnostics || response.diagnostics || {}
  };
}

function buildCopyPayloadFromNativeExport(nativeExportResult, nativeExportContext, response, provider, fallbackCapturedAt) {
  const markdown = ensureLeadingTitleHeading(
    nativeExportContext && nativeExportContext.title ? nativeExportContext.title : "",
    nativeExportResult && nativeExportResult.markdown ? nativeExportResult.markdown : ""
  );

  if (!markdown) {
    throw new Error("Yonote export вернул пустой markdown.");
  }

  return {
    title: String((nativeExportContext && nativeExportContext.title) || ""),
    markdown,
    sourceUrl: String((nativeExportContext && nativeExportContext.sourceUrl) || ""),
    sourceSlug: String((nativeExportContext && nativeExportContext.sourceSlug) || ""),
    documentId: String((nativeExportContext && nativeExportContext.documentId) || ""),
    collectionId: String((nativeExportContext && nativeExportContext.collectionId) || ""),
    revision: Number((nativeExportContext && nativeExportContext.revision) || 0),
    provider: provider.id,
    providerLabel: provider.label,
    sourceMode: "Yonote native export",
    bridgeVersion: (response && response.bridgeVersion) || EXT_BUILD,
    capturedAt: normalizeDate(fallbackCapturedAt).toISOString(),
    blockCount: estimateBlockCount(markdown),
    diagnostics: (response && response.diagnostics) || {}
  };
}

export function isBackgroundRuntimeMessage(message) {
  return Boolean(message && ACTIVE_RUNTIME_MESSAGE_TYPES.has(message.type));
}

export function createBackgroundController(dependencies) {
  const deps = {
    loadActiveTask: dependencies.loadActiveTask,
    saveActiveTask: dependencies.saveActiveTask,
    loadStoredSource: dependencies.loadStoredSource,
    saveStoredSource: dependencies.saveStoredSource,
    getActiveTab: dependencies.getActiveTab,
    sendBridgeMessage: dependencies.sendBridgeMessage,
    requestNativeExport: dependencies.requestNativeExport || null,
    reloadTab: dependencies.reloadTab,
    setTimeoutFn: dependencies.setTimeoutFn || globalThis.setTimeout.bind(globalThis),
    clearTimeoutFn: dependencies.clearTimeoutFn || globalThis.clearTimeout.bind(globalThis),
    scheduleTask: dependencies.scheduleTask || defaultScheduleTask,
    now: dependencies.now || (() => new Date())
  };

  const reloadTimeouts = new Map();
  const keepAlivePorts = new Map();

  function createDebugLine(message, details) {
    const suffix =
      details === undefined
        ? ""
        : ` ${typeof details === "string" ? details : JSON.stringify(details)}`;
    return `${normalizeDate(deps.now()).toISOString()} ${message}${suffix}`;
  }

  async function appendTaskDebug(taskId, message, details) {
    const line = createDebugLine(message, details);
    try {
      console.info(`[PH background][${taskId}] ${message}`, details === undefined ? "" : details);
    } catch {
      // Debug logging must not break the task flow.
    }

    const current = await deps.loadActiveTask();
    if (!current || current.id !== taskId) {
      return null;
    }

    const currentLog = Array.isArray(current.debugLog) ? current.debugLog : [];
    const nextLog = [...currentLog, line].slice(-DEBUG_LOG_LIMIT);
    const nextTask = stampBackgroundTask(
      current,
      {
        debugLog: nextLog
      },
      deps.now()
    );

    await deps.saveActiveTask(nextTask);
    return nextTask;
  }

  async function recoverStaleTaskIfNeeded(task) {
    if (!task || typeof task !== "object") {
      return task || null;
    }

    const updatedAt = task.updatedAt ? normalizeDate(task.updatedAt) : null;
    const ageMs = updatedAt ? Math.max(0, normalizeDate(deps.now()).getTime() - updatedAt.getTime()) : 0;

    if (
      (task.stage === BACKGROUND_TASK_STAGES.STARTING || task.stage === BACKGROUND_TASK_STAGES.RUNNING) &&
      ageMs >= TASK_STALE_TIMEOUT_MS
    ) {
      const recovered = stampBackgroundTask(
        task,
        {
          stage: BACKGROUND_TASK_STAGES.ERROR,
          message: "Фоновая задача прервалась. Повторите действие на открытой вкладке.",
          error: "Background worker was interrupted."
        },
        deps.now()
      );
      await deps.saveActiveTask(recovered);
      try {
        console.info("[PH background] Recovered stale task as error", {
          taskId: task.id,
          ageMs,
          stage: task.stage
        });
      } catch {
        // Best-effort debug log.
      }
      return recovered;
    }

    if (
      task.stage === BACKGROUND_TASK_STAGES.RELOADING &&
      task.reloadDeadlineAt &&
      normalizeDate(task.reloadDeadlineAt).getTime() <= normalizeDate(deps.now()).getTime()
    ) {
      const recovered = stampBackgroundTask(
        task,
        {
          stage: BACKGROUND_TASK_STAGES.SUCCESS,
          message: "Перезагрузка запущена. Если контент не виден, обновите вкладку вручную.",
          result: {
            ...(task.result || {}),
            reloadTimedOut: true
          }
        },
        deps.now()
      );
      await deps.saveActiveTask(recovered);
      try {
        console.info("[PH background] Recovered stale reload task as soft success", {
          taskId: task.id
        });
      } catch {
        // Best-effort debug log.
      }
      return recovered;
    }

    return task;
  }

  function releaseKeepAlive(taskId, { disconnect = true } = {}) {
    const entry = keepAlivePorts.get(taskId);
    if (!entry) {
      return;
    }

    keepAlivePorts.delete(taskId);

    try {
      if (entry.onDisconnect && entry.port && entry.port.onDisconnect) {
        entry.port.onDisconnect.removeListener(entry.onDisconnect);
      }
    } catch {
      // Best-effort cleanup.
    }

    if (!disconnect) {
      return;
    }

    try {
      if (entry.port && typeof entry.port.disconnect === "function") {
        entry.port.disconnect();
      }
    } catch {
      // Best-effort cleanup.
    }
  }

  async function attachKeepAlive(taskId, tabId, kind, disconnectMessage) {
    if (typeof deps.openKeepAlivePort !== "function") {
      return null;
    }

    releaseKeepAlive(taskId);

    let port;
    try {
      port = deps.openKeepAlivePort({ tabId, kind, taskId });
    } catch (error) {
      throw new Error(toErrorMessage(error));
    }

    if (!port || !port.onDisconnect) {
      return null;
    }

    const onDisconnect = () => {
      keepAlivePorts.delete(taskId);
      void appendTaskDebug(taskId, "Keepalive port disconnected", {
        tabId,
        kind
      });
      void failTask(taskId, new Error(disconnectMessage));
    };

    keepAlivePorts.set(taskId, {
      port,
      onDisconnect
    });
    port.onDisconnect.addListener(onDisconnect);
    await appendTaskDebug(taskId, "Keepalive port connected", {
      tabId,
      kind
    });

    return port;
  }

  async function replaceCurrentTask(taskId, patch) {
    const current = await deps.loadActiveTask();
    if (!current || current.id !== taskId) {
      return null;
    }

    const nextTask = stampBackgroundTask(current, patch, deps.now());
    await deps.saveActiveTask(nextTask);
    return nextTask;
  }

  function clearReloadTimeout(taskId) {
    if (!reloadTimeouts.has(taskId)) {
      return;
    }

    deps.clearTimeoutFn(reloadTimeouts.get(taskId));
    reloadTimeouts.delete(taskId);
  }

  async function finalizeReloadSuccess(taskId, message, didTimeout = false) {
    clearReloadTimeout(taskId);
    await appendTaskDebug(taskId, "Finishing reload wait", {
      didTimeout,
      message
    });

    const current = await deps.loadActiveTask();
    if (
      !current ||
      current.id !== taskId ||
      current.kind !== BACKGROUND_TASK_KINDS.INSERT_SOURCE ||
      current.stage !== BACKGROUND_TASK_STAGES.RELOADING
    ) {
      return null;
    }

    const nextResult = {
      ...(current.result || {}),
      reloadTimedOut: didTimeout
    };

    const nextTask = stampBackgroundTask(
      current,
      {
        stage: BACKGROUND_TASK_STAGES.SUCCESS,
        message,
        result: nextResult
      },
      deps.now()
    );

    await deps.saveActiveTask(nextTask);
    return nextTask;
  }

  function scheduleReloadTimeout(taskId) {
    clearReloadTimeout(taskId);
    void appendTaskDebug(taskId, "Scheduling reload timeout", {
      timeoutMs: RELOAD_TIMEOUT_MS
    });

    const timeoutHandle = deps.setTimeoutFn(() => {
      reloadTimeouts.delete(taskId);
      void appendTaskDebug(taskId, "Reload timeout fired");
      void finalizeReloadSuccess(
        taskId,
        "Перезагрузка запущена. Если контент не виден, обновите вкладку вручную.",
        true
      );
    }, RELOAD_TIMEOUT_MS);

    reloadTimeouts.set(taskId, timeoutHandle);
  }

  async function failTask(taskId, error) {
    const message = toErrorMessage(error);
    clearReloadTimeout(taskId);
    releaseKeepAlive(taskId);
    await appendTaskDebug(taskId, "Task failed", {
      message
    });
    return replaceCurrentTask(taskId, {
      stage: BACKGROUND_TASK_STAGES.ERROR,
      message,
      error: message
    });
  }

  async function runCopyTask(task, tab, provider) {
    try {
      await attachKeepAlive(
        task.id,
        tab.id,
        BACKGROUND_TASK_KINDS.COPY_SOURCE,
        "Вкладка Yonote была закрыта или перезагружена. Копирование остановлено."
      );
      await appendTaskDebug(task.id, "Copy task started", {
        tabId: tab.id,
        tabUrl: tab.url
      });
      await replaceCurrentTask(task.id, {
        stage: BACKGROUND_TASK_STAGES.RUNNING,
        message: "Запрашиваю export-контекст у Yonote..."
      });
      await appendTaskDebug(task.id, "Requesting native export context from Yonote bridge");

      const response = await deps.sendBridgeMessage({
        tabId: tab.id,
        kind: BRIDGE_KINDS.YONOTE,
        message: {
          type: provider.copyMessageType,
          preferredMode: "native-export-context",
          expectedBridgeVersion: EXT_BUILD
        }
      });
      await appendTaskDebug(task.id, "Yonote bridge responded", {
        success: Boolean(response && response.success),
        hasPayload: Boolean(response && response.payload && response.payload.markdown),
        hasNativeExportContext: Boolean(response && response.nativeExportContext)
      });

      if (!response || !response.success) {
        throw new Error(response && response.error ? response.error : "Не удалось получить markdown из источника.");
      }

      let payload = null;

      if (response.payload && response.payload.markdown) {
        payload = buildCopyPayload(response, provider, deps.now());
      } else if (response.nativeExportContext) {
        if (typeof deps.requestNativeExport !== "function") {
          throw new Error("Native export runner не настроен.");
        }

        await replaceCurrentTask(task.id, {
          message: "Скачиваю native export из Yonote..."
        });
        await appendTaskDebug(task.id, "Starting background native export request", {
          operationId: response.nativeExportContext.operationId || "",
          documentId: response.nativeExportContext.documentId || ""
        });
        const nativeExportResult = await deps.requestNativeExport(response.nativeExportContext);
        await appendTaskDebug(task.id, "Background native export finished", {
          markdownLength: String((nativeExportResult && nativeExportResult.markdown) || "").length
        });
        payload = buildCopyPayloadFromNativeExport(
          nativeExportResult,
          response.nativeExportContext,
          response,
          provider,
          deps.now()
        );
      } else {
        throw new Error(response.error || "Не удалось получить контекст native export.");
      }

      await appendTaskDebug(task.id, "Saving copied source", {
        markdownLength: String(payload.markdown || "").length
      });
      await deps.saveStoredSource(payload);

      await replaceCurrentTask(task.id, {
        stage: BACKGROUND_TASK_STAGES.SUCCESS,
        message: "Скопировано и сохранено.",
        result: {
          sourceTitle: payload.title || "",
          sourceCapturedAt: payload.capturedAt || ""
        }
      });
      releaseKeepAlive(task.id);
      await appendTaskDebug(task.id, "Copy task finished successfully");
    } catch (error) {
      await failTask(task.id, error);
    }
  }

  async function runInsertTask(task, tab, storedSource) {
    try {
      await attachKeepAlive(
        task.id,
        tab.id,
        BACKGROUND_TASK_KINDS.INSERT_SOURCE,
        "Вкладка теории была закрыта или перезагружена до завершения вставки."
      );
      await appendTaskDebug(task.id, "Insert task started", {
        tabId: tab.id,
        tabUrl: tab.url,
        markdownLength: String(storedSource && storedSource.markdown ? storedSource.markdown : "").length
      });
      await replaceCurrentTask(task.id, {
        stage: BACKGROUND_TASK_STAGES.RUNNING,
        message: "Отправляю markdown в bridge теории..."
      });
      await appendTaskDebug(task.id, "Requesting theory bridge append");

      const response = await deps.sendBridgeMessage({
        tabId: tab.id,
        kind: BRIDGE_KINDS.THEORY,
        message: {
          type: MESSAGE_TYPES.APPEND_TEXT_BLOCKS,
          markdown: storedSource.markdown,
          expectedBridgeVersion: EXT_BUILD
        }
      });
      await appendTaskDebug(task.id, "Theory bridge responded", {
        success: Boolean(response && response.success),
        appendedCount: Number((response && response.appendedCount) || 0),
        tableCount: Number((response && response.tableCount) || 0)
      });

      if (!response || !response.success) {
        throw new Error(response && response.error ? response.error : "Не удалось добавить блоки в теорию.");
      }

      const deadlineAt = new Date(normalizeDate(deps.now()).getTime() + RELOAD_TIMEOUT_MS).toISOString();

      await replaceCurrentTask(task.id, {
        stage: BACKGROUND_TASK_STAGES.RELOADING,
        message: "Ожидаю перезагрузку страницы...",
        reloadDeadlineAt: deadlineAt,
        result: {
          appendedCount: Number(response.appendedCount || 0),
          tableCount: Number(response.tableCount || 0),
          partial: Boolean(response.partial)
        }
      });

      scheduleReloadTimeout(task.id);
      releaseKeepAlive(task.id);
      await appendTaskDebug(task.id, "Keepalive port released before planned reload", {
        tabId: tab.id
      });

      try {
        await appendTaskDebug(task.id, "Reloading theory tab", {
          tabId: tab.id
        });
        await deps.reloadTab(tab.id);
        await appendTaskDebug(task.id, "Reload request sent");
      } catch {
        await appendTaskDebug(task.id, "Reload request failed, falling back to soft success");
        await finalizeReloadSuccess(
          task.id,
          "Перезагрузка запущена. Если контент не виден, обновите вкладку вручную.",
          true
        );
      }
    } catch (error) {
      await failTask(task.id, error);
    }
  }

  async function startCopyTask() {
    const currentTask = await recoverStaleTaskIfNeeded(await deps.loadActiveTask());
    if (isBackgroundTaskBusy(currentTask)) {
      try {
        console.info("[PH background] Rejecting copy start because another task is active", currentTask);
      } catch {
        // Best-effort debug log.
      }
      return {
        accepted: false,
        task: currentTask,
        error: buildBusyTaskError()
      };
    }

    const tab = await deps.getActiveTab();
    if (!tab || !tab.id || !tab.url) {
      return {
        accepted: false,
        error: "Не удалось получить активную вкладку."
      };
    }

    const provider = getSourceProvider(tab.url);
    if (!provider) {
      return {
        accepted: false,
        error: "Источник не поддерживается. Сейчас доступен только Yonote /doc/..."
      };
    }

    const task = createBackgroundTask(
      BACKGROUND_TASK_KINDS.COPY_SOURCE,
      {
        stage: BACKGROUND_TASK_STAGES.STARTING,
        message: "Собираю source в фоне...",
        sourceTabId: tab.id,
        debugLog: []
      },
      deps.now()
    );

    await deps.saveActiveTask(task);
    await appendTaskDebug(task.id, "Accepted copy task", {
      tabId: tab.id,
      tabUrl: tab.url
    });
    deps.scheduleTask(() => {
      void runCopyTask(task, tab, provider);
    });

    return {
      accepted: true,
      task
    };
  }

  async function startInsertTask() {
    const currentTask = await recoverStaleTaskIfNeeded(await deps.loadActiveTask());
    if (isBackgroundTaskBusy(currentTask)) {
      try {
        console.info("[PH background] Rejecting insert start because another task is active", currentTask);
      } catch {
        // Best-effort debug log.
      }
      return {
        accepted: false,
        task: currentTask,
        error: buildBusyTaskError()
      };
    }

    const storedSource = await deps.loadStoredSource();
    if (!storedSource || !storedSource.markdown) {
      return {
        accepted: false,
        error: "Сначала нажмите «Копировать» на странице источника."
      };
    }

    const tab = await deps.getActiveTab();
    if (!tab || !tab.id || !tab.url) {
      return {
        accepted: false,
        error: "Не удалось получить активную вкладку."
      };
    }

    if (!isTheoryUrl(tab.url)) {
      return {
        accepted: false,
        error: "Откройте страницу урока, URL которой заканчивается на /theory/."
      };
    }

    const task = createBackgroundTask(
      BACKGROUND_TASK_KINDS.INSERT_SOURCE,
      {
        stage: BACKGROUND_TASK_STAGES.STARTING,
        message: "Добавляю блоки в фоне...",
        targetTabId: tab.id,
        debugLog: []
      },
      deps.now()
    );

    await deps.saveActiveTask(task);
    await appendTaskDebug(task.id, "Accepted insert task", {
      tabId: tab.id,
      tabUrl: tab.url
    });
    deps.scheduleTask(() => {
      void runInsertTask(task, tab, storedSource);
    });

    return {
      accepted: true,
      task
    };
  }

  async function handleRuntimeMessage(message) {
    try {
      console.info("[PH background] Runtime message received", message);
    } catch {
      // Best-effort debug log.
    }

    switch (message && message.type) {
      case BACKGROUND_MESSAGE_TYPES.START_COPY_SOURCE:
        return startCopyTask();
      case BACKGROUND_MESSAGE_TYPES.START_INSERT_SOURCE:
        return startInsertTask();
      case BACKGROUND_MESSAGE_TYPES.GET_ACTIVE_TASK:
        return {
          task: (await recoverStaleTaskIfNeeded(await deps.loadActiveTask())) || null
        };
      default:
        return null;
    }
  }

  async function handleTabUpdated(updatedTabId, changeInfo) {
    if (!changeInfo || changeInfo.status !== "complete") {
      return null;
    }

    try {
      console.info("[PH background] tabs.onUpdated complete", {
        tabId: updatedTabId
      });
    } catch {
      // Best-effort debug log.
    }

    const currentTask = await deps.loadActiveTask();
    if (
      !currentTask ||
      currentTask.kind !== BACKGROUND_TASK_KINDS.INSERT_SOURCE ||
      currentTask.stage !== BACKGROUND_TASK_STAGES.RELOADING ||
      currentTask.targetTabId !== updatedTabId
    ) {
      return null;
    }

    return finalizeReloadSuccess(currentTask.id, "Страница обновлена. Проверьте результат.");
  }

  return {
    handleRuntimeMessage,
    handleTabUpdated
  };
}
