import { BACKGROUND_TASK_KINDS, BACKGROUND_TASK_STAGES, stampBackgroundTask } from "../background-task.js";
import { createTaskRecovery } from "./task-recovery.js";
import { normalizeDate, toErrorMessage } from "./runtime-helpers.js";

export function createTaskRuntime({
  deps,
  reloadTimeouts,
  keepAlivePorts,
  taskAbortControllers,
  config
}) {
  const { debugLogLimit, reloadTimeoutMs, taskStartingStaleTimeoutMs, taskRunningStaleTimeoutMs } = config;

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
    const nextLog = [...currentLog, line].slice(-debugLogLimit);
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

  function clearTaskAbortController(taskId, { abort = false } = {}) {
    const controller = taskAbortControllers.get(taskId);
    if (!controller) {
      return;
    }

    taskAbortControllers.delete(taskId);
    if (!abort) {
      return;
    }

    try {
      controller.abort();
    } catch {
      // Best-effort abort.
    }
  }

  function createTaskAbortSignal(taskId) {
    clearTaskAbortController(taskId);
    if (typeof AbortController !== "function") {
      return undefined;
    }

    const controller = new AbortController();
    taskAbortControllers.set(taskId, controller);
    return controller.signal;
  }

  async function isTaskInterrupted(taskId) {
    const current = await deps.loadActiveTask();
    return !current || current.id !== taskId || Boolean(current.cancelled);
  }

  async function stopIfTaskInterrupted(taskId) {
    if (!(await isTaskInterrupted(taskId))) {
      return false;
    }

    clearTaskAbortController(taskId);
    return true;
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
    if (!current || current.id !== taskId || current.cancelled) {
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
      timeoutMs: reloadTimeoutMs
    });

    const timeoutHandle = deps.setTimeoutFn(() => {
      reloadTimeouts.delete(taskId);
      void appendTaskDebug(taskId, "Reload timeout fired");
      void finalizeReloadSuccess(
        taskId,
        "Перезагрузка запущена. Если контент не виден, обновите вкладку вручную.",
        true
      );
    }, reloadTimeoutMs);

    reloadTimeouts.set(taskId, timeoutHandle);
  }

  async function failTask(taskId, error) {
    const current = await deps.loadActiveTask();
    if (!current || current.id !== taskId || current.cancelled) {
      clearReloadTimeout(taskId);
      releaseKeepAlive(taskId);
      clearTaskAbortController(taskId, { abort: true });
      return current || null;
    }

    const message = toErrorMessage(error);
    clearReloadTimeout(taskId);
    releaseKeepAlive(taskId);
    clearTaskAbortController(taskId, { abort: true });
    await appendTaskDebug(taskId, "Task failed", {
      message
    });
    return replaceCurrentTask(taskId, {
      stage: BACKGROUND_TASK_STAGES.ERROR,
      message,
      error: message
    });
  }

  const recovery = createTaskRecovery({
    deps,
    taskStartingStaleTimeoutMs,
    taskRunningStaleTimeoutMs,
    clearReloadTimeout,
    releaseKeepAlive,
    clearTaskAbortController
  });

  return {
    appendTaskDebug,
    clearTaskAbortController,
    createTaskAbortSignal,
    isTaskInterrupted,
    stopIfTaskInterrupted,
    recoverStaleTaskIfNeeded: recovery.recoverStaleTaskIfNeeded,
    releaseKeepAlive,
    attachKeepAlive,
    replaceCurrentTask,
    clearReloadTimeout,
    finalizeReloadSuccess,
    scheduleReloadTimeout,
    failTask,
    cancelActiveTask: recovery.cancelActiveTask
  };
}
