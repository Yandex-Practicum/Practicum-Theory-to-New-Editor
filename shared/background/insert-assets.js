import { BRIDGE_KINDS, EXT_BUILD, MESSAGE_TYPES } from "../constants.js";
import {
  clearStoredSourceAssetsMetadata,
  encodeArrayBufferToBase64,
  rewriteMarkdownImageTargets
} from "./asset-helpers.js";
import { getSupportedImageMimeType } from "./asset-helpers.js";
import { mapInBatches } from "./runtime-helpers.js";
import { buildTheoryUploadFileName } from "./upload-filenames.js";

export function createInsertAssetFlow({ deps, taskRuntime, theoryUploadBatchSize }) {
  async function uploadSourceAssets(task, tab, storedSource, sourceAssets, insertMarkdown) {
    let nextMarkdown = insertMarkdown;
    let uploadedImageCount = 0;
    let skippedImageCount = 0;
    const uploadedAssetUrls = new Map();

    await taskRuntime.appendTaskDebug(task.id, "Uploading theory resources in batches", {
      assetCount: sourceAssets.length,
      batchSize: theoryUploadBatchSize
    });

    const uploadResults = await mapInBatches(sourceAssets, theoryUploadBatchSize, async asset => {
      const assetBytes = await deps.loadSourceAssetBytes(storedSource.sourceStorageId || "", asset.id);
      if (!(assetBytes instanceof ArrayBuffer) || !assetBytes.byteLength) {
        return {
          assetId: asset.id,
          success: false,
          fileUrl: "",
          reason: "missing-bytes"
        };
      }

      const uploadResponse = await deps.sendBridgeMessage({
        tabId: tab.id,
        kind: BRIDGE_KINDS.THEORY,
        message: {
          type: MESSAGE_TYPES.UPLOAD_THEORY_RESOURCE,
          fileName: buildTheoryUploadFileName(asset),
          mimeType: asset.mimeType || getSupportedImageMimeType(asset.path || asset.id || ""),
          bytesBase64: encodeArrayBufferToBase64(assetBytes),
          expectedBridgeVersion: EXT_BUILD
        }
      });

      if (uploadResponse && uploadResponse.success && uploadResponse.fileUrl) {
        return {
          assetId: asset.id,
          success: true,
          fileUrl: String(uploadResponse.fileUrl),
          reason: ""
        };
      }

      return {
        assetId: asset.id,
        success: false,
        fileUrl: "",
        reason: "upload-failed"
      };
    });

    for (const uploadResult of uploadResults) {
      if (!uploadResult) {
        skippedImageCount += 1;
        continue;
      }

      if (uploadResult.success && uploadResult.fileUrl) {
        uploadedAssetUrls.set(uploadResult.assetId, uploadResult.fileUrl);
        uploadedImageCount += 1;
        continue;
      }

      skippedImageCount += 1;
    }

    await taskRuntime.appendTaskDebug(task.id, "Theory resource uploads finished", {
      uploadedImageCount,
      skippedImageCount
    });

    if (uploadedAssetUrls.size) {
      nextMarkdown = rewriteMarkdownImageTargets(
        nextMarkdown,
        String(storedSource && storedSource.assetBasePath ? storedSource.assetBasePath : ""),
        uploadedAssetUrls
      );
      await taskRuntime.appendTaskDebug(task.id, "Rewrote markdown image URLs", {
        uploadedImageCount
      });
    }

    return {
      insertMarkdown: nextMarkdown,
      uploadedImageCount,
      skippedImageCount
    };
  }

  async function clearStoredInsertAssets(task, storedSource, sourceAssets) {
    if (!sourceAssets.length) {
      return;
    }

    try {
      await deps.clearSourceAssets();
      await deps.saveStoredSource(clearStoredSourceAssetsMetadata(storedSource));
      await taskRuntime.appendTaskDebug(task.id, "Cleared stored image assets after successful append");
    } catch (error) {
      await taskRuntime.appendTaskDebug(task.id, "Failed to clear stored image assets", {
        message: error instanceof Error ? error.message : String(error || "")
      });
    }
  }

  return {
    uploadSourceAssets,
    clearStoredInsertAssets
  };
}
