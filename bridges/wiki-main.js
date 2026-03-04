(function initWikiMainBridge() {
  const shared = globalThis.PracticumHelperBridgeShared;
  if (!shared || !shared.markBridgeInitialized("wiki-main")) {
    return;
  }

  const WIKI_HOST_RE = /(^|\.)wiki\.yandex-team\.ru$/i;

  function respond(requestId, result) {
    globalThis.dispatchEvent(
      new CustomEvent(shared.EVENT_TYPES.WIKI_COPY_RESPONSE, {
        detail: {
          requestId,
          result: shared.createBridgeEnvelope("wiki", result)
        }
      })
    );
  }

  function handleCopyRequest(detail) {
    const requestId = detail && detail.requestId ? detail.requestId : "";

    try {
      if (!WIKI_HOST_RE.test(String(globalThis.location && globalThis.location.hostname) || "")) {
        respond(requestId, {
          success: false,
          error: "Откройте страницу wiki.yandex-team.ru и повторите."
        });
        return;
      }

      const contentRoot = shared.findWikiContentRoot(document);
      if (!contentRoot) {
        respond(requestId, {
          success: false,
          error: "Не удалось найти контент страницы wiki."
        });
        return;
      }

      const ast = shared.extractWikiSourceAst(contentRoot);
      if (!Array.isArray(ast) || !ast.length) {
        respond(requestId, {
          success: false,
          error: "Не удалось извлечь содержимое страницы wiki."
        });
        return;
      }

      const assets = shared.extractWikiInlineImageAssets(contentRoot);
      const contentRootSelector = contentRoot.matches("main.WikiPage-Content")
        ? "main.WikiPage-Content"
        : contentRoot.classList.contains("PageDoc")
          ? ".PageDoc"
          : contentRoot.tagName.toLowerCase();
      const payload = shared.buildWikiStructuredPayload(ast, assets, globalThis.location.href, {
        documentTitle: document.title || "",
        contentRootSelector,
        domImageCount: Number(contentRoot.querySelectorAll("img").length || 0)
      });

      respond(requestId, {
        success: true,
        payload
      });
    } catch (error) {
      respond(requestId, {
        success: false,
        error: error instanceof Error ? error.message : "Не удалось обработать страницу wiki."
      });
    }
  }

  globalThis.addEventListener(shared.EVENT_TYPES.WIKI_COPY_REQUEST, event => {
    handleCopyRequest(event.detail || {});
  });
})();
