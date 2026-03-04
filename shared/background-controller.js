import { BACKGROUND_MESSAGE_TYPES } from "./constants.js";
import { BACKGROUND_TASK_KINDS, BACKGROUND_TASK_STAGES } from "./background-task.js";
import { createCopyAssetPersistence } from "./background/copy-assets.js";
import { createCopyFlow } from "./background/copy-flow.js";
import { createInsertFlow } from "./background/insert-flow.js";
import { defaultScheduleTask } from "./background/runtime-helpers.js";
import { createTaskRuntime } from "./background/task-runtime.js";

const RELOAD_TIMEOUT_MS = 15000;
const THEORY_UPLOAD_BATCH_SIZE = 6;
const SOURCE_ASSET_FETCH_BATCH_SIZE = 6;
const DEBUG_LOG_LIMIT = 25;
const TASK_STARTING_STALE_TIMEOUT_MS = 15000;
const TASK_RUNNING_STALE_TIMEOUT_MS = 180000;
const ACTIVE_RUNTIME_MESSAGE_TYPES = new Set(Object.values(BACKGROUND_MESSAGE_TYPES));

export function isBackgroundRuntimeMessage(message) {
  return Boolean(message && ACTIVE_RUNTIME_MESSAGE_TYPES.has(message.type));
}

export function createBackgroundController(dependencies) {
  const deps = {
    loadActiveTask: dependencies.loadActiveTask,
    saveActiveTask: dependencies.saveActiveTask,
    loadStoredSource: dependencies.loadStoredSource,
    saveStoredSource: dependencies.saveStoredSource,
    replaceSourceAssets: dependencies.replaceSourceAssets || (async () => {}),
    loadSourceAssetBytes: dependencies.loadSourceAssetBytes || (async () => null),
    clearSourceAssets: dependencies.clearSourceAssets || (async () => {}),
    fetchSourceAssetBytes: dependencies.fetchSourceAssetBytes || (async () => null),
    getActiveTab: dependencies.getActiveTab,
    sendBridgeMessage: dependencies.sendBridgeMessage,
    requestNativeExport: dependencies.requestNativeExport || null,
    openKeepAlivePort: dependencies.openKeepAlivePort || null,
    reloadTab: dependencies.reloadTab,
    setTimeoutFn: dependencies.setTimeoutFn || globalThis.setTimeout.bind(globalThis),
    clearTimeoutFn: dependencies.clearTimeoutFn || globalThis.clearTimeout.bind(globalThis),
    scheduleTask: dependencies.scheduleTask || defaultScheduleTask,
    now: dependencies.now || (() => new Date())
  };

  const taskRuntime = createTaskRuntime({
    deps,
    reloadTimeouts: new Map(),
    keepAlivePorts: new Map(),
    taskAbortControllers: new Map(),
    config: {
      debugLogLimit: DEBUG_LOG_LIMIT,
      reloadTimeoutMs: RELOAD_TIMEOUT_MS,
      taskStartingStaleTimeoutMs: TASK_STARTING_STALE_TIMEOUT_MS,
      taskRunningStaleTimeoutMs: TASK_RUNNING_STALE_TIMEOUT_MS
    }
  });

  const copyAssets = createCopyAssetPersistence({
    deps,
    taskRuntime,
    sourceAssetFetchBatchSize: SOURCE_ASSET_FETCH_BATCH_SIZE
  });

  const copyFlow = createCopyFlow({
    deps,
    taskRuntime,
    copyAssets
  });

  const insertFlow = createInsertFlow({
    deps,
    taskRuntime,
    theoryUploadBatchSize: THEORY_UPLOAD_BATCH_SIZE,
    reloadTimeoutMs: RELOAD_TIMEOUT_MS
  });

  async function handleRuntimeMessage(message) {
    try {
      console.info("[PH background] Runtime message received", message);
    } catch {
      // Best-effort debug log.
    }

    switch (message && message.type) {
      case BACKGROUND_MESSAGE_TYPES.START_COPY_SOURCE:
        return copyFlow.startCopyTask();
      case BACKGROUND_MESSAGE_TYPES.START_INSERT_SOURCE:
        return insertFlow.startInsertTask();
      case BACKGROUND_MESSAGE_TYPES.GET_ACTIVE_TASK:
        return {
          task: (await taskRuntime.recoverStaleTaskIfNeeded(await deps.loadActiveTask())) || null
        };
      case BACKGROUND_MESSAGE_TYPES.CANCEL_ACTIVE_TASK:
        return taskRuntime.cancelActiveTask();
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

    return taskRuntime.finalizeReloadSuccess(currentTask.id, "Страница обновлена. Проверьте результат.");
  }

  return {
    handleRuntimeMessage,
    handleTabUpdated
  };
}
