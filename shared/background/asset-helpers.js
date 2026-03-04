const IMAGE_EXTENSION_TO_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

function stripWrappedLinkTarget(target) {
  const trimmed = String(target || "").trim();
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

export function parseMarkdownImageLinkTarget(rawTarget) {
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

export function isAbsoluteHttpUrl(target) {
  return /^https?:\/\//i.test(String(target || "").trim());
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

export function getPathBaseName(path) {
  const normalized = normalizeZipPath(path);
  const lastSlashIndex = normalized.lastIndexOf("/");
  return lastSlashIndex < 0 ? normalized : normalized.slice(lastSlashIndex + 1);
}

export function getSupportedImageMimeType(path) {
  const normalized = normalizeZipPath(path).toLowerCase();
  const match = normalized.match(/(\.[a-z0-9]+)$/i);
  if (!match) {
    return "";
  }

  return IMAGE_EXTENSION_TO_MIME[match[1]] || "";
}

function resolveAssetPath(target, baseDir) {
  const rawTarget = parseMarkdownImageLinkTarget(target).path;
  if (!rawTarget) {
    return "";
  }

  if (isExternalAssetTarget(rawTarget)) {
    return isAbsoluteHttpUrl(rawTarget) ? rawTarget : "";
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

export function toDetachedArrayBuffer(value) {
  if (value instanceof ArrayBuffer) {
    return value.slice(0);
  }

  if (ArrayBuffer.isView(value)) {
    const view = value;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  }

  return new Uint8Array().buffer;
}

export function encodeArrayBufferToBase64(buffer) {
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

export function extractReferencedImageAssets(markdown, entries) {
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

export function rewriteMarkdownImageTargets(markdown, assetBasePath, uploadedAssetUrls) {
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

export function clearStoredSourceAssetsMetadata(storedSource) {
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
