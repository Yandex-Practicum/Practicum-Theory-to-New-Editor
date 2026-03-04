(function initBridgeChunk() {
  const bridgeInternals = globalThis.__PHBridgeInternals || (globalThis.__PHBridgeInternals = {});
  Object.assign(globalThis, bridgeInternals);

  function normalizeNewlines(value) {
    return String(value || "").replace(/\r\n?/g, "\n");
  }

  function normalizeInlineText(value) {
    return normalizeNewlines(value)
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\s*\n\s*/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function escapeMarkdownPlainText(value) {
    return String(value || "").replace(/_/g, "\\_");
  }

  function unescapeMarkdownPlainText(value) {
    return String(value || "").replace(/\\_/g, "_");
  }

  function normalizeBlockText(value) {
    return normalizeNewlines(value)
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function trimBlockText(value) {
    return normalizeNewlines(value).replace(/^\n+|\n+$/g, "").trimEnd();
  }

  function isBlank(line) {
    return !String(line || "").trim();
  }

  function markBridgeInitialized(kind) {
    const registry = globalThis[INIT_REGISTRY_KEY] || (globalThis[INIT_REGISTRY_KEY] = Object.create(null));
    const key = `${BRIDGE_BUILD}:${kind}`;
    if (registry[key]) {
      return false;
    }
    registry[key] = true;
    return true;
  }

  function createBridgeEnvelope(bridgeKind, payload = {}) {
    return {
      bridgeVersion: BRIDGE_BUILD,
      bridgeKind,
      ...payload
    };
  }

  function hasMatchingBridgeEnvelope(value, bridgeKind, expectedVersion = BRIDGE_BUILD) {
    return Boolean(
      value &&
        typeof value === "object" &&
        value.bridgeVersion === expectedVersion &&
        value.bridgeKind === bridgeKind
    );
  }

  function normalizeFallbackLine(line) {
    return String(line || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+$/g, "")
      .replace(/^(\s*)[–—]\s+/, "$1- ");
  }

  function nextNonBlankIndex(lines, startIndex) {
    for (let index = startIndex; index < lines.length; index += 1) {
      if (!isBlank(lines[index])) {
        return index;
      }
    }
    return -1;
  }

  function buildYonoteFallbackBody(text) {
    const lines = normalizeNewlines(text)
      .split("\n")
      .map(normalizeFallbackLine);

    const output = [];
    let index = 0;

    while (index < lines.length) {
      const trimmed = String(lines[index] || "").trim();

      if (!trimmed) {
        if (output.length && output[output.length - 1] !== "") {
          output.push("");
        }
        index += 1;
        continue;
      }

      if (/^Кнопка:\s*$/i.test(trimmed)) {
        const labelIndex = nextNonBlankIndex(lines, index + 1);
        if (labelIndex !== -1) {
          output.push(`[Кнопка]: ${String(lines[labelIndex] || "").trim()}`);
          index = labelIndex + 1;
          continue;
        }
      }

      if (/^Кнопка:\s+.+$/i.test(trimmed)) {
        output.push(trimmed.replace(/^Кнопка:\s+/i, "[Кнопка]: "));
        index += 1;
        continue;
      }

      output.push(lines[index]);
      index += 1;
    }

    return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function buildMarkdownWithTitle(title, body) {
    const heading = title ? `# ${title}` : "";
    const textBody = normalizeBlockText(body || "");

    if (heading && textBody) {
      return `${heading}\n\n${textBody}`.trim();
    }

    return (heading || textBody).trim();
  }

  function stripUtf8Bom(text) {
    return String(text || "").replace(/^\uFEFF/, "");
  }

  function decodeTextBytes(bytes) {
    if (typeof TextDecoder === "undefined") {
      return "";
    }

    try {
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    } catch {
      return "";
    }
  }

  Object.assign(bridgeInternals, {
    normalizeNewlines,
    normalizeInlineText,
    escapeMarkdownPlainText,
    unescapeMarkdownPlainText,
    normalizeBlockText,
    trimBlockText,
    isBlank,
    markBridgeInitialized,
    createBridgeEnvelope,
    hasMatchingBridgeEnvelope,
    normalizeFallbackLine,
    nextNonBlankIndex,
    buildYonoteFallbackBody,
    buildMarkdownWithTitle,
    stripUtf8Bom,
    decodeTextBytes
  });
  Object.assign(globalThis, bridgeInternals);
})();
