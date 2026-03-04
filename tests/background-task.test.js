import assert from "node:assert/strict";
import test from "node:test";

import {
  BACKGROUND_TASK_STAGES,
  getBackgroundTaskStatus,
  isBackgroundTaskBusy
} from "../shared/background-task.js";

test("busy-state is derived only from active task stages", () => {
  assert.equal(isBackgroundTaskBusy(null), false);
  assert.equal(isBackgroundTaskBusy({ stage: BACKGROUND_TASK_STAGES.STARTING }), true);
  assert.equal(isBackgroundTaskBusy({ stage: BACKGROUND_TASK_STAGES.RUNNING }), true);
  assert.equal(isBackgroundTaskBusy({ stage: BACKGROUND_TASK_STAGES.RELOADING }), true);
  assert.equal(isBackgroundTaskBusy({ stage: BACKGROUND_TASK_STAGES.SUCCESS }), false);
  assert.equal(isBackgroundTaskBusy({ stage: BACKGROUND_TASK_STAGES.ERROR }), false);
});

test("status presentation keeps warning styling for timed-out reload success", () => {
  assert.deepEqual(getBackgroundTaskStatus(null), {
    message: "Готово.",
    type: "info"
  });

  assert.deepEqual(
    getBackgroundTaskStatus({
      stage: BACKGROUND_TASK_STAGES.RUNNING,
      message: "Считываю контент источника..."
    }),
    {
      message: "Считываю контент источника...",
      type: "syncing"
    }
  );

  assert.deepEqual(
    getBackgroundTaskStatus({
      stage: BACKGROUND_TASK_STAGES.SUCCESS,
      message: "Перезагрузка запущена. Если контент не виден, обновите вкладку вручную."
    }),
    {
      message: "Перезагрузка запущена. Если контент не виден, обновите вкладку вручную.",
      type: "warning"
    }
  );
});
