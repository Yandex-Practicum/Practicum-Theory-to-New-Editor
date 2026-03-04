import { BACKGROUND_TASK_KINDS, BACKGROUND_TASK_STAGES, createBackgroundTask, isBackgroundTaskBusy } from "../background-task.js";
import { BRIDGE_KINDS, EXT_BUILD, getSourceProvider } from "../constants.js";
import { extractReferencedImageAssets } from "./asset-helpers.js";
import { buildCopyPayload, buildCopyPayloadFromNativeExport } from "./payload-helpers.js";
import { buildBusyTaskError } from "./runtime-helpers.js";

export function createCopyFlow({ deps, taskRuntime, copyAssets }) {
  async function runYonoteCopyTask(task, tab, provider) {
    await taskRuntime.replaceCurrentTask(task.id, {
      stage: BACKGROUND_TASK_STAGES.RUNNING,
      message: "Запрашиваю export-контекст у Yonote..."
    });
    await taskRuntime.appendTaskDebug(task.id, "Requesting native export context from Yonote bridge");

    const response = await deps.sendBridgeMessage({
      tabId: tab.id,
      kind: provider.bridgeKind || BRIDGE_KINDS.YONOTE,
      message: {
        type: provider.copyMessageType,
        preferredMode: "native-export-context",
        expectedBridgeVersion: EXT_BUILD
      }
    });
    taskRuntime.releaseKeepAlive(task.id);
    if (await taskRuntime.stopIfTaskInterrupted(task.id)) {
      return null;
    }
    await taskRuntime.appendTaskDebug(task.id, "Yonote bridge responded", {
      success: Boolean(response && response.success),
      hasPayload: Boolean(response && response.payload && response.payload.markdown),
      hasNativeExportContext: Boolean(response && response.nativeExportContext)
    });
    await taskRuntime.appendTaskDebug(task.id, "Copy source tab is no longer required");

    if (!response || !response.success) {
      throw new Error(response && response.error ? response.error : "Не удалось получить markdown из источника.");
    }

    if (response.payload && response.payload.markdown) {
      return copyAssets.persistBridgePayloadAssets(task.id, buildCopyPayload(response, provider, deps.now()));
    }

    if (!response.nativeExportContext) {
      throw new Error(response.error || "Не удалось получить контекст native export.");
    }

    if (typeof deps.requestNativeExport !== "function") {
      throw new Error("Native export runner не настроен.");
    }

    await taskRuntime.replaceCurrentTask(task.id, {
      message: "Скачиваю native export из Yonote..."
    });
    await taskRuntime.appendTaskDebug(task.id, "Starting background native export request", {
      operationId: response.nativeExportContext.operationId || "",
      documentId: response.nativeExportContext.documentId || ""
    });
    const nativeExportResult = await deps.requestNativeExport({
      ...response.nativeExportContext,
      signal: taskRuntime.createTaskAbortSignal(task.id)
    });
    taskRuntime.clearTaskAbortController(task.id);
    if (await taskRuntime.stopIfTaskInterrupted(task.id)) {
      return null;
    }
    await taskRuntime.appendTaskDebug(task.id, "Background native export finished", {
      markdownLength: String((nativeExportResult && nativeExportResult.markdown) || "").length
    });
    const assetBundle = extractReferencedImageAssets(
      nativeExportResult && nativeExportResult.markdown ? nativeExportResult.markdown : "",
      nativeExportResult && Array.isArray(nativeExportResult.entries) ? nativeExportResult.entries : []
    );
    await taskRuntime.appendTaskDebug(task.id, "Extracted referenced image assets", {
      assetCount: assetBundle.assetRefs.length
    });
    if (await taskRuntime.stopIfTaskInterrupted(task.id)) {
      return null;
    }
    if (assetBundle.assetBinaries.length) {
      await deps.replaceSourceAssets(task.id, assetBundle.assetBinaries);
    } else {
      await copyAssets.clearStaleSourceAssets(task.id);
    }
    return buildCopyPayloadFromNativeExport(
      nativeExportResult,
      response.nativeExportContext,
      response,
      provider,
      deps.now(),
      task.id,
      assetBundle
    );
  }

  async function runWikiCopyTask(task, tab, provider) {
    const response = await deps.sendBridgeMessage({
      tabId: tab.id,
      kind: provider.bridgeKind || BRIDGE_KINDS.WIKI,
      message: {
        type: provider.copyMessageType,
        expectedBridgeVersion: EXT_BUILD
      }
    });
    taskRuntime.releaseKeepAlive(task.id);
    if (await taskRuntime.stopIfTaskInterrupted(task.id)) {
      return null;
    }
    await taskRuntime.appendTaskDebug(task.id, "Wiki bridge responded", {
      success: Boolean(response && response.success),
      hasPayload: Boolean(response && response.payload && response.payload.markdown)
    });
    await taskRuntime.appendTaskDebug(task.id, "Copy source tab is no longer required");

    if (!response || !response.success) {
      throw new Error(response && response.error ? response.error : "Не удалось получить markdown из источника.");
    }

    return copyAssets.persistBridgePayloadAssets(task.id, buildCopyPayload(response, provider, deps.now()));
  }

  async function runCopyTask(task, tab, provider) {
    try {
      if (await taskRuntime.stopIfTaskInterrupted(task.id)) {
        return;
      }

      await taskRuntime.attachKeepAlive(
        task.id,
        tab.id,
        BACKGROUND_TASK_KINDS.COPY_SOURCE,
        "Вкладка источника была закрыта или перезагружена. Копирование остановлено."
      );
      if (await taskRuntime.stopIfTaskInterrupted(task.id)) {
        return;
      }
      await taskRuntime.appendTaskDebug(task.id, "Copy task started", {
        tabId: tab.id,
        tabUrl: tab.url,
        provider: provider.id
      });
      await taskRuntime.replaceCurrentTask(task.id, {
        stage: BACKGROUND_TASK_STAGES.RUNNING,
        message: "Считываю контент источника..."
      });

      const payload =
        provider && provider.id === "wiki"
          ? await runWikiCopyTask(task, tab, provider)
          : await runYonoteCopyTask(task, tab, provider);

      if (!payload || (await taskRuntime.stopIfTaskInterrupted(task.id))) {
        return;
      }

      await taskRuntime.appendTaskDebug(task.id, "Saving copied source", {
        markdownLength: String(payload.markdown || "").length
      });
      await deps.saveStoredSource(payload);

      await taskRuntime.replaceCurrentTask(task.id, {
        stage: BACKGROUND_TASK_STAGES.SUCCESS,
        message: "Скопировано и сохранено.",
        result: {
          sourceTitle: payload.title || "",
          sourceCapturedAt: payload.capturedAt || ""
        }
      });
      taskRuntime.clearTaskAbortController(task.id);
      await taskRuntime.appendTaskDebug(task.id, "Copy task finished successfully");
    } catch (error) {
      if (await taskRuntime.isTaskInterrupted(task.id)) {
        return;
      }
      await taskRuntime.failTask(task.id, error);
    }
  }

  async function startCopyTask() {
    const currentTask = await taskRuntime.recoverStaleTaskIfNeeded(await deps.loadActiveTask());
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
        error: "Источник не поддерживается. Сейчас доступны Yonote /doc/... и wiki.yandex-team.ru."
      };
    }

    const task = createBackgroundTask(
      BACKGROUND_TASK_KINDS.COPY_SOURCE,
      {
        stage: BACKGROUND_TASK_STAGES.STARTING,
        message: "Считываю контент источника...",
        sourceTabId: tab.id,
        debugLog: []
      },
      deps.now()
    );

    await deps.saveActiveTask(task);
    await taskRuntime.appendTaskDebug(task.id, "Accepted copy task", {
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

  return {
    startCopyTask
  };
}
