import { clearStoredSourceAssetsMetadata, toDetachedArrayBuffer } from "./asset-helpers.js";
import { mapInBatches } from "./runtime-helpers.js";

export function createCopyAssetPersistence({ deps, taskRuntime, sourceAssetFetchBatchSize }) {
  async function clearStaleSourceAssets(taskId) {
    try {
      await deps.clearSourceAssets();
    } catch (error) {
      await taskRuntime.appendTaskDebug(taskId, "Failed to clear stale source assets", {
        message: error instanceof Error ? error.message : String(error || "")
      });
    }
  }

  async function persistBridgePayloadAssets(taskId, payload) {
    const sourceAssets = Array.isArray(payload && payload.assets) ? payload.assets : [];
    if (!sourceAssets.length) {
      await clearStaleSourceAssets(taskId);
      return clearStoredSourceAssetsMetadata(payload);
    }

    await taskRuntime.replaceCurrentTask(taskId, {
      message: "Сохраняю картинки источника в фоне..."
    });
    await taskRuntime.appendTaskDebug(taskId, "Attempting background source asset fetch", {
      assetCount: sourceAssets.length,
      batchSize: sourceAssetFetchBatchSize
    });

    const fetchedAssets = await mapInBatches(sourceAssets, sourceAssetFetchBatchSize, async asset => {
      const result = await deps.fetchSourceAssetBytes(asset);
      if (!result || !(result.bytes instanceof ArrayBuffer) || !result.bytes.byteLength) {
        return null;
      }

      return {
        ref: {
          ...asset,
          mimeType: result.mimeType || asset.mimeType || "",
          byteLength: Number(result.byteLength || result.bytes.byteLength || 0)
        },
        binary: {
          id: asset.id,
          bytes: toDetachedArrayBuffer(result.bytes)
        }
      };
    });

    const successful = fetchedAssets.filter(Boolean);
    const successfulAssetRefs = successful.map(item => item.ref);
    const successfulAssetBinaries = successful.map(item => item.binary);
    const skippedAssetCount = Math.max(0, sourceAssets.length - successful.length);
    await taskRuntime.appendTaskDebug(taskId, "Background source asset fetch finished", {
      discoveredAssetCount: sourceAssets.length,
      savedAssetCount: successful.length,
      skippedAssetCount
    });

    if (!successfulAssetBinaries.length) {
      await clearStaleSourceAssets(taskId);
      return clearStoredSourceAssetsMetadata(payload);
    }

    await deps.replaceSourceAssets(taskId, successfulAssetBinaries);
    return {
      ...payload,
      sourceStorageId: String(taskId || ""),
      assetBasePath: String(payload && payload.assetBasePath ? payload.assetBasePath : ""),
      assets: successfulAssetRefs,
      assetCount: successfulAssetRefs.length
    };
  }

  return {
    clearStaleSourceAssets,
    persistBridgePayloadAssets
  };
}
