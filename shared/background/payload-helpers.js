import { EXT_BUILD } from "../constants.js";
import { ensureLeadingTitleHeading } from "./markdown-helpers.js";
import { estimateBlockCount, normalizeDate } from "./runtime-helpers.js";

function normalizePayloadAssetMetadata(payload) {
  const assets = Array.isArray(payload && payload.assets) ? payload.assets : [];
  const assetBasePath = payload && typeof payload.assetBasePath === "string" ? payload.assetBasePath : "";
  const assetCount =
    payload && Number.isFinite(Number(payload.assetCount)) ? Number(payload.assetCount) : assets.length;

  return {
    assetBasePath,
    assets,
    assetCount
  };
}

export function buildCopyPayload(response, provider, fallbackCapturedAt) {
  const payload = response && response.payload ? response.payload : null;
  if (!payload || !payload.markdown) {
    throw new Error(response && response.error ? response.error : "Не удалось получить markdown из источника.");
  }

  const assetMetadata = normalizePayloadAssetMetadata(payload);

  return {
    ...payload,
    provider: provider.id,
    providerLabel: payload.providerLabel || provider.label,
    bridgeVersion: payload.bridgeVersion || response.bridgeVersion || EXT_BUILD,
    capturedAt: payload.capturedAt || normalizeDate(fallbackCapturedAt).toISOString(),
    diagnostics: payload.diagnostics || response.diagnostics || {},
    sourceStorageId: "",
    assetBasePath: assetMetadata.assetBasePath,
    assets: assetMetadata.assets,
    assetCount: assetMetadata.assetCount
  };
}

export function buildCopyPayloadFromNativeExport(
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
