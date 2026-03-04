import {
  createNativeExportHeaders,
  fetchArchiveFromOperationRedirect,
  isMarkdownResponse,
  isZipContentType,
  logNativeExport,
  pollNativeExportArchiveViaXhr,
  throwIfAborted,
  waitWithAbort
} from "./network.js";

export async function createNativeExportOperation({
  baseOrigin,
  documentId,
  authBearer,
  editorVersion,
  signal
}) {
  throwIfAborted(signal);
  const exportResponse = await fetch(new URL("/api/documents.export", baseOrigin).href, {
    method: "POST",
    credentials: "include",
    headers: createNativeExportHeaders(authBearer, editorVersion, true),
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
    logNativeExport("documents.export failed", {
      status: exportResponse.status,
      ok: exportResponse.ok,
      payload: exportPayload
    });
    throw new Error("Yonote не смог подготовить native export.");
  }

  const operationId =
    exportPayload &&
    exportPayload.data &&
    exportPayload.data.fileOperation &&
    typeof exportPayload.data.fileOperation.id === "string"
      ? exportPayload.data.fileOperation.id
      : "";

  if (!operationId) {
    throw new Error("Yonote не вернул id экспортной операции.");
  }

  logNativeExport("documents.export created operation", {
    operationId
  });
  return operationId;
}

async function resolveArchiveFromRedirect({
  baseOrigin,
  operationId,
  authBearer,
  editorVersion,
  signal
}) {
  let archiveUrl = "";
  let directArchiveResponse = null;
  let lastPollSnapshot = null;
  let lastNetworkError = null;

  for (let attempt = 0; attempt < 60; attempt += 1) {
    throwIfAborted(signal);
    try {
      const response = await fetch(
        new URL(`/api/fileOperations.redirect?id=${encodeURIComponent(operationId)}`, baseOrigin).href,
        {
          method: "GET",
          credentials: "include",
          headers: createNativeExportHeaders(authBearer, editorVersion, false),
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

      logNativeExport("fileOperations.redirect poll", lastPollSnapshot);

      if (response.ok && (isZipContentType(contentType) || isMarkdownResponse(contentType, response.url))) {
        directArchiveResponse = response;
        archiveUrl = response.url;
        logNativeExport("resolved archive as direct payload response", {
          archiveUrl,
          contentType,
          attempt: attempt + 1
        });
        break;
      }

      if (response.status >= 300 && response.status < 400 && locationHeader) {
        archiveUrl = new URL(locationHeader, baseOrigin).href;
        logNativeExport("resolved archive from location header", {
          archiveUrl,
          attempt: attempt + 1
        });
        break;
      }

      if (response.type === "opaqueredirect" && response.url && /storage\.yandexcloud\.net/i.test(response.url)) {
        archiveUrl = response.url;
        logNativeExport("resolved archive from opaqueredirect url", {
          archiveUrl,
          attempt: attempt + 1
        });
        break;
      }

      if (response.type === "opaqueredirect") {
        logNativeExport("opaqueredirect detected, retrying same endpoint with follow", {
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

        logNativeExport("followed redirect response", {
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
          logNativeExport("resolved archive after follow retry", {
            archiveUrl,
            contentType: followedContentType,
            attempt: attempt + 1
          });
          break;
        }
      }
    } catch (error) {
      lastNetworkError = error;
      logNativeExport("fileOperations.redirect poll failed", {
        attempt: attempt + 1,
        message: error instanceof Error ? error.message : String(error || "")
      });
    }

    await waitWithAbort(500, signal);
  }

  if (!archiveUrl && !directArchiveResponse) {
    if (lastNetworkError instanceof Error && lastNetworkError.message) {
      throw new Error(`Yonote не отдал архив native export: ${lastNetworkError.message}`);
    }

    const snapshotSuffix = lastPollSnapshot
      ? ` Последний ответ: status=${lastPollSnapshot.status}, type=${lastPollSnapshot.type || "-"}, redirected=${lastPollSnapshot.redirected ? "yes" : "no"}, content-type=${lastPollSnapshot.contentType || "-"}, location=${lastPollSnapshot.hasLocation ? "yes" : "no"}.`
      : "";

    logNativeExport("timed out while waiting for archive", lastPollSnapshot || { operationId });
    throw new Error(`Yonote слишком долго готовил native export.${snapshotSuffix}`);
  }

  return {
    archiveUrl,
    directArchiveResponse
  };
}

export async function downloadArchivePayload({
  baseOrigin,
  operationId,
  archiveUrl,
  directArchiveResponse,
  authBearer,
  editorVersion,
  signal
}) {
  let downloadedPayload = null;
  let nextArchiveUrl = archiveUrl;
  let nextDirectArchiveResponse = directArchiveResponse;

  if (!nextArchiveUrl && operationId && typeof XMLHttpRequest !== "undefined") {
    downloadedPayload = await pollNativeExportArchiveViaXhr({
      baseOrigin,
      operationId,
      authBearer,
      editorVersion,
      signal
    });
  }

  if (!nextArchiveUrl && !downloadedPayload) {
    const resolvedArchive = await resolveArchiveFromRedirect({
      baseOrigin,
      operationId,
      authBearer,
      editorVersion,
      signal
    });
    nextArchiveUrl = resolvedArchive.archiveUrl;
    nextDirectArchiveResponse = resolvedArchive.directArchiveResponse;
  }

  if (downloadedPayload) {
    logNativeExport("export payload obtained via xhr", {
      byteLength: downloadedPayload.buffer && downloadedPayload.buffer.byteLength ? downloadedPayload.buffer.byteLength : 0,
      contentType: downloadedPayload.contentType || "",
      responseURL: downloadedPayload.responseURL || ""
    });
    return downloadedPayload;
  }

  throwIfAborted(signal);
  const downloadResponse =
    nextDirectArchiveResponse ||
    (await fetch(nextArchiveUrl, {
      method: "GET",
      cache: "no-store",
      signal
    }));

  const contentType = downloadResponse.headers.get("content-type") || "";
  logNativeExport("archive download response", {
    status: downloadResponse.status,
    ok: downloadResponse.ok,
    type: downloadResponse.type || "",
    url: downloadResponse.url || nextArchiveUrl,
    contentType
  });
  if (
    !downloadResponse.ok ||
    !(isZipContentType(contentType) || isMarkdownResponse(contentType, downloadResponse.url || nextArchiveUrl))
  ) {
    throw new Error("Yonote не отдал архив native export.");
  }

  return {
    buffer: await downloadResponse.arrayBuffer(),
    contentType,
    responseURL: downloadResponse.url || nextArchiveUrl
  };
}
