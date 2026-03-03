function stripUtf8Bom(text) {
  return String(text || "").replace(/^\uFEFF/, "");
}

function debugNativeExport(message, details) {
  try {
    if (globalThis.console && typeof globalThis.console.info === "function") {
      globalThis.console.info("[PH native-export]", message, details || "");
    }
  } catch {
    // Debug logging must never break the export flow.
  }
}

export function decodeTextBytes(bytes) {
  if (typeof TextDecoder === "undefined") {
    return "";
  }

  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return "";
  }
}

function readUint16LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32LE(bytes, offset) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function findZipEndOfCentralDirectory(bytes) {
  const minOffset = Math.max(0, bytes.length - 0xffff - 22);
  for (let offset = bytes.length - 22; offset >= minOffset; offset -= 1) {
    if (readUint32LE(bytes, offset) === 0x06054b50) {
      return offset;
    }
  }
  return -1;
}

async function inflateZipEntry(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Браузер не поддерживает распаковку ZIP (DecompressionStream).");
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const inflated = await new Response(stream).arrayBuffer();
  return new Uint8Array(inflated);
}

export async function extractZipEntriesFromArrayBuffer(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || 0);
  const eocdOffset = findZipEndOfCentralDirectory(bytes);

  if (eocdOffset < 0) {
    throw new Error("Yonote export вернул некорректный ZIP.");
  }

  const totalEntries = readUint16LE(bytes, eocdOffset + 10);
  const centralDirectoryOffset = readUint32LE(bytes, eocdOffset + 16);
  const entries = [];
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (readUint32LE(bytes, cursor) !== 0x02014b50) {
      throw new Error("Yonote export ZIP имеет поврежденный каталог.");
    }

    const flags = readUint16LE(bytes, cursor + 8);
    const compressionMethod = readUint16LE(bytes, cursor + 10);
    const compressedSize = readUint32LE(bytes, cursor + 20);
    const uncompressedSize = readUint32LE(bytes, cursor + 24);
    const fileNameLength = readUint16LE(bytes, cursor + 28);
    const extraLength = readUint16LE(bytes, cursor + 30);
    const commentLength = readUint16LE(bytes, cursor + 32);
    const localHeaderOffset = readUint32LE(bytes, cursor + 42);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + fileNameLength;
    const rawName = bytes.slice(nameStart, nameEnd);
    const name = decodeTextBytes(rawName);
    const isUtf8 = Boolean(flags & 0x0800);

    if (!isUtf8 && !name) {
      throw new Error("Не удалось прочитать имя файла из Yonote export.");
    }

    if (readUint32LE(bytes, localHeaderOffset) !== 0x04034b50) {
      throw new Error("Yonote export ZIP имеет поврежденный local header.");
    }

    const localNameLength = readUint16LE(bytes, localHeaderOffset + 26);
    const localExtraLength = readUint16LE(bytes, localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const rawEntry = bytes.slice(dataOffset, dataOffset + compressedSize);

    let data;
    if (compressionMethod === 0) {
      data = rawEntry;
    } else if (compressionMethod === 8) {
      data = await inflateZipEntry(rawEntry);
    } else {
      throw new Error("Yonote export использует неподдерживаемое сжатие ZIP.");
    }

    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      data
    });

    cursor = nameEnd + extraLength + commentLength;
  }

  return entries;
}

function countPathDepth(path) {
  return String(path || "")
    .split("/")
    .filter(Boolean).length;
}

export function pickPrimaryMarkdownZipEntry(entries) {
  const markdownEntries = (Array.isArray(entries) ? entries : []).filter(entry => /\.md$/i.test(entry.name || ""));
  if (!markdownEntries.length) {
    return null;
  }

  markdownEntries.sort((left, right) => {
    const depthDiff = countPathDepth(left.name) - countPathDepth(right.name);
    if (depthDiff !== 0) {
      return depthDiff;
    }

    const sizeDiff = Number(right.uncompressedSize || 0) - Number(left.uncompressedSize || 0);
    if (sizeDiff !== 0) {
      return sizeDiff;
    }

    return String(left.name || "").localeCompare(String(right.name || ""));
  });

  return markdownEntries[0];
}

function createAbortError() {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) {
    throw createAbortError();
  }
}

