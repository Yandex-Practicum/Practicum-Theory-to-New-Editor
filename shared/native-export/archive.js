export function decodeTextBytes(bytes) {
  if (typeof TextDecoder === "undefined") {
    return "";
  }

  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return "";
  }
}

function readUint16LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32LE(bytes, offset) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function findZipEndOfCentralDirectory(bytes) {
  const minOffset = Math.max(0, bytes.length - 0xffff - 22);
  for (let offset = bytes.length - 22; offset >= minOffset; offset -= 1) {
    if (readUint32LE(bytes, offset) === 0x06054b50) {
      return offset;
    }
  }
  return -1;
}

async function inflateZipEntry(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Браузер не поддерживает распаковку ZIP (DecompressionStream).");
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const inflated = await new Response(stream).arrayBuffer();
  return new Uint8Array(inflated);
}

export async function extractZipEntriesFromArrayBuffer(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || 0);
  const eocdOffset = findZipEndOfCentralDirectory(bytes);

  if (eocdOffset < 0) {
    throw new Error("Yonote export вернул некорректный ZIP.");
  }

  const totalEntries = readUint16LE(bytes, eocdOffset + 10);
  const centralDirectoryOffset = readUint32LE(bytes, eocdOffset + 16);
  const entries = [];
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (readUint32LE(bytes, cursor) !== 0x02014b50) {
      throw new Error("Yonote export ZIP имеет поврежденный каталог.");
    }

    const flags = readUint16LE(bytes, cursor + 8);
    const compressionMethod = readUint16LE(bytes, cursor + 10);
    const compressedSize = readUint32LE(bytes, cursor + 20);
    const uncompressedSize = readUint32LE(bytes, cursor + 24);
    const fileNameLength = readUint16LE(bytes, cursor + 28);
    const extraLength = readUint16LE(bytes, cursor + 30);
    const commentLength = readUint16LE(bytes, cursor + 32);
    const localHeaderOffset = readUint32LE(bytes, cursor + 42);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + fileNameLength;
    const rawName = bytes.slice(nameStart, nameEnd);
    const name = decodeTextBytes(rawName);
    const isUtf8 = Boolean(flags & 0x0800);

    if (!isUtf8 && !name) {
      throw new Error("Не удалось прочитать имя файла из Yonote export.");
    }

    if (readUint32LE(bytes, localHeaderOffset) !== 0x04034b50) {
      throw new Error("Yonote export ZIP имеет поврежденный local header.");
    }

    const localNameLength = readUint16LE(bytes, localHeaderOffset + 26);
    const localExtraLength = readUint16LE(bytes, localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const rawEntry = bytes.slice(dataOffset, dataOffset + compressedSize);

    let data;
    if (compressionMethod === 0) {
      data = rawEntry;
    } else if (compressionMethod === 8) {
      data = await inflateZipEntry(rawEntry);
    } else {
      throw new Error("Yonote export использует неподдерживаемое сжатие ZIP.");
    }

    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      data
    });

    cursor = nameEnd + extraLength + commentLength;
  }

  return entries;
}

function countPathDepth(path) {
  return String(path || "")
    .split("/")
    .filter(Boolean).length;
}

export function pickPrimaryMarkdownZipEntry(entries) {
  const markdownEntries = (Array.isArray(entries) ? entries : []).filter(entry => /\.md$/i.test(entry.name || ""));
  if (!markdownEntries.length) {
    return null;
  }

  markdownEntries.sort((left, right) => {
    const depthDiff = countPathDepth(left.name) - countPathDepth(right.name);
    if (depthDiff !== 0) {
      return depthDiff;
    }

    const sizeDiff = Number(right.uncompressedSize || 0) - Number(left.uncompressedSize || 0);
    if (sizeDiff !== 0) {
      return sizeDiff;
    }

    return String(left.name || "").localeCompare(String(right.name || ""));
  });

  return markdownEntries[0];
}
