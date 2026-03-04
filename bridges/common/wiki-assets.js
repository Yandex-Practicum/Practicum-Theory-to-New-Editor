(function initBridgeChunk() {
  const bridgeInternals = globalThis.__PHBridgeInternals || (globalThis.__PHBridgeInternals = {});
  Object.assign(globalThis, bridgeInternals);

function inferWikiImageMimeType(url) {
  const normalized = String(url || "").toLowerCase();
  const match = normalized.match(/(\.png|\.jpe?g|\.gif|\.webp|\.svg)(?:$|[?#])/i);
  if (!match) {
    return "";
  }

  if (match[1] === ".png") return "image/png";
  if (match[1] === ".jpg" || match[1] === ".jpeg") return "image/jpeg";
  if (match[1] === ".gif") return "image/gif";
  if (match[1] === ".webp") return "image/webp";
  if (match[1] === ".svg") return "image/svg+xml";
  return "";
}

function buildWikiAssetFileName(url, index) {
  const fallback = `wiki-image-${index + 1}`;

  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname || "";
    const fileName = pathname.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(fileName || fallback) || fallback;
  } catch {
    return fallback;
  }
}

function extractWikiInlineImageAssets(root) {
  const imageElements = Array.from((root && root.querySelectorAll("img")) || []);
  const assets = [];
  const seen = new Set();
  let filteredUiImageCount = 0;

  imageElements.forEach((element, index) => {
    if (isWikiUiImageElement(element, root)) {
      filteredUiImageCount += 1;
      return;
    }

    const imageUrl = resolveWikiImageUrl(element);
    if (!imageUrl || seen.has(imageUrl)) {
      return;
    }

    seen.add(imageUrl);
    assets.push({
      id: imageUrl,
      path: imageUrl,
      fileName: buildWikiAssetFileName(imageUrl, index),
      mimeType: inferWikiImageMimeType(imageUrl),
      byteLength: 0
    });
  });

  assets.domImageCount = imageElements.length;
  assets.filteredUiImageCount = filteredUiImageCount;
  return assets;
}

function getWikiSourceSlug(sourceUrl) {
  try {
    return String(new URL(sourceUrl).pathname || "").replace(/^\/+|\/+$/g, "");
  } catch {
    return "";
  }
}

function pickWikiTitleFromAst(ast, fallbackTitle) {
  const headingNode = (Array.isArray(ast) ? ast : []).find(node => {
    return node && node.kind === "heading" && node.level === 1 && normalizeInlineText(node.text || "");
  });
  if (headingNode) {
    return normalizeInlineText(headingNode.text || "");
  }

  return normalizeInlineText(fallbackTitle || "");
}

function buildWikiStructuredPayload(ast, assets, sourceUrl, pageMetadata = {}) {
  const normalizedAst = Array.isArray(ast) ? ast : [];
  const normalizedAssets = Array.isArray(assets) ? assets : [];
  const title = pickWikiTitleFromAst(normalizedAst, pageMetadata.documentTitle || "");
  const effectiveAst = dropDuplicateTitleHeading(normalizedAst, title);
  const bodyMarkdown = compileSourceAstToMarkdown(effectiveAst);
  const domImageCount = Number(pageMetadata.domImageCount || normalizedAssets.domImageCount || 0);
  const filteredUiImageCount = Number(
    pageMetadata.filteredUiImageCount ||
      normalizedAssets.filteredUiImageCount ||
      Math.max(0, domImageCount - normalizedAssets.length)
  );

  return {
    title,
    markdown: buildMarkdownWithTitle(title, bodyMarkdown),
    sourceUrl: String(sourceUrl || ""),
    sourceSlug: getWikiSourceSlug(sourceUrl),
    documentId: "",
    collectionId: "",
    revision: 0,
    provider: "wiki",
    providerLabel: "Wiki",
    sourceMode: "Wiki rendered DOM",
    bridgeVersion: BRIDGE_BUILD,
    capturedAt: new Date().toISOString(),
    blockCount: effectiveAst.length,
    sourceStorageId: "",
    assetBasePath: "",
    assets: normalizedAssets.slice(),
    assetCount: normalizedAssets.length,
    diagnostics: {
      contentRootSelector: String(pageMetadata.contentRootSelector || "").trim(),
      domImageCount,
      filteredUiImageCount
    }
  };
}

  Object.assign(bridgeInternals, {
    inferWikiImageMimeType,
    buildWikiAssetFileName,
    extractWikiInlineImageAssets,
    getWikiSourceSlug,
    pickWikiTitleFromAst,
    buildWikiStructuredPayload
  });
  Object.assign(globalThis, {
    inferWikiImageMimeType,
    buildWikiAssetFileName,
    extractWikiInlineImageAssets,
    getWikiSourceSlug,
    pickWikiTitleFromAst,
    buildWikiStructuredPayload
  });
})();
