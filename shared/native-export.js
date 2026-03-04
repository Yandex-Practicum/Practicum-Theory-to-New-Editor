import {
  decodeTextBytes,
  extractZipEntriesFromArrayBuffer,
  pickPrimaryMarkdownZipEntry
} from "./native-export/archive.js";
import {
  isMarkdownResponse,
  logNativeExport,
  throwIfAborted
} from "./native-export/network.js";
import { createNativeExportOperation, downloadArchivePayload } from "./native-export/request.js";

function stripUtf8Bom(text) {
  return String(text || "").replace(/^\uFEFF/, "");
}

function normalizeMarkdownPayload(buffer) {
  const markdown = stripUtf8Bom(decodeTextBytes(new Uint8Array(buffer || 0)))
    .replace(/\r\n?/g, "\n")
    .trim();

  if (!markdown) {
    throw new Error("Yonote export вернул пустой markdown.");
  }

  return markdown;
}

export { decodeTextBytes, extractZipEntriesFromArrayBuffer, pickPrimaryMarkdownZipEntry };

export async function requestYonoteNativeExport({
  baseOrigin,
  documentId,
  operationId: initialOperationId,
  downloadUrl,
  authBearer,
  editorVersion,
  signal
}) {
  let archiveUrl = String(downloadUrl || "").trim();
  let operationId = String(initialOperationId || "").trim();

  logNativeExport("start", {
    baseOrigin,
    documentId,
    hasOperationId: Boolean(operationId),
    hasDownloadUrl: Boolean(archiveUrl)
  });

  if (!archiveUrl && !operationId) {
    operationId = await createNativeExportOperation({
      baseOrigin,
      documentId,
      authBearer,
      editorVersion,
      signal
    });
  }

  const downloadedPayload = await downloadArchivePayload({
    baseOrigin,
    operationId,
    archiveUrl,
    directArchiveResponse: null,
    authBearer,
    editorVersion,
    signal
  });

  if (isMarkdownResponse(downloadedPayload.contentType, downloadedPayload.responseURL)) {
    const markdown = normalizeMarkdownPayload(downloadedPayload.buffer);
    logNativeExport("direct markdown payload received", {
      markdownLength: markdown.length,
      responseURL: downloadedPayload.responseURL || ""
    });
    return {
      markdown,
      entries: []
    };
  }

  const entries = await extractZipEntriesFromArrayBuffer(downloadedPayload.buffer);
  const markdownEntry = pickPrimaryMarkdownZipEntry(entries);

  if (!markdownEntry) {
    throw new Error("В архиве Yonote export не найден markdown-файл.");
  }

  const markdown = normalizeMarkdownPayload(markdownEntry.data || new Uint8Array());
  logNativeExport("archive unpacked", {
    totalEntries: entries.length,
    markdownEntry: markdownEntry.name,
    markdownLength: markdown.length
  });

  return {
    markdown,
    entries
  };
}
