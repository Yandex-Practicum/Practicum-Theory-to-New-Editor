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
const TASK_STARTING_STALE_TIMEOUT_MS = 15000;
const TASK_RUNNING_STALE_TIMEOUT_MS = 180000;
const ACTIVE_RUNTIME_MESSAGE_TYPES = new Set(Object.values(BACKGROUND_MESSAGE_TYPES));
const IMAGE_EXTENSION_TO_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

function defaultScheduleTask(callback) {
  callback();
}

function toErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/Receiving end does not exist/i.test(message) || /Could not establish connection/i.test(message)) {
    return "Перезагрузите страницу: bridge-скрипт еще не подключен.";
  }

  if (/message channel closed before a response was received/i.test(message)) {
    return "Страница была закрыта или перезагружена до ответа. Повторите действие.";
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

function stripWrappedLinkTarget(target) {
  const trimmed = String(target || "").trim();
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function parseMarkdownImageLinkTarget(rawTarget) {
  const trimmed = String(rawTarget || "").trim();
  if (!trimmed) {
    return {
      path: "",
      title: ""
    };
  }

  const match = trimmed.match(/^(.*?)(?:\s+("([^"]*)"|'([^']*)'))?$/);
  const pathPart = stripWrappedLinkTarget(match && match[1] ? match[1] : trimmed);
  const titlePart = String((match && (match[3] || match[4])) || "").trim();

  return {
    path: pathPart,
    title: titlePart
  };
}

function formatMarkdownImageLinkTarget(path, title) {
  const normalizedPath = String(path || "").trim();
  const normalizedTitle = String(title || "").trim();
  if (!normalizedTitle) {
    return normalizedPath;
  }

  return `${normalizedPath} "${normalizedTitle.replace(/"/g, '\\"')}"`;
}

function isExternalAssetTarget(target) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(String(target || "").trim());
}

function normalizePathSlashes(path) {
  return String(path || "").replace(/\\/g, "/");
}

function normalizeZipPath(path) {
  return normalizePathSlashes(path)
    .split("/")
    .filter(Boolean)
    .join("/");
}

function getPathDir(path) {
  const normalized = normalizeZipPath(path);
  const lastSlashIndex = normalized.lastIndexOf("/");
  if (lastSlashIndex < 0) {
    return "";
  }

  return normalized.slice(0, lastSlashIndex);
}

function getPathBaseName(path) {
  const normalized = normalizeZipPath(path);
  const lastSlashIndex = normalized.lastIndexOf("/");
  return lastSlashIndex < 0 ? normalized : normalized.slice(lastSlashIndex + 1);
}

function getSupportedImageMimeType(path) {
  const normalized = normalizeZipPath(path).toLowerCase();
  const match = normalized.match(/(\.[a-z0-9]+)$/i);
  if (!match) {
    return "";
  }

  return IMAGE_EXTENSION_TO_MIME[match[1]] || "";
}

function resolveAssetPath(target, baseDir) {
  const rawTarget = parseMarkdownImageLinkTarget(target).path;
  if (!rawTarget || isExternalAssetTarget(rawTarget)) {
    return "";
  }

  let decodedTarget = rawTarget;
  try {
    decodedTarget = decodeURIComponent(rawTarget);
  } catch {
    decodedTarget = rawTarget;
  }

  const segments = [];
  const baseSegments = normalizeZipPath(baseDir).split("/").filter(Boolean);
  const targetSegments = normalizePathSlashes(decodedTarget).split("/");

  baseSegments.forEach(segment => {
    segments.push(segment);
  });

  targetSegments.forEach(segment => {
    if (!segment || segment === ".") {
      return;
    }

    if (segment === "..") {
      if (segments.length) {
        segments.pop();
      }
      return;
    }

    segments.push(segment);
  });

  return segments.join("/");
}

function collectMarkdownImageTargets(markdown) {
  const value = String(markdown || "");
  const targets = [];
  const imageRe = /!\[[^\]]*]\(([^)\n]+)\)/g;
  let match = imageRe.exec(value);

  while (match) {
    targets.push(String(match[1] || "").trim());
    match = imageRe.exec(value);
  }

  return targets;
}

