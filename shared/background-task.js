export const BACKGROUND_TASK_KINDS = {
  COPY_SOURCE: "copy_source",
  INSERT_SOURCE: "insert_source"
};

export const BACKGROUND_TASK_STAGES = {
  IDLE: "idle",
  STARTING: "starting",
  RUNNING: "running",
  RELOADING: "reloading",
  SUCCESS: "success",
  ERROR: "error"
};

const ACTIVE_TASK_STAGES = new Set([
  BACKGROUND_TASK_STAGES.STARTING,
  BACKGROUND_TASK_STAGES.RUNNING,
  BACKGROUND_TASK_STAGES.RELOADING
]);

function createTaskId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `ph-task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeNow(nowValue = new Date()) {
  const date = nowValue instanceof Date ? nowValue : new Date(nowValue);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export function createBackgroundTask(kind, fields = {}, nowValue = new Date()) {
  const now = normalizeNow(nowValue);
  const timestamp = now.toISOString();

  return {
    ...fields,
    id: fields.id || createTaskId(),
    kind,
    stage: fields.stage || BACKGROUND_TASK_STAGES.STARTING,
    message: String(fields.message || ""),
    startedAt: fields.startedAt || timestamp,
    updatedAt: fields.updatedAt || timestamp
  };
}

export function stampBackgroundTask(task, patch = {}, nowValue = new Date()) {
  if (!task || typeof task !== "object") {
    return null;
  }

  return {
    ...task,
    ...(patch || {}),
    updatedAt: normalizeNow(nowValue).toISOString()
  };
}

export function isBackgroundTaskBusy(task) {
  if (!task || typeof task !== "object") {
    return false;
  }

  return ACTIVE_TASK_STAGES.has(task.stage);
}

export function getBackgroundTaskStatus(task) {
  if (!task || typeof task !== "object") {
    return {
      message: "Готово.",
      type: "info"
    };
  }

  if (task.stage === BACKGROUND_TASK_STAGES.STARTING || task.stage === BACKGROUND_TASK_STAGES.RUNNING) {
    return {
      message: task.message || "Задача выполняется в фоне...",
      type: "syncing"
    };
  }

  if (task.stage === BACKGROUND_TASK_STAGES.RELOADING) {
    return {
      message: task.message || "Ожидаю перезагрузку страницы...",
      type: "reloading"
    };
  }

  if (task.stage === BACKGROUND_TASK_STAGES.ERROR) {
    return {
      message: task.message || task.error || "Фоновая задача завершилась с ошибкой.",
      type: "error"
    };
  }

  if (task.stage === BACKGROUND_TASK_STAGES.SUCCESS) {
    const message = task.message || "Фоновая задача завершена.";
    return {
      message,
      type: /вручную/i.test(message) ? "warning" : "success"
    };
  }

  return {
    message: task.message || "Готово.",
    type: "info"
  };
}
