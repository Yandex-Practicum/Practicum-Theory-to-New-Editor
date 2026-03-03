(function initTheoryMainBridge() {
  const shared = globalThis.PracticumHelperBridgeShared;
  if (!shared || !shared.markBridgeInitialized("theory-main")) {
    return;
  }

  const context = {
    authToken: "",
    rootBlockId: "",
    treeId: ""
  };

  function updateContext(nextValues) {
    if (nextValues.authToken) {
      context.authToken = nextValues.authToken;
    }
    if (nextValues.rootBlockId) {
      context.rootBlockId = nextValues.rootBlockId;
    }
    if (nextValues.treeId) {
      context.treeId = nextValues.treeId;
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

  function maybeCaptureRequest(url, headers) {
    const authToken = headers.get("x-authtoken") || "";
    const rootBlockId = shared.extractRootBlockIdFromUrl(url);
    if (authToken || rootBlockId) {
      updateContext({ authToken, rootBlockId });
    }
  }

  function maybeCaptureResponse(url, payload) {
    const rootBlockId = shared.extractRootBlockIdFromUrl(url);
    const treeId = shared.extractTreeId(payload);
    if (rootBlockId || treeId) {
      updateContext({ rootBlockId, treeId });
    }
  }

  function patchFetch() {
    if (typeof globalThis.fetch !== "function" || globalThis.fetch.__phTheoryPatched) {
      return;
    }

    const originalFetch = globalThis.fetch;

    const patchedFetch = function patchedFetch(input, init) {
      const url = resolveUrl(input);

      try {
        maybeCaptureRequest(url, collectHeaders(input, init));
      } catch {
        // Keep page behavior intact even if capture fails.
      }

      const responsePromise = originalFetch.apply(this, arguments);

      responsePromise
        .then(response => {
          if (!response || typeof response.clone !== "function") {
            return;
          }
          const contentType = response.headers.get("content-type") || "";
          if (!/application\/json/i.test(contentType)) {
            return;
          }
          if (!/\/api\/theory_blocks\//i.test(url)) {
            return;
          }
          response
            .clone()
            .json()
            .then(payload => {
              maybeCaptureResponse(url, payload);
            })
            .catch(() => {});
        })
        .catch(() => {});

      return responsePromise;
    };

    patchedFetch.__phTheoryPatched = true;
    globalThis.fetch = patchedFetch;
  }

  function patchXhr() {
    const proto = globalThis.XMLHttpRequest && globalThis.XMLHttpRequest.prototype;
    if (!proto || proto.__phTheoryPatched) {
      return;
    }

    const originalOpen = proto.open;
    const originalSetRequestHeader = proto.setRequestHeader;
    const originalSend = proto.send;

    proto.open = function patchedOpen(method, url) {
      this.__phTheoryHeaders = {};
      this.__phTheoryUrl = url;
      return originalOpen.apply(this, arguments);
    };

    proto.setRequestHeader = function patchedSetRequestHeader(name, value) {
      if (!this.__phTheoryHeaders) {
        this.__phTheoryHeaders = {};
      }
      this.__phTheoryHeaders[String(name || "").toLowerCase()] = String(value || "");
      maybeCaptureRequest(this.__phTheoryUrl || "", new Headers(this.__phTheoryHeaders));
      return originalSetRequestHeader.apply(this, arguments);
    };

    proto.send = function patchedSend() {
      this.addEventListener("loadend", () => {
        const contentType = this.getResponseHeader && (this.getResponseHeader("content-type") || "");
        if (!/application\/json/i.test(contentType || "")) {
          return;
        }
        if (!/\/api\/theory_blocks\//i.test(String(this.__phTheoryUrl || ""))) {
          return;
        }
        const payload = shared.parseJsonSafe(this.responseText || "");
        if (payload) {
          maybeCaptureResponse(this.__phTheoryUrl || "", payload);
        }
      });
      return originalSend.apply(this, arguments);
    };

    proto.__phTheoryPatched = true;
  }

  function createHeaders(withJson = false) {
    const headers = {
      accept: "application/json",
      "x-authtoken": context.authToken
    };

    if (withJson) {
      headers["content-type"] = "application/json";
    }

    return headers;
  }

  async function requestJson(url, options = {}) {
    const response = await globalThis.fetch(url, {
      credentials: "include",
      ...options
    });

    const payload = await response.json().catch(() => null);
    if (payload) {
      maybeCaptureResponse(url, payload);
    }

    return { response, payload };
  }

  async function deleteBlocks(createdIds) {
    for (let index = createdIds.length - 1; index >= 0; index -= 1) {
      const id = createdIds[index];
      try {
        await globalThis.fetch(`/api/theory_blocks/${id}/`, {
          method: "DELETE",
          credentials: "include",
          headers: createHeaders(false)
        });
      } catch {
        // Best-effort rollback.
      }
    }
  }

  function decodeBase64ToUint8Array(value) {
    const normalized = String(value || "").trim();
    if (!normalized) {
      return new Uint8Array();
    }

    if (typeof atob === "function") {
      const binary = atob(normalized);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes;
    }

    if (typeof Buffer !== "undefined") {
      return new Uint8Array(Buffer.from(normalized, "base64"));
    }

    throw new Error("Не удалось декодировать binary payload.");
  }

  async function handleUploadResourceRequest(detail) {
    const requestId = detail && detail.requestId;
    const fileName = typeof detail?.fileName === "string" ? detail.fileName.trim() : "";
    const mimeType = typeof detail?.mimeType === "string" ? detail.mimeType.trim() : "";
    const bytesBase64 = typeof detail?.bytesBase64 === "string" ? detail.bytesBase64 : "";

    if (!requestId) {
      return;
    }

    if (!shared.isTheoryPath(window.location.pathname)) {
      respondUpload(requestId, {
        success: false,
        error: "Откройте страницу урока, URL которой заканчивается на /theory/."
      });
      return;
    }

    if (!context.authToken) {
      respondUpload(requestId, {
        success: false,
        error: "Не удалось поймать API-контекст. Перезагрузите страницу теории и повторите."
      });
      return;
    }

    if (!fileName || !bytesBase64) {
      respondUpload(requestId, {
        success: false,
        error: "Нет binary payload для загрузки ресурса."
      });
      return;
    }

    try {
      const bytes = decodeBase64ToUint8Array(bytesBase64);
      if (!bytes.length) {
        respondUpload(requestId, {
          success: false,
          error: "Пустой binary payload для загрузки ресурса."
        });
        return;
      }

      const formData = new FormData();
      const fileLike =
        typeof File === "function"
          ? new File([bytes], fileName, { type: mimeType || "application/octet-stream" })
          : new Blob([bytes], { type: mimeType || "application/octet-stream" });

      formData.append("file", fileLike, fileName);

      const response = await globalThis.fetch("/api/resources/", {
        method: "POST",
        credentials: "include",
        headers: createHeaders(false),
        body: formData
      });
      const payload = await response.json().catch(() => null);

      if (shared.isAuthFailure(response.status)) {
        context.authToken = "";
        respondUpload(requestId, {
          success: false,
          error: "Авторизация Praktikum истекла. Обновите страницу и попробуйте снова."
        });
        return;
      }

      if (
        !response.ok ||
        !payload ||
        typeof payload.id !== "number" ||
        typeof payload.file !== "string" ||
        !payload.file
      ) {
        respondUpload(requestId, {
          success: false,
          error: "Не удалось загрузить ресурс в Praktikum."
        });
        return;
      }

      respondUpload(requestId, {
        success: true,
        resourceId: payload.id,
        fileUrl: payload.file,
        resourceType: typeof payload.resource_type === "string" ? payload.resource_type : ""
      });
    } catch (error) {
      respondUpload(requestId, {
        success: false,
        error: error instanceof Error ? error.message : "Ошибка загрузки ресурса."
      });
    }
  }

  async function handleAppendRequest(detail) {
    const requestId = detail && detail.requestId;
    const markdown = typeof detail?.markdown === "string" ? detail.markdown : "";

    if (!requestId) {
      return;
    }

    if (!shared.isTheoryPath(window.location.pathname)) {
      respond(requestId, {
        success: false,
        error: "Откройте страницу урока, URL которой заканчивается на /theory/."
      });
      return;
    }

    if (!markdown.trim()) {
      respond(requestId, {
        success: false,
        error: "Нет markdown для вставки."
      });
      return;
    }

    if (!context.authToken || !context.rootBlockId) {
      respond(requestId, {
        success: false,
        error: "Не удалось поймать API-контекст. Перезагрузите страницу теории и повторите."
      });
      return;
    }

    const compiledBlocks = shared.compileTheoryBlocks(markdown);
    if (!compiledBlocks.length) {
      respond(requestId, {
        success: false,
        error: "Компилятор не смог собрать ни одного блока."
      });
      return;
    }

    const createdIds = [];

    try {
      const initialTree = await requestJson(`/api/theory_blocks/${context.rootBlockId}/get_tree/`, {
        method: "GET",
        headers: createHeaders(false)
      });

      if (shared.isAuthFailure(initialTree.response.status)) {
        context.authToken = "";
        respond(requestId, {
          success: false,
          error: "Авторизация Praktikum истекла. Обновите страницу и попробуйте снова."
        });
        return;
      }

      if (!initialTree.response.ok || !initialTree.payload) {
        respond(requestId, {
          success: false,
          error: "Не удалось получить текущее дерево теории."
        });
        return;
      }

      if (!context.treeId) {
        context.treeId = shared.extractTreeId(initialTree.payload);
      }

      if (!context.treeId) {
        respond(requestId, {
          success: false,
          error: "Не удалось определить tree_id. Перезагрузите страницу теории."
        });
        return;
      }

      const existingNested = shared.extractRootNested(initialTree.payload, context.rootBlockId);

      for (const block of compiledBlocks) {
        const createResult = await requestJson("/api/theory_blocks/", {
          method: "POST",
          headers: createHeaders(true),
          body: JSON.stringify(
            shared.buildTheoryBlockPayload(block, {
              treeId: context.treeId,
              rootBlockId: context.rootBlockId
            })
          )
        });

        if (!createResult.response.ok || !createResult.payload) {
          await deleteBlocks(createdIds);
          respond(requestId, {
            success: false,
            error: "Не удалось создать один из theory blocks. Откат выполнен."
          });
          return;
        }

        const createdId = shared.extractCreatedBlockId(createResult.payload);
        if (!createdId) {
          await deleteBlocks(createdIds);
          respond(requestId, {
            success: false,
            error: "API не вернул id созданного блока. Откат выполнен."
          });
          return;
        }

        createdIds.push(createdId);
      }

      const patchResult = await requestJson(`/api/theory_blocks/${context.rootBlockId}/`, {
        method: "PATCH",
        headers: createHeaders(true),
        body: JSON.stringify({
          nested: [...existingNested, ...createdIds]
        })
      });

      if (!patchResult.response.ok) {
        await deleteBlocks(createdIds);
        respond(requestId, {
          success: false,
          error: "Не удалось привязать новые блоки к дереву. Откат выполнен."
        });
        return;
      }

      const tableCount = compiledBlocks.filter(block => block.kind === "table").length;
      const imageCount = compiledBlocks.filter(block => block.kind === "image").length;
      respond(requestId, {
        success: true,
        createdIds,
        appendedCount: createdIds.length,
        tableCount,
        imageCount,
        partial: false
      });
    } catch (error) {
      if (createdIds.length) {
        await deleteBlocks(createdIds);
      }
      respond(requestId, {
        success: false,
        error: error instanceof Error ? error.message : "Ошибка Praktikum API."
      });
    }
  }

  function respond(requestId, result) {
    globalThis.dispatchEvent(
      new CustomEvent(shared.EVENT_TYPES.THEORY_APPEND_RESPONSE, {
        detail: {
          requestId,
          result: shared.createBridgeEnvelope("theory", result)
        }
      })
    );
  }

  function respondUpload(requestId, result) {
    globalThis.dispatchEvent(
      new CustomEvent(shared.EVENT_TYPES.THEORY_UPLOAD_RESOURCE_RESPONSE, {
        detail: {
          requestId,
          result: shared.createBridgeEnvelope("theory", result)
        }
      })
    );
  }

  patchFetch();
  patchXhr();

  globalThis.addEventListener(shared.EVENT_TYPES.THEORY_APPEND_REQUEST, event => {
    handleAppendRequest(event.detail || {});
  });
  globalThis.addEventListener(shared.EVENT_TYPES.THEORY_UPLOAD_RESOURCE_REQUEST, event => {
    handleUploadResourceRequest(event.detail || {});
  });
})();