function pickPrimaryMarkdownEntry(entries) {
  const markdownEntries = (Array.isArray(entries) ? entries : []).filter(entry => /\.md$/i.test(entry && entry.name ? entry.name : ""));
  if (!markdownEntries.length) {
    return null;
  }

  markdownEntries.sort((left, right) => {
    const leftName = String(left && left.name ? left.name : "");
    const rightName = String(right && right.name ? right.name : "");
    const leftDepth = (leftName.match(/\//g) || []).length;
    const rightDepth = (rightName.match(/\//g) || []).length;
    if (leftDepth !== rightDepth) {
      return leftDepth - rightDepth;
    }

    return leftName.localeCompare(rightName);
  });

  return markdownEntries[0];
}

function toDetachedArrayBuffer(value) {
  if (value instanceof ArrayBuffer) {
    return value.slice(0);
  }

  if (ArrayBuffer.isView(value)) {
    const view = value;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  }

  return new Uint8Array().buffer;
}

function encodeArrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer || 0);
  if (!bytes.length) {
    return "";
  }

  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  if (typeof btoa === "function") {
    return btoa(binary);
  }

  throw new Error("Не удалось подготовить binary payload для загрузки.");
}

function extractReferencedImageAssets(markdown, entries) {
  const markdownEntry = pickPrimaryMarkdownEntry(entries);
  if (!markdownEntry) {
    return {
      assetBasePath: "",
      assetRefs: [],
      assetBinaries: []
    };
  }

  const assetBasePath = getPathDir(markdownEntry.name || "");
  const entriesByPath = new Map();

  (Array.isArray(entries) ? entries : []).forEach(entry => {
    const normalizedPath = normalizeZipPath(entry && entry.name ? entry.name : "");
    if (!normalizedPath) {
      return;
    }

    entriesByPath.set(normalizedPath, entry);
  });

  const seen = new Set();
  const assetRefs = [];
  const assetBinaries = [];

  collectMarkdownImageTargets(markdown).forEach(target => {
    const normalizedPath = resolveAssetPath(target, assetBasePath);
    if (!normalizedPath || seen.has(normalizedPath)) {
      return;
    }

    const entry = entriesByPath.get(normalizedPath);
    const mimeType = getSupportedImageMimeType(normalizedPath);
    if (!entry || !mimeType) {
      return;
    }

    seen.add(normalizedPath);

    assetRefs.push({
      id: normalizedPath,
      path: normalizedPath,
      fileName: getPathBaseName(normalizedPath),
      mimeType,
      byteLength: Number(entry.data && entry.data.byteLength ? entry.data.byteLength : 0)
    });
    assetBinaries.push({
      id: normalizedPath,
      bytes: toDetachedArrayBuffer(entry.data || new Uint8Array())
    });
  });

  return {
    assetBasePath,
    assetRefs,
    assetBinaries
  };
}

function rewriteMarkdownImageTargets(markdown, assetBasePath, uploadedAssetUrls) {
  const imageRe = /!\[([^\]]*)]\(([^)\n]+)\)/g;

  return String(markdown || "").replace(imageRe, (match, altText, target) => {
    const parsedTarget = parseMarkdownImageLinkTarget(target);
    const normalizedTarget = resolveAssetPath(parsedTarget.path, assetBasePath);
    if (!normalizedTarget || !uploadedAssetUrls.has(normalizedTarget)) {
      return match;
    }

    return `![${String(altText || "")}](${formatMarkdownImageLinkTarget(
      uploadedAssetUrls.get(normalizedTarget),
      parsedTarget.title
    )})`;
  });
}

function clearStoredSourceAssetsMetadata(storedSource) {
  if (!storedSource || typeof storedSource !== "object") {
    return storedSource;
  }

  const hasAssets = Array.isArray(storedSource.assets) && storedSource.assets.length > 0;
  const hasStorageId = Boolean(storedSource.sourceStorageId);
  const hasBasePath = Boolean(storedSource.assetBasePath);

  if (!hasAssets && !hasStorageId && !hasBasePath) {
    return storedSource;
  }

  return {
    ...storedSource,
    sourceStorageId: "",
    assetBasePath: "",
    assets: [],
    assetCount: 0
  };
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
    diagnostics: payload.diagnostics || response.diagnostics || {},
    sourceStorageId: "",
    assetBasePath: "",
    assets: [],
    assetCount: 0
  };
}

