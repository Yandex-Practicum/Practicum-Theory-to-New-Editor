(function initYonoteMainBridge() {
  const shared = globalThis.PracticumHelperBridgeShared;
  if (!shared || !shared.markBridgeInitialized("yonote-main")) {
    return;
  }

  const context = {
    authBearer: "",
    editorVersion: ""
  };

  function updateContext(nextValues) {
    if (nextValues.authBearer) {
      context.authBearer = nextValues.authBearer;
    }
    if (nextValues.editorVersion) {
      context.editorVersion = nextValues.editorVersion;
    }
  }

  function resolveUrl(input) {
    if (typeof input === "string") {
      return input;
    }
    if (input instanceof Request) {
      return input.url;
    }
    if (input && typeof input.url === "string") {
      return input.url;
    }
    return "";
  }

  function resolveMethod(input, init) {
    if (init && typeof init.method === "string" && init.method) {
      return init.method.toUpperCase();
    }
    if (input instanceof Request && typeof input.method === "string" && input.method) {
      return input.method.toUpperCase();
    }
    return "GET";
  }

  function parseBodyForCapture(body) {
    if (body === undefined || body === null) {
      return null;
    }

    if (typeof body === "string") {
      return shared.parseJsonSafe(body) || body;
    }

    if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
      return body.toString();
    }

    return null;
  }

  function collectHeaders(input, init) {
    const headers = new Headers();

    if (input instanceof Request) {
      input.headers.forEach((value, key) => headers.set(key, value));
    }

    const initHeaders = init && init.headers ? new Headers(init.headers) : null;
    if (initHeaders) {
      initHeaders.forEach((value, key) => headers.set(key, value));
    }

    return headers;
  }

  function maybeCaptureHeaders(headers) {
    const authBearer = headers.get("authorization") || "";
    const editorVersion = headers.get("x-editor-version") || "";
    if (authBearer || editorVersion) {
      updateContext({ authBearer, editorVersion });
    }
  }

  function captureResponseSnapshot(url, method, requestBody, contentType, status, rawBody) {
    if (
      !shared.shouldCaptureYonoteApiResponse({
        url,
        contentType,
        status,
        responseLength: rawBody.length
      })
    ) {
      return;
    }

    const parsed = shared.parseJsonSafe(rawBody);
    if (!parsed) {
      return;
    }

    shared.captureYonoteApiSnapshot({
      url,
      method,
      requestBody,
      responseBody: parsed,
      sourceSlug: shared.getYonoteSlugFromPath(window.location.pathname)
    });
  }

  function patchFetch() {
    if (typeof globalThis.fetch !== "function" || globalThis.fetch.__phYonotePatched) {
      return;
    }

    const originalFetch = globalThis.fetch;

    const patchedFetch = function patchedFetch(input, init) {
      const url = resolveUrl(input);
      const method = resolveMethod(input, init);
      const requestBody = parseBodyForCapture(init && Object.prototype.hasOwnProperty.call(init, "body") ? init.body : null);

      try {
        maybeCaptureHeaders(collectHeaders(input, init));
      } catch {
        // Keep page behavior intact even if the capture logic fails.
      }

      const responsePromise = originalFetch.apply(this, arguments);

      responsePromise
        .then(response => {
          if (!response || typeof response.clone !== "function") {
            return;
          }

          const contentType = response.headers.get("content-type") || "";
          response
            .clone()
            .text()
            .then(rawBody => {
              captureResponseSnapshot(url, method, requestBody, contentType, response.status, rawBody);
            })
            .catch(() => {});
        })
        .catch(() => {});

      return responsePromise;
    };

    patchedFetch.__phYonotePatched = true;
    globalThis.fetch = patchedFetch;
  }

  function patchXhr() {
    const proto = globalThis.XMLHttpRequest && globalThis.XMLHttpRequest.prototype;
    if (!proto || proto.__phYonotePatched) {
      return;
    }

    const originalOpen = proto.open;
    const originalSetRequestHeader = proto.setRequestHeader;
    const originalSend = proto.send;

    proto.open = function patchedOpen(method, url) {
      this.__phYonoteHeaders = {};
      this.__phYonoteUrl = url;
      this.__phYonoteMethod = String(method || "GET").toUpperCase();
      return originalOpen.apply(this, arguments);
    };

    proto.setRequestHeader = function patchedSetRequestHeader(name, value) {
      if (!this.__phYonoteHeaders) {
        this.__phYonoteHeaders = {};
      }
      this.__phYonoteHeaders[String(name || "").toLowerCase()] = String(value || "");
      maybeCaptureHeaders(new Headers(this.__phYonoteHeaders));
      return originalSetRequestHeader.apply(this, arguments);
    };

    proto.send = function patchedSend(body) {
      this.__phYonoteRequestBody = parseBodyForCapture(body);
      this.addEventListener("loadend", () => {
        const contentType = this.getResponseHeader && (this.getResponseHeader("content-type") || "");
        captureResponseSnapshot(
          this.__phYonoteUrl || "",
          this.__phYonoteMethod || "GET",
          this.__phYonoteRequestBody,
          contentType,
          this.status,
          this.responseText || ""
        );
      });
      return originalSend.apply(this, arguments);
    };

    proto.__phYonotePatched = true;
  }

  function delay(ms) {
    return new Promise(resolve => {
      globalThis.setTimeout(resolve, ms);
    });
  }

  function debugNativeExport(message, details) {
    try {
      if (globalThis.console && typeof globalThis.console.info === "function") {
        globalThis.console.info("[PH yonote-bridge]", message, details || "");
      }
    } catch {
      // Debug logging must not affect the bridge behavior.
    }
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

  function requestArrayBufferViaXhr(url, headers) {
    return new Promise((resolve, reject) => {
      if (typeof XMLHttpRequest === "undefined") {
        reject(new Error("XMLHttpRequest is not available."));
        return;
      }

      const xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      xhr.responseType = "arraybuffer";
      xhr.withCredentials = true;

      Object.entries(headers || {}).forEach(([key, value]) => {
        if (value) {
          xhr.setRequestHeader(key, value);
        }
      });

      xhr.onload = () => {
        resolve({
          status: xhr.status,
          response: xhr.response,
          responseURL: xhr.responseURL || "",
          headers: parseXhrHeaders(xhr.getAllResponseHeaders())
        });
      };

      xhr.onerror = () => {
        reject(new Error("XHR network error"));
      };

      xhr.onabort = () => {
        reject(new Error("XHR aborted"));
      };

      xhr.send();
    });
  }

  function isZipContentType(contentType) {
    return /application\/zip|application\/octet-stream/i.test(String(contentType || ""));
  }

  function isMarkdownContentType(contentType, responseUrl) {
    return (
      /text\/markdown|text\/plain/i.test(String(contentType || "")) ||
      /\.md(?:$|\?)/i.test(String(responseUrl || ""))
    );
  }

  function decodeNativeMarkdown(buffer) {
    return String(shared.decodeTextBytes(new Uint8Array(buffer || 0)) || "")
      .replace(/^\uFEFF/, "")
      .replace(/\r\n?/g, "\n")
      .trim();
  }

  async function fetchYonoteNativeExport(documentData, headers, sourceUrl, sourceSlug) {
    if (!documentData || !documentData.id) {
      return null;
    }

    const exportResponse = await globalThis.fetch("/api/documents.export", {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({
        id: documentData.id,
        options: {
          includeAttachments: false,
          delimiter: ";",
          includeChildren: false
        }
      })
    });

    const exportPayload = await exportResponse.json().catch(() => null);

    if (shared.isAuthFailure(exportResponse.status)) {
      context.authBearer = "";
      throw new Error("Авторизация Yonote истекла. Обновите страницу и попробуйте снова.");
    }

    if (!exportResponse.ok || !exportPayload || exportPayload.ok === false) {
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

    let downloadedPayload = null;
    let lastSnapshot = null;
    let lastNetworkError = null;
    const redirectUrl = `/api/fileOperations.redirect?id=${encodeURIComponent(operationId)}`;

    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await requestArrayBufferViaXhr(redirectUrl, headers);

        if (shared.isAuthFailure(response.status)) {
          context.authBearer = "";
          throw new Error("Авторизация Yonote истекла. Обновите страницу и попробуйте снова.");
        }

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
          (isZipContentType(contentType) || isMarkdownContentType(contentType, response.responseURL))
        ) {
          downloadedPayload = {
            buffer: response.response,
            contentType,
            responseURL: response.responseURL || ""
          };
          break;
        }
      } catch (error) {
        if (error instanceof Error && /Авторизация Yonote истекла/i.test(error.message)) {
          throw error;
        }
        lastNetworkError = error;
        debugNativeExport("fileOperations.redirect xhr poll failed", {
          attempt: attempt + 1,
          message: error instanceof Error ? error.message : String(error || "")
        });
      }

      await delay(500);
    }

    if (!downloadedPayload) {
      if (lastNetworkError instanceof Error && lastNetworkError.message) {
        throw new Error(`Yonote не отдал архив native export: ${lastNetworkError.message}`);
      }

      const snapshotSuffix = lastSnapshot
        ? ` Последний XHR-ответ: status=${lastSnapshot.status}, content-type=${lastSnapshot.contentType || "-"}, bytes=${lastSnapshot.byteLength}, responseURL=${lastSnapshot.responseURL || "-"}.`
        : "";

      throw new Error(`Yonote слишком долго готовил native export.${snapshotSuffix}`);
    }

    if (isMarkdownContentType(downloadedPayload.contentType, downloadedPayload.responseURL)) {
      const markdown = decodeNativeMarkdown(downloadedPayload.buffer);
      if (!markdown) {
        throw new Error("Yonote export вернул пустой markdown.");
      }

      return shared.buildYonoteNativeExportPayload(markdown, documentData, sourceUrl, sourceSlug, {
        diagnostics: shared.createYonoteSourceDiagnostics({
          renderApiPath: "/api/documents.export",
          renderApiMethod: "POST"
        })
      });
    }

    const entries = await shared.extractZipEntriesFromArrayBuffer(downloadedPayload.buffer);
    const markdownEntry = shared.pickPrimaryMarkdownZipEntry(entries);

    if (!markdownEntry) {
      throw new Error("В архиве Yonote export не найден markdown-файл.");
    }

    const markdown = decodeNativeMarkdown(markdownEntry.data);
    if (!markdown) {
      throw new Error("Yonote export вернул пустой markdown.");
    }

    return shared.buildYonoteNativeExportPayload(markdown, documentData, sourceUrl, sourceSlug, {
      diagnostics: shared.createYonoteSourceDiagnostics({
        renderApiPath: "/api/documents.export",
        renderApiMethod: "POST"
      })
    });
  }

  async function startYonoteNativeExport(documentData, headers) {
    if (!documentData || !documentData.id) {
      throw new Error("Yonote не вернул id документа для native export.");
    }

    debugNativeExport("starting native export", {
      documentId: documentData.id,
      title: documentData.title || ""
    });

    const exportResponse = await globalThis.fetch("/api/documents.export", {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({
        id: documentData.id,
        options: {
          includeAttachments: false,
          delimiter: ";",
          includeChildren: false
        }
      })
    });

    const exportPayload = await exportResponse.json().catch(() => null);

    if (shared.isAuthFailure(exportResponse.status)) {
      context.authBearer = "";
      throw new Error("Авторизация Yonote истекла. Обновите страницу и попробуйте снова.");
    }

    if (!exportResponse.ok || !exportPayload || exportPayload.ok === false) {
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

    debugNativeExport("native export operation created", {
      operationId
    });

    return operationId;
  }

  async function handleCopyRequest(detail) {
    const requestId = detail && detail.requestId;
    if (!requestId) {
      return;
    }

    const sourceSlug = shared.getYonoteSlugFromPath(window.location.pathname);
    if (!sourceSlug) {
      respond(requestId, {
        success: false,
        error: "Откройте страницу документа Yonote с URL вида /doc/..."
      });
      return;
    }

    if (!context.authBearer) {
      respond(requestId, {
        success: false,
        error: "Не удалось поймать bearer-токен. Перезагрузите страницу Yonote и повторите."
      });
      return;
    }

    const preferredMode = detail && detail.preferredMode === "native-export-context"
      ? "native-export-context"
      : detail && detail.preferredMode === "native-export"
        ? "native-export"
        : "structured-first";

    let domAst = [];
    if (preferredMode === "structured-first") {
      const contentRoot = shared.findYonoteContentRoot(document);
      if (contentRoot) {
        domAst = shared.extractYonoteSourceAst(contentRoot);
      }
    }

    const headers = {
      accept: "application/json",
      "content-type": "application/json",
      authorization: context.authBearer
    };

    if (context.editorVersion) {
      headers["x-editor-version"] = context.editorVersion;
    }

    try {
      const response = await globalThis.fetch("/api/documents.info", {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({
          id: sourceSlug,
          includeCommentsCount: true
        })
      });

      const payload = await response.json().catch(() => null);

      if (shared.isAuthFailure(response.status)) {
        context.authBearer = "";
        respond(requestId, {
          success: false,
          error: "Авторизация Yonote истекла. Обновите страницу и попробуйте снова."
        });
        return;
      }

      if (!response.ok || !payload || payload.ok === false) {
        respond(requestId, {
          success: false,
          error: "Yonote API вернул ошибку при загрузке документа."
        });
        return;
      }

      if (!payload.data) {
        respond(requestId, {
          success: false,
          error: "Yonote API не вернул данные документа."
        });
        return;
      }

      if (preferredMode === "native-export-context") {
        const operationId = await startYonoteNativeExport(payload.data, headers);
        respond(requestId, {
          success: true,
          sourceMode: "Yonote native export",
          nativeExportContext: {
            baseOrigin: window.location.origin,
            sourceUrl: window.location.href,
            sourceSlug,
            documentId: String(payload.data.id || ""),
            collectionId: String(payload.data.collectionId || ""),
            revision: Number(payload.data.revision || 0),
            title: String(payload.data.title || ""),
            authBearer: context.authBearer,
            editorVersion: context.editorVersion,
            operationId,
            downloadUrl: ""
          },
          diagnostics: shared.createYonoteSourceDiagnostics({
            renderApiPath: "/api/documents.export",
            renderApiMethod: "POST"
          })
        });
        return;
      }

      if (preferredMode === "native-export") {
        const nativePayload = await fetchYonoteNativeExport(payload.data, headers, window.location.href, sourceSlug);
        if (!nativePayload || !nativePayload.markdown) {
          respond(requestId, {
            success: false,
            error: "Yonote native export не вернул markdown."
          });
          return;
        }

        respond(requestId, {
          success: true,
          sourceMode: nativePayload.sourceMode,
          payload: nativePayload,
          diagnostics: nativePayload.diagnostics
        });
        return;
      }

      if (!domAst.length) {
        const contentRoot = shared.findYonoteContentRoot(document);
        if (contentRoot) {
          domAst = shared.extractYonoteSourceAst(contentRoot);
        }
      }

      const sourceResult = shared.buildYonoteSourceResult({
        captureRegistry: shared.getYonoteNetworkCaptureRegistry(),
        domAst,
        documentData: payload.data,
        sourceUrl: window.location.href,
        sourceSlug
      });

      respond(requestId, {
        success: true,
        sourceMode: sourceResult.payload.sourceMode,
        payload: sourceResult.payload,
        diagnostics: sourceResult.diagnostics
      });
    } catch (error) {
      respond(requestId, {
        success: false,
        error: error instanceof Error ? error.message : "Ошибка запроса к Yonote API."
      });
    }
  }

  function respond(requestId, result) {
    globalThis.dispatchEvent(
      new CustomEvent(shared.EVENT_TYPES.YONOTE_COPY_RESPONSE, {
        detail: {
          requestId,
          result: shared.createBridgeEnvelope("yonote", result)
        }
      })
    );
  }

  patchFetch();
  patchXhr();

  globalThis.addEventListener(shared.EVENT_TYPES.YONOTE_COPY_REQUEST, event => {
    handleCopyRequest(event.detail || {});
  });
})();
