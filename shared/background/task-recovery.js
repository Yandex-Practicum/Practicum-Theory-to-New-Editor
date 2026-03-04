import { BACKGROUND_TASK_STAGES, isBackgroundTaskBusy, stampBackgroundTask } from "../background-task.js";
import { normalizeDate } from "./runtime-helpers.js";

export function createTaskRecovery({
  deps,
  taskStartingStaleTimeoutMs,
  taskRunningStaleTimeoutMs,
  clearReloadTimeout,
  releaseKeepAlive,
  clearTaskAbortController
}) {
  async function recoverStaleTaskIfNeeded(task) {
    if (!task || typeof task !== "object") {
      return task || null;
    }

    const updatedAt = task.updatedAt ? normalizeDate(task.updatedAt) : null;
    const ageMs = updatedAt ? Math.max(0, normalizeDate(deps.now()).getTime() - updatedAt.getTime()) : 0;

    const isStartingStale =
      task.stage === BACKGROUND_TASK_STAGES.STARTING && ageMs >= taskStartingStaleTimeoutMs;
    const isRunningStale = task.stage === BACKGROUND_TASK_STAGES.RUNNING && ageMs >= taskRunningStaleTimeoutMs;

    if (isStartingStale || isRunningStale) {
      const recovered = stampBackgroundTask(
        task,
        {
          stage: BACKGROUND_TASK_STAGES.ERROR,
          message: "Фоновая задача прервалась. Повторите действие.",
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

  async function cancelActiveTask() {
    const current = await recoverStaleTaskIfNeeded(await deps.loadActiveTask());
    if (!isBackgroundTaskBusy(current)) {
      return {
        cancelled: false,
        task: current || null
      };
    }

    clearReloadTimeout(current.id);
    releaseKeepAlive(current.id);
    clearTaskAbortController(current.id, { abort: true });

    const cancelledTask = stampBackgroundTask(
      current,
      {
        stage: BACKGROUND_TASK_STAGES.ERROR,
        message: "Задача прервана.",
        error: "Задача прервана.",
        cancelled: true
      },
      deps.now()
    );

    await deps.saveActiveTask(cancelledTask);

    try {
      console.info("[PH background] Active task cancelled", {
        taskId: cancelledTask.id,
        kind: cancelledTask.kind
      });
    } catch {
      // Best-effort debug log.
    }

    return {
      cancelled: true,
      task: cancelledTask
    };
  }

  return {
    recoverStaleTaskIfNeeded,
    cancelActiveTask
  };
}