function buildCopyPayloadFromNativeExport(
  nativeExportResult,
  nativeExportContext,
  response,
  provider,
  fallbackCapturedAt,
  sourceStorageId,
  assetBundle
) {
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
    diagnostics: (response && response.diagnostics) || {},
    sourceStorageId:
      assetBundle && Array.isArray(assetBundle.assetRefs) && assetBundle.assetRefs.length
        ? String(sourceStorageId || "")
        : "",
    assetBasePath:
      assetBundle && Array.isArray(assetBundle.assetRefs) && assetBundle.assetRefs.length && assetBundle.assetBasePath
        ? assetBundle.assetBasePath
        : "",
    assets: assetBundle && Array.isArray(assetBundle.assetRefs) ? assetBundle.assetRefs : [],
    assetCount: Number(
      assetBundle && Array.isArray(assetBundle.assetRefs) ? assetBundle.assetRefs.length : 0
    )
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
    replaceSourceAssets: dependencies.replaceSourceAssets || (async () => {}),
    loadSourceAssetBytes: dependencies.loadSourceAssetBytes || (async () => null),
    clearSourceAssets: dependencies.clearSourceAssets || (async () => {}),
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
  const taskAbortControllers = new Map();

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

  async function recoverStaleTaskIfNeeded(task) {
    if (!task || typeof task !== "object") {
      return task || null;
    }

    const updatedAt = task.updatedAt ? normalizeDate(task.updatedAt) : null;
    const ageMs = updatedAt ? Math.max(0, normalizeDate(deps.now()).getTime() - updatedAt.getTime()) : 0;

    const isStartingStale = task.stage === BACKGROUND_TASK_STAGES.STARTING && ageMs >= TASK_STARTING_STALE_TIMEOUT_MS;
    const isRunningStale = task.stage === BACKGROUND_TASK_STAGES.RUNNING && ageMs >= TASK_RUNNING_STALE_TIMEOUT_MS;

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

  async function runCopyTask(task, tab, provider) {
    try {
      if (await stopIfTaskInterrupted(task.id)) {
        return;
      }

      await attachKeepAlive(
        task.id,
        tab.id,
        BACKGROUND_TASK_KINDS.COPY_SOURCE,
        "Вкладка Yonote была закрыта или перезагружена. Копирование остановлено."
      );
      if (await stopIfTaskInterrupted(task.id)) {
        return;
      }
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
      releaseKeepAlive(task.id);
      if (await stopIfTaskInterrupted(task.id)) {
        return;
      }
      await appendTaskDebug(task.id, "Yonote bridge responded", {
        success: Boolean(response && response.success),
        hasPayload: Boolean(response && response.payload && response.payload.markdown),
        hasNativeExportContext: Boolean(response && response.nativeExportContext)
      });
      await appendTaskDebug(task.id, "Copy source tab is no longer required");

      if (!response || !response.success) {
        throw new Error(response && response.error ? response.error : "Не удалось получить markdown из источника.");
      }

      let payload = null;

      if (response.payload && response.payload.markdown) {
        try {
          await deps.clearSourceAssets();
        } catch (error) {
          await appendTaskDebug(task.id, "Failed to clear stale source assets", {
            message: error instanceof Error ? error.message : String(error || "")
          });
        }
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
        const nativeExportResult = await deps.requestNativeExport({
          ...response.nativeExportContext,
          signal: createTaskAbortSignal(task.id)
        });
        clearTaskAbortController(task.id);
        if (await stopIfTaskInterrupted(task.id)) {
          return;
        }
        await appendTaskDebug(task.id, "Background native export finished", {
          markdownLength: String((nativeExportResult && nativeExportResult.markdown) || "").length
        });
        const assetBundle = extractReferencedImageAssets(
          nativeExportResult && nativeExportResult.markdown ? nativeExportResult.markdown : "",
          nativeExportResult && Array.isArray(nativeExportResult.entries) ? nativeExportResult.entries : []
        );
        await appendTaskDebug(task.id, "Extracted referenced image assets", {
          assetCount: assetBundle.assetRefs.length
        });
        if (await stopIfTaskInterrupted(task.id)) {
          return;
        }
        if (assetBundle.assetBinaries.length) {
          await deps.replaceSourceAssets(task.id, assetBundle.assetBinaries);
        } else {
          try {
            await deps.clearSourceAssets();
          } catch (error) {
            await appendTaskDebug(task.id, "Failed to clear stale source assets", {
              message: error instanceof Error ? error.message : String(error || "")
            });
          }
        }
        payload = buildCopyPayloadFromNativeExport(
          nativeExportResult,
          response.nativeExportContext,
          response,
          provider,
          deps.now(),
          task.id,
          assetBundle
        );
      } else {
        throw new Error(response.error || "Не удалось получить контекст native export.");
      }

      if (await stopIfTaskInterrupted(task.id)) {
        return;
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
      clearTaskAbortController(task.id);
      await appendTaskDebug(task.id, "Copy task finished successfully");
    } catch (error) {
      if (await isTaskInterrupted(task.id)) {
        return;
      }
      await failTask(task.id, error);
    }
  }

  async function runInsertTask(task, tab, storedSource) {
    try {
      if (await stopIfTaskInterrupted(task.id)) {
        return;
      }

      const sourceAssets = Array.isArray(storedSource && storedSource.assets) ? storedSource.assets : [];
      let insertMarkdown = String(storedSource && storedSource.markdown ? storedSource.markdown : "");
      let uploadedImageCount = 0;
      let skippedImageCount = 0;

      await attachKeepAlive(
        task.id,
        tab.id,
        BACKGROUND_TASK_KINDS.INSERT_SOURCE,
        "Вкладка теории была закрыта или перезагружена до завершения вставки."
      );
      if (await stopIfTaskInterrupted(task.id)) {
        return;
      }
      await appendTaskDebug(task.id, "Insert task started", {
        tabId: tab.id,
        tabUrl: tab.url,
        markdownLength: insertMarkdown.length,
        assetCount: sourceAssets.length
      });

      await replaceCurrentTask(task.id, {
        stage: BACKGROUND_TASK_STAGES.RUNNING,
        message: sourceAssets.length ? "Загружаю изображения в фоне..." : "Отправляю markdown в bridge теории..."
      });

      if (sourceAssets.length) {
        const uploadedAssetUrls = new Map();

        for (const asset of sourceAssets) {
          if (await stopIfTaskInterrupted(task.id)) {
            return;
          }

          await appendTaskDebug(task.id, "Uploading theory resource", {
            assetId: asset.id,
            fileName: asset.fileName || ""
          });

          const assetBytes = await deps.loadSourceAssetBytes(storedSource.sourceStorageId || "", asset.id);
          if (!(assetBytes instanceof ArrayBuffer) || !assetBytes.byteLength) {
            skippedImageCount += 1;
            await appendTaskDebug(task.id, "Source asset bytes missing", {
              assetId: asset.id
            });
            continue;
          }

          if (await stopIfTaskInterrupted(task.id)) {
            return;
          }

          const uploadResponse = await deps.sendBridgeMessage({
            tabId: tab.id,
            kind: BRIDGE_KINDS.THEORY,
            message: {
              type: MESSAGE_TYPES.UPLOAD_THEORY_RESOURCE,
              fileName: asset.fileName || getPathBaseName(asset.path || asset.id || ""),
              mimeType: asset.mimeType || getSupportedImageMimeType(asset.path || asset.id || ""),
              bytesBase64: encodeArrayBufferToBase64(assetBytes),
              expectedBridgeVersion: EXT_BUILD
            }
          });
          if (await stopIfTaskInterrupted(task.id)) {
            return;
          }

          await appendTaskDebug(task.id, "Theory resource upload responded", {
            assetId: asset.id,
            success: Boolean(uploadResponse && uploadResponse.success)
          });

          if (uploadResponse && uploadResponse.success && uploadResponse.fileUrl) {
            uploadedAssetUrls.set(asset.id, String(uploadResponse.fileUrl));
            uploadedImageCount += 1;
            continue;
          }

          skippedImageCount += 1;
        }

        if (uploadedAssetUrls.size) {
          insertMarkdown = rewriteMarkdownImageTargets(
            insertMarkdown,
            String(storedSource && storedSource.assetBasePath ? storedSource.assetBasePath : ""),
            uploadedAssetUrls
          );
          await appendTaskDebug(task.id, "Rewrote markdown image URLs", {
            uploadedImageCount
          });
        }
      }

      if (await stopIfTaskInterrupted(task.id)) {
        return;
      }
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
          markdown: insertMarkdown,
          expectedBridgeVersion: EXT_BUILD
        }
      });
      if (await stopIfTaskInterrupted(task.id)) {
        return;
      }
      await appendTaskDebug(task.id, "Theory bridge responded", {
        success: Boolean(response && response.success),
        appendedCount: Number((response && response.appendedCount) || 0),
        tableCount: Number((response && response.tableCount) || 0),
        imageCount: Number((response && response.imageCount) || 0)
      });

      if (!response || !response.success) {
        throw new Error(response && response.error ? response.error : "Не удалось добавить блоки в теорию.");
      }

      const deadlineAt = new Date(normalizeDate(deps.now()).getTime() + RELOAD_TIMEOUT_MS).toISOString();
      const isPartial = Boolean(response.partial) || skippedImageCount > 0;

      if (await stopIfTaskInterrupted(task.id)) {
        return;
      }
      if (sourceAssets.length) {
        try {
          await deps.clearSourceAssets();
          await deps.saveStoredSource(clearStoredSourceAssetsMetadata(storedSource));
          await appendTaskDebug(task.id, "Cleared stored image assets after successful append");
        } catch (error) {
          await appendTaskDebug(task.id, "Failed to clear stored image assets", {
            message: error instanceof Error ? error.message : String(error || "")
          });
        }
      }

      await replaceCurrentTask(task.id, {
        stage: BACKGROUND_TASK_STAGES.RELOADING,
        message: isPartial ? "Часть изображений пропущена. Ожидаю перезагрузку страницы..." : "Ожидаю перезагрузку страницы...",
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
      if (await isTaskInterrupted(task.id)) {
        return;
      }
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
      case BACKGROUND_MESSAGE_TYPES.CANCEL_ACTIVE_TASK:
        return cancelActiveTask();
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
