import { getPathBaseName } from "./asset-helpers.js";

const MIME_EXTENSION_MAP = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg"
};

function sanitizeNamePart(value, fallback) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^[._-]+|[._-]+$/g, "");

  return normalized || fallback;
}

function splitFileNameParts(fileName) {
  const normalized = String(fileName || "").trim();
  const match = normalized.match(/^(.*?)(\.[a-z0-9]{1,10})$/i);
  if (!match) {
    return {
      stem: normalized,
      extension: ""
    };
  }

  return {
    stem: match[1],
    extension: match[2].toLowerCase()
  };
}

function hashString(value) {
  const input = String(value || "");
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function resolveUploadExtension(asset, fileName) {
  const nameParts = splitFileNameParts(fileName);
  if (nameParts.extension) {
    return nameParts.extension;
  }

  return MIME_EXTENSION_MAP[String((asset && asset.mimeType) || "").trim().toLowerCase()] || "";
}

export function buildTheoryUploadFileName(asset) {
  const explicitName = String((asset && asset.fileName) || "").trim();
  const fallbackName = getPathBaseName((asset && (asset.path || asset.id)) || "");
  const rawName = explicitName || fallbackName || "image";
  const nameParts = splitFileNameParts(rawName);
  const stem = sanitizeNamePart(nameParts.stem, "image");
  const extension = resolveUploadExtension(asset, rawName);
  const hashSuffix = hashString((asset && (asset.id || asset.path || rawName)) || "").slice(0, 8);

  return `${stem}-${hashSuffix}${extension}`;
}