async function delay(ms, signal) {
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

function isZipContentType(contentType) {
  return /application\/zip|application\/octet-stream/i.test(String(contentType || ""));
}

function isMarkdownResponse(contentType, responseURL) {
  const normalizedType = String(contentType || "");
  const normalizedUrl = String(responseURL || "");
  return (
    /text\/markdown|text\/plain/i.test(normalizedType) ||
    /\.md(?:$|\?)/i.test(normalizedUrl)
  );
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

async function fetchArchiveFromOperationRedirect({
  baseOrigin,
  operationId,
  authBearer,
  editorVersion,
  signal
}) {
  throwIfAborted(signal);
  const response = await fetch(
    new URL(`/api/fileOperations.redirect?id=${encodeURIComponent(operationId)}`, baseOrigin).href,
    {
      method: "GET",
      credentials: "include",
      headers: buildApiHeaders(authBearer, editorVersion, false),
      redirect: "follow",
      cache: "no-store",
      signal
    }
  );

  return response;
}

async function pollNativeExportArchiveViaXhr({
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

      if (response.status === 200 && byteLength > 0 && (isZipContentType(contentType) || isMarkdownResponse(contentType, response.responseURL))) {
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

    await delay(500, signal);
  }

  if (lastNetworkError instanceof Error && lastNetworkError.message) {
    throw new Error(`Yonote не отдал архив native export: ${lastNetworkError.message}`);
  }

  const snapshotSuffix = lastSnapshot
    ? ` Последний XHR-ответ: status=${lastSnapshot.status}, content-type=${lastSnapshot.contentType || "-"}, bytes=${lastSnapshot.byteLength}, responseURL=${lastSnapshot.responseURL || "-"}.`
    : "";

  throw new Error(`Yonote слишком долго готовил native export.${snapshotSuffix}`);
}

export async function requestYonoteNativeExport({
  baseOrigin,
  documentId,
  operationId: initialOperationId,
  downloadUrl,
  authBearer,
  editorVersion,
  signal
}) {
  let archiveUrl = String(downloadUrl || "").trim();
  let operationId = String(initialOperationId || "").trim();
  let directArchiveResponse = null;
  let downloadedPayload = null;
  let lastPollSnapshot = null;

  debugNativeExport("start", {
    baseOrigin,
    documentId,
    hasOperationId: Boolean(operationId),
    hasDownloadUrl: Boolean(archiveUrl)
  });

  if (!archiveUrl && !operationId) {
    throwIfAborted(signal);
    const exportResponse = await fetch(new URL("/api/documents.export", baseOrigin).href, {
      method: "POST",
      credentials: "include",
      headers: buildApiHeaders(authBearer, editorVersion, true),
      signal,
      body: JSON.stringify({
        id: documentId,
        options: {
          includeAttachments: true,
          delimiter: ";",
          includeChildren: false
        }
      })
    });

    const exportPayload = await exportResponse.json().catch(() => null);
    if (!exportResponse.ok || !exportPayload || exportPayload.ok === false) {
      debugNativeExport("documents.export failed", {
        status: exportResponse.status,
        ok: exportResponse.ok,
        payload: exportPayload
      });
      throw new Error("Yonote не смог подготовить native export.");
    }

    operationId =
      exportPayload &&
      exportPayload.data &&
      exportPayload.data.fileOperation &&
      typeof exportPayload.data.fileOperation.id === "string"
        ? exportPayload.data.fileOperation.id
        : "";

    if (!operationId) {
      throw new Error("Yonote не вернул id экспортной операции.");
    }

    debugNativeExport("documents.export created operation", {
      operationId
    });
  }

  if (!archiveUrl && operationId && typeof XMLHttpRequest !== "undefined") {
    downloadedPayload = await pollNativeExportArchiveViaXhr({
      baseOrigin,
      operationId,
      authBearer,
      editorVersion,
      signal
    });
  }

  if (!archiveUrl && !downloadedPayload) {
    let lastNetworkError = null;

    for (let attempt = 0; attempt < 60; attempt += 1) {
      throwIfAborted(signal);
      try {
        const response = await fetch(
          new URL(`/api/fileOperations.redirect?id=${encodeURIComponent(operationId)}`, baseOrigin).href,
          {
            method: "GET",
            credentials: "include",
            headers: buildApiHeaders(authBearer, editorVersion, false),
            redirect: "manual",
            cache: "no-store",
            signal
          }
        );

        const contentType = response.headers.get("content-type") || "";
        const locationHeader = response.headers.get("location") || "";
        lastPollSnapshot = {
          attempt: attempt + 1,
          status: response.status,
          ok: response.ok,
          type: response.type || "",
          redirected: Boolean(response.redirected),
          url: response.url || "",
          contentType,
          hasLocation: Boolean(locationHeader)
        };

        debugNativeExport("fileOperations.redirect poll", lastPollSnapshot);

        if (response.ok && (isZipContentType(contentType) || isMarkdownResponse(contentType, response.url))) {
          directArchiveResponse = response;
          archiveUrl = response.url;
          debugNativeExport("resolved archive as direct payload response", {
            archiveUrl,
            contentType,
            attempt: attempt + 1
          });
          break;
        }

        if ((response.status >= 300 && response.status < 400) && locationHeader) {
          archiveUrl = new URL(locationHeader, baseOrigin).href;
          debugNativeExport("resolved archive from location header", {
            archiveUrl,
            attempt: attempt + 1
          });
          break;
        }

        if (response.type === "opaqueredirect" && response.url && /storage\.yandexcloud\.net/i.test(response.url)) {
          archiveUrl = response.url;
          debugNativeExport("resolved archive from opaqueredirect url", {
            archiveUrl,
            attempt: attempt + 1
          });
          break;
        }

        if (response.type === "opaqueredirect") {
          debugNativeExport("opaqueredirect detected, retrying same endpoint with follow", {
            attempt: attempt + 1
          });

          const followedResponse = await fetchArchiveFromOperationRedirect({
            baseOrigin,
            operationId,
            authBearer,
            editorVersion,
            signal
          });
          const followedContentType = followedResponse.headers.get("content-type") || "";

          debugNativeExport("followed redirect response", {
            status: followedResponse.status,
            ok: followedResponse.ok,
            type: followedResponse.type || "",
            redirected: Boolean(followedResponse.redirected),
            url: followedResponse.url || "",
            contentType: followedContentType
          });

          if (
            followedResponse.ok &&
            (isZipContentType(followedContentType) || isMarkdownResponse(followedContentType, followedResponse.url))
          ) {
            directArchiveResponse = followedResponse;
            archiveUrl = followedResponse.url;
            debugNativeExport("resolved archive after follow retry", {
              archiveUrl,
              contentType: followedContentType,
              attempt: attempt + 1
            });
            break;
          }
        }
      } catch (error) {
        lastNetworkError = error;
        debugNativeExport("fileOperations.redirect poll failed", {
          attempt: attempt + 1,
          message: error instanceof Error ? error.message : String(error || "")
        });
      }

      await delay(500, signal);
    }

    if (!archiveUrl && !directArchiveResponse) {
      if (lastNetworkError instanceof Error && lastNetworkError.message) {
        throw new Error(`Yonote не отдал архив native export: ${lastNetworkError.message}`);
      }

      const snapshotSuffix = lastPollSnapshot
        ? ` Последний ответ: status=${lastPollSnapshot.status}, type=${lastPollSnapshot.type || "-"}, redirected=${lastPollSnapshot.redirected ? "yes" : "no"}, content-type=${lastPollSnapshot.contentType || "-"}, location=${lastPollSnapshot.hasLocation ? "yes" : "no"}.`
        : "";

      debugNativeExport("timed out while waiting for archive", lastPollSnapshot || { operationId });
      throw new Error(`Yonote слишком долго готовил native export.${snapshotSuffix}`);
    }
  }

  if (!downloadedPayload) {
    throwIfAborted(signal);
    const downloadResponse =
      directArchiveResponse ||
      (await fetch(archiveUrl, {
        method: "GET",
        cache: "no-store",
        signal
      }));

    const contentType = downloadResponse.headers.get("content-type") || "";
    debugNativeExport("archive download response", {
      status: downloadResponse.status,
      ok: downloadResponse.ok,
      type: downloadResponse.type || "",
      url: downloadResponse.url || archiveUrl,
      contentType
    });
    if (
      !downloadResponse.ok ||
      !(isZipContentType(contentType) || isMarkdownResponse(contentType, downloadResponse.url || archiveUrl))
    ) {
      throw new Error("Yonote не отдал архив native export.");
    }

    downloadedPayload = {
      buffer: await downloadResponse.arrayBuffer(),
      contentType,
      responseURL: downloadResponse.url || archiveUrl
    };
  } else {
    debugNativeExport("export payload obtained via xhr", {
      byteLength: downloadedPayload.buffer && downloadedPayload.buffer.byteLength ? downloadedPayload.buffer.byteLength : 0,
      contentType: downloadedPayload.contentType || "",
      responseURL: downloadedPayload.responseURL || ""
    });
  }

  if (isMarkdownResponse(downloadedPayload.contentType, downloadedPayload.responseURL)) {
    const markdown = stripUtf8Bom(decodeTextBytes(new Uint8Array(downloadedPayload.buffer || 0))).replace(/\r\n?/g, "\n").trim();
    if (!markdown) {
      throw new Error("Yonote export вернул пустой markdown.");
    }

    debugNativeExport("direct markdown payload received", {
      markdownLength: markdown.length,
      responseURL: downloadedPayload.responseURL || ""
    });

    return {
      markdown,
      entries: []
    };
  }

  const entries = await extractZipEntriesFromArrayBuffer(downloadedPayload.buffer);
  const markdownEntry = pickPrimaryMarkdownZipEntry(entries);

  if (!markdownEntry) {
    throw new Error("В архиве Yonote export не найден markdown-файл.");
  }

  const markdown = stripUtf8Bom(decodeTextBytes(markdownEntry.data || new Uint8Array())).replace(/\r\n?/g, "\n").trim();
  if (!markdown) {
    throw new Error("Yonote export вернул пустой markdown.");
  }

  debugNativeExport("archive unpacked", {
    totalEntries: entries.length,
    markdownEntry: markdownEntry.name,
    markdownLength: markdown.length
  });

  return {
    markdown,
    entries
  };
}
