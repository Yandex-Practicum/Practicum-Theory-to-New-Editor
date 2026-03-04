import { BACKGROUND_TASK_KINDS, BACKGROUND_TASK_STAGES, createBackgroundTask, isBackgroundTaskBusy } from "../background-task.js";
import { BRIDGE_KINDS, EXT_BUILD, MESSAGE_TYPES, isTheoryUrl } from "../constants.js";
import { createInsertAssetFlow } from "./insert-assets.js";
import { normalizeMarkdownForTheoryInsert } from "./markdown-helpers.js";
import { buildBusyTaskError, normalizeDate } from "./runtime-helpers.js";

export function createInsertFlow({ deps, taskRuntime, theoryUploadBatchSize, reloadTimeoutMs }) {
  const insertAssets = createInsertAssetFlow({
    deps,
    taskRuntime,
    theoryUploadBatchSize
  });

  async function runInsertTask(task, tab, storedSource) {
    try {
      if (await taskRuntime.stopIfTaskInterrupted(task.id)) {
        return;
      }

      const sourceAssets = Array.isArray(storedSource && storedSource.assets) ? storedSource.assets : [];
      let insertMarkdown = String(storedSource && storedSource.markdown ? storedSource.markdown : "");
      let uploadedImageCount = 0;
      let skippedImageCount = 0;

      await taskRuntime.attachKeepAlive(
        task.id,
        tab.id,
        BACKGROUND_TASK_KINDS.INSERT_SOURCE,
        "Вкладка теории была закрыта или перезагружена до завершения вставки."
      );
      if (await taskRuntime.stopIfTaskInterrupted(task.id)) {
        return;
      }
      await taskRuntime.appendTaskDebug(task.id, "Insert task started", {
        tabId: tab.id,
        tabUrl: tab.url,
        markdownLength: insertMarkdown.length,
        assetCount: sourceAssets.length
      });

      await taskRuntime.replaceCurrentTask(task.id, {
        stage: BACKGROUND_TASK_STAGES.RUNNING,
        message: sourceAssets.length ? "Загружаю изображения в фоне..." : "Отправляю markdown в bridge теории..."
      });

      if (sourceAssets.length) {
        const uploadState = await insertAssets.uploadSourceAssets(
          task,
          tab,
          storedSource,
          sourceAssets,
          insertMarkdown
        );
        insertMarkdown = uploadState.insertMarkdown;
        uploadedImageCount = uploadState.uploadedImageCount;
        skippedImageCount = uploadState.skippedImageCount;
      }

      insertMarkdown = normalizeMarkdownForTheoryInsert(insertMarkdown);

      if (await taskRuntime.stopIfTaskInterrupted(task.id)) {
        return;
      }
      await taskRuntime.replaceCurrentTask(task.id, {
        stage: BACKGROUND_TASK_STAGES.RUNNING,
        message: "Отправляю markdown в bridge теории..."
      });
      await taskRuntime.appendTaskDebug(task.id, "Requesting theory bridge append");

      const response = await deps.sendBridgeMessage({
        tabId: tab.id,
        kind: BRIDGE_KINDS.THEORY,
        message: {
          type: MESSAGE_TYPES.APPEND_TEXT_BLOCKS,
          markdown: insertMarkdown,
          expectedBridgeVersion: EXT_BUILD
        }
      });
      if (await taskRuntime.stopIfTaskInterrupted(task.id)) {
        return;
      }
      await taskRuntime.appendTaskDebug(task.id, "Theory bridge responded", {
        success: Boolean(response && response.success),
        appendedCount: Number((response && response.appendedCount) || 0),
        tableCount: Number((response && response.tableCount) || 0),
        imageCount: Number((response && response.imageCount) || 0)
      });

      if (!response || !response.success) {
        throw new Error(response && response.error ? response.error : "Не удалось добавить блоки в теорию.");
      }

      const deadlineAt = new Date(normalizeDate(deps.now()).getTime() + reloadTimeoutMs).toISOString();
      const isPartial = Boolean(response.partial) || skippedImageCount > 0;

      if (await taskRuntime.stopIfTaskInterrupted(task.id)) {
        return;
      }
      await insertAssets.clearStoredInsertAssets(task, storedSource, sourceAssets);

      await taskRuntime.replaceCurrentTask(task.id, {
        stage: BACKGROUND_TASK_STAGES.RELOADING,
        message: isPartial
          ? "Часть изображений пропущена. Ожидаю перезагрузку страницы..."
          : "Ожидаю перезагрузку страницы...",
        reloadDeadlineAt: deadlineAt,
        result: {
          appendedCount: Number(response.appendedCount || 0),
          tableCount: Number(response.tableCount || 0),
          imageCount: Number(response.imageCount || 0),
          uploadedImageCount,
          skippedImageCount,
          partial: isPartial
        }
      });

      taskRuntime.scheduleReloadTimeout(task.id);
      taskRuntime.releaseKeepAlive(task.id);
      await taskRuntime.appendTaskDebug(task.id, "Keepalive port released before planned reload", {
        tabId: tab.id
      });

      try {
        await taskRuntime.appendTaskDebug(task.id, "Reloading theory tab", {
          tabId: tab.id
        });
        await deps.reloadTab(tab.id);
        await taskRuntime.appendTaskDebug(task.id, "Reload request sent");
      } catch {
        await taskRuntime.appendTaskDebug(task.id, "Reload request failed, falling back to soft success");
        await taskRuntime.finalizeReloadSuccess(
          task.id,
          "Перезагрузка запущена. Если контент не виден, обновите вкладку вручную.",
          true
        );
      }
    } catch (error) {
      if (await taskRuntime.isTaskInterrupted(task.id)) {
        return;
      }
      await taskRuntime.failTask(task.id, error);
    }
  }

  async function startInsertTask() {
    const currentTask = await taskRuntime.recoverStaleTaskIfNeeded(await deps.loadActiveTask());
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
    await taskRuntime.appendTaskDebug(task.id, "Accepted insert task", {
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

  return {
    startInsertTask
  };
}
