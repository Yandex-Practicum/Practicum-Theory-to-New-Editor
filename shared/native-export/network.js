function debugNativeExport(message, details) {
  try {
    if (globalThis.console && typeof globalThis.console.info === "function") {
      globalThis.console.info("[PH native-export]", message, details || "");
    }
  } catch {
    // Debug logging must never break the export flow.
  }
}

function createAbortError() {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

export function throwIfAborted(signal) {
  if (signal && signal.aborted) {
    throw createAbortError();
  }
}

export async function waitWithAbort(ms, signal) {
  throwIfAborted(signal);
  return new Promise(resolve => {
    const timeoutId = globalThis.setTimeout(() => {
      if (signal && abortHandler) {
        signal.removeEventListener("abort", abortHandler);
      }
      resolve();
    }, ms);

    let abortHandler = null;
    if (signal) {
      abortHandler = () => {
        globalThis.clearTimeout(timeoutId);
        signal.removeEventListener("abort", abortHandler);
        resolve();
      };
      signal.addEventListener("abort", abortHandler, { once: true });
    }
  });
}

function buildApiHeaders(authBearer, editorVersion, withJson = false) {
  const headers = {
    accept: "application/json"
  };

  if (authBearer) {
    headers.authorization = authBearer;
  }

  if (editorVersion) {
    headers["x-editor-version"] = editorVersion;
  }

  if (withJson) {
    headers["content-type"] = "application/json";
  }

  return headers;
}

export function isZipContentType(contentType) {
  return /application\/zip|application\/octet-stream/i.test(String(contentType || ""));
}

export function isMarkdownResponse(contentType, responseURL) {
  const normalizedType = String(contentType || "");
  const normalizedUrl = String(responseURL || "");
  return /text\/markdown|text\/plain/i.test(normalizedType) || /\.md(?:$|\?)/i.test(normalizedUrl);
}

function parseXhrHeaders(rawHeaders) {
  const headers = new Map();
  String(rawHeaders || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .forEach(line => {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex < 0) {
        return;
      }

      const key = line.slice(0, separatorIndex).trim().toLowerCase();
      const value = line.slice(separatorIndex + 1).trim();
      if (key) {
        headers.set(key, value);
      }
    });

  return headers;
}

function requestArrayBufferViaXhr(url, headers, signal) {
  return new Promise((resolve, reject) => {
    if (typeof XMLHttpRequest === "undefined") {
      reject(new Error("XMLHttpRequest is not available."));
      return;
    }

    throwIfAborted(signal);

    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.responseType = "arraybuffer";
    xhr.withCredentials = true;

    let abortHandler = null;
    if (signal) {
      abortHandler = () => {
        try {
          xhr.abort();
        } catch {
          // Best-effort abort.
        }
      };
      signal.addEventListener("abort", abortHandler, { once: true });
    }

    Object.entries(headers || {}).forEach(([key, value]) => {
      if (value) {
        xhr.setRequestHeader(key, value);
      }
    });

    xhr.onload = () => {
      if (signal && abortHandler) {
        signal.removeEventListener("abort", abortHandler);
      }
      resolve({
        status: xhr.status,
        response: xhr.response,
        responseURL: xhr.responseURL || "",
        headers: parseXhrHeaders(xhr.getAllResponseHeaders())
      });
    };

    xhr.onerror = () => {
      if (signal && abortHandler) {
        signal.removeEventListener("abort", abortHandler);
      }
      reject(new Error("XHR network error"));
    };

    xhr.onabort = () => {
      if (signal && abortHandler) {
        signal.removeEventListener("abort", abortHandler);
      }
      reject(new Error("XHR aborted"));
    };

    xhr.send();
  });
}

export async function fetchArchiveFromOperationRedirect({
  baseOrigin,
  operationId,
  authBearer,
  editorVersion,
  signal
}) {
  throwIfAborted(signal);
  return fetch(new URL(`/api/fileOperations.redirect?id=${encodeURIComponent(operationId)}`, baseOrigin).href, {
    method: "GET",
    credentials: "include",
    headers: buildApiHeaders(authBearer, editorVersion, false),
    redirect: "follow",
    cache: "no-store",
    signal
  });
}

export async function pollNativeExportArchiveViaXhr({
  baseOrigin,
  operationId,
  authBearer,
  editorVersion,
  signal
}) {
  let lastSnapshot = null;
  let lastNetworkError = null;
  const redirectUrl = new URL(`/api/fileOperations.redirect?id=${encodeURIComponent(operationId)}`, baseOrigin).href;
  const headers = buildApiHeaders(authBearer, editorVersion, false);

  for (let attempt = 0; attempt < 60; attempt += 1) {
    throwIfAborted(signal);
    try {
      const response = await requestArrayBufferViaXhr(redirectUrl, headers, signal);
      const contentType = response.headers.get("content-type") || "";
      const byteLength =
        response.response && typeof response.response.byteLength === "number"
          ? response.response.byteLength
          : 0;

      lastSnapshot = {
        attempt: attempt + 1,
        status: response.status,
        contentType,
        byteLength,
        responseURL: response.responseURL || ""
      };

      debugNativeExport("fileOperations.redirect xhr poll", lastSnapshot);

      if (
        response.status === 200 &&
        byteLength > 0 &&
        (isZipContentType(contentType) || isMarkdownResponse(contentType, response.responseURL))
      ) {
        return {
          buffer: response.response,
          contentType,
          responseURL: response.responseURL || ""
        };
      }
    } catch (error) {
      lastNetworkError = error;
      debugNativeExport("fileOperations.redirect xhr poll failed", {
        attempt: attempt + 1,
        message: error instanceof Error ? error.message : String(error || "")
      });
    }

    await waitWithAbort(500, signal);
  }

  if (lastNetworkError instanceof Error && lastNetworkError.message) {
    throw new Error(`Yonote не отдал архив native export: ${lastNetworkError.message}`);
  }

  const snapshotSuffix = lastSnapshot
    ? ` Последний XHR-ответ: status=${lastSnapshot.status}, content-type=${lastSnapshot.contentType || "-"}, bytes=${lastSnapshot.byteLength}, responseURL=${lastSnapshot.responseURL || "-"}.`
    : "";

  throw new Error(`Yonote слишком долго готовил native export.${snapshotSuffix}`);
}

export function logNativeExport(message, details) {
  debugNativeExport(message, details);
}

export function createNativeExportHeaders(authBearer, editorVersion, withJson = false) {
  return buildApiHeaders(authBearer, editorVersion, withJson);
}
