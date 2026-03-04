(function initPracticumHelperBridgeShared() {
  const BRIDGE_BUILD = "3.5.1-background-worker-r2";
  const existingShared = globalThis.PracticumHelperBridgeShared;
  if (existingShared && existingShared.bridgeVersion === BRIDGE_BUILD) {
    return;
  }

  function scopeBridgeName(name) {
    return `${name}::${BRIDGE_BUILD}`;
  }

  const MESSAGE_TYPES = {
    COPY_FROM_YONOTE: scopeBridgeName("PH_COPY_FROM_YONOTE"),
    COPY_FROM_WIKI: scopeBridgeName("PH_COPY_FROM_WIKI"),
    APPEND_TEXT_BLOCKS: scopeBridgeName("PH_APPEND_TEXT_BLOCKS"),
    UPLOAD_THEORY_RESOURCE: scopeBridgeName("PH_UPLOAD_THEORY_RESOURCE")
  };

  const EVENT_TYPES = {
    YONOTE_COPY_REQUEST: scopeBridgeName("PH_YONOTE_COPY_REQUEST"),
    YONOTE_COPY_RESPONSE: scopeBridgeName("PH_YONOTE_COPY_RESPONSE"),
    WIKI_COPY_REQUEST: scopeBridgeName("PH_WIKI_COPY_REQUEST"),
    WIKI_COPY_RESPONSE: scopeBridgeName("PH_WIKI_COPY_RESPONSE"),
    THEORY_APPEND_REQUEST: scopeBridgeName("PH_THEORY_APPEND_REQUEST"),
    THEORY_APPEND_RESPONSE: scopeBridgeName("PH_THEORY_APPEND_RESPONSE"),
    THEORY_UPLOAD_RESOURCE_REQUEST: scopeBridgeName("PH_THEORY_UPLOAD_RESOURCE_REQUEST"),
    THEORY_UPLOAD_RESOURCE_RESPONSE: scopeBridgeName("PH_THEORY_UPLOAD_RESOURCE_RESPONSE")
  };

  const YONOTE_DOC_PATH_RE = /^\/doc\/([^/?#]+)/i;
  const THEORY_PATH_RE = /\/theory\/?$/i;
  const THEORY_GET_TREE_RE = /\/api\/theory_blocks\/([0-9a-f-]+)\/get_tree\/?$/i;
  const EXCLUDED_SUBTREE_TERMS = [
    "comment",
    "sidebar",
    "toolbar",
    "popover",
    "tooltip",
    "drawer",
    "avatar",
    "breadcrumbs"
  ];
  const BLOCK_LIKE_TAGS = new Set([
    "ADDRESS",
    "ARTICLE",
    "ASIDE",
    "BLOCKQUOTE",
    "DD",
    "DIV",
    "DL",
    "DT",
    "FIELDSET",
    "FIGCAPTION",
    "FIGURE",
    "FOOTER",
    "FORM",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HEADER",
    "HR",
    "LI",
    "MAIN",
    "NAV",
    "OL",
    "P",
    "PRE",
    "SECTION",
    "TABLE",
    "TD",
    "TH",
    "UL"
  ]);
  const BLOCK_BREAK_TAGS = new Set([
    "ADDRESS",
    "ARTICLE",
    "BLOCKQUOTE",
    "DIV",
    "FIGCAPTION",
    "FIGURE",
    "FOOTER",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HEADER",
    "HR",
    "LI",
    "P",
    "PRE",
    "SECTION",
    "TABLE",
    "TR"
  ]);
  const RAW_MARKER_RE = /^(?:\[Кнопка\]:\s*.+|Кнопка:\s*.+|⚒️\s*Задание\b.*|Квиз-текстовое поле без проверки)$/i;
  const PSEUDO_BULLET_RE = /^[•–—]\s+/;
  const INIT_REGISTRY_KEY = "__PH_BRIDGE_INIT__";
  const YONOTE_CAPTURE_REGISTRY_KEY = "__PH_YONOTE_NETWORK_CAPTURE__";
  const YONOTE_CAPTURE_LIMIT = 20;
  const YONOTE_CAPTURE_MAX_TEXT_BYTES = 3 * 1024 * 1024;
  const YONOTE_CAPTURE_NOISE_TERMS = [
    "comment",
    "comments",
    "reaction",
    "presence",
    "analytics",
    "track",
    "events",
    "notifications"
  ];
  const STRUCTURED_NODE_TYPE_KEYS = ["type", "kind", "nodeType", "blockType"];
  const STRUCTURED_CHILD_KEYS = ["content", "children", "items", "nodes", "blocks"];
  const STRUCTURED_TEXT_KEYS = ["text", "plainText", "value", "title", "label"];
  const HEADING_TYPE_ALIASES = new Set(["heading", "header", "title", "subtitle"]);
  const PARAGRAPH_TYPE_ALIASES = new Set(["paragraph", "text", "rich_text", "body"]);
  const UNORDERED_LIST_TYPE_ALIASES = new Set(["bullet_list", "bulleted_list", "unordered_list", "list"]);
  const ORDERED_LIST_TYPE_ALIASES = new Set(["ordered_list", "numbered_list"]);
  const LIST_ITEM_TYPE_ALIASES = new Set(["list_item", "item"]);
  const TABLE_TYPE_ALIASES = new Set(["table"]);
  const TABLE_ROW_TYPE_ALIASES = new Set(["table_row", "row"]);
  const TABLE_CELL_TYPE_ALIASES = new Set(["table_cell", "table_header", "cell"]);
  const BLOCKQUOTE_TYPE_ALIASES = new Set(["blockquote", "quote", "callout"]);
  const CODE_BLOCK_TYPE_ALIASES = new Set(["code", "code_block", "preformatted"]);
  const DIVIDER_TYPE_ALIASES = new Set(["divider", "hr", "separator"]);

  function createRequestId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    return `ph-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function parseJsonSafe(value) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

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

  async function extractZipEntriesFromArrayBuffer(buffer) {
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

  function pickPrimaryMarkdownZipEntry(entries) {
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

  function isElementNode(node) {
    return Boolean(node && node.nodeType === 1);
  }

  function isTextNode(node) {
    return Boolean(node && node.nodeType === 3);
  }

  function getTagName(element) {
    return isElementNode(element) ? element.tagName.toUpperCase() : "";
  }

  function getOwnerWindow(node) {
    return (node && node.ownerDocument && node.ownerDocument.defaultView) || globalThis;
  }

  function getComputedStyleSafe(element) {
    const view = getOwnerWindow(element);
    if (!view || typeof view.getComputedStyle !== "function") {
      return null;
    }
    return view.getComputedStyle(element);
  }

  function isVisibleElement(element) {
    if (!isElementNode(element)) {
      return false;
    }

    if (element.hidden) {
      return false;
    }

    if (String(element.getAttribute("aria-hidden") || "").toLowerCase() === "true") {
      return false;
    }

    const style = getComputedStyleSafe(element);
    if (!style) {
      return true;
    }

    return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse";
  }

  function matchesExcludedTerm(value) {
    const normalized = String(value || "").toLowerCase();
    return EXCLUDED_SUBTREE_TERMS.some(term => normalized.includes(term));
  }

  function hasExcludedAttribute(element) {
    if (!isElementNode(element)) {
      return false;
    }

    if (matchesExcludedTerm(element.id) || matchesExcludedTerm(element.className)) {
      return true;
    }

    return Array.from(element.attributes || []).some(attribute => {
      return attribute.name.startsWith("data-") && matchesExcludedTerm(attribute.value);
    });
  }

  function isExcludedSubtreeRoot(element) {
    const tagName = getTagName(element);
    if (!tagName) {
      return false;
    }

    if (tagName === "ASIDE" || tagName === "NAV") {
      return true;
    }

    if (String(element.getAttribute("role") || "").toLowerCase() === "dialog") {
      return true;
    }

    if (String(element.getAttribute("aria-modal") || "").toLowerCase() === "true") {
      return true;
    }

    return hasExcludedAttribute(element);
  }

  function isInsideExcludedSubtree(element, boundary) {
    let current = element;
    while (current && current !== boundary) {
      if (isExcludedSubtreeRoot(current)) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }

  function getViewportWidth(element) {
    const view = getOwnerWindow(element);
    if (view && typeof view.innerWidth === "number" && view.innerWidth > 0) {
      return view.innerWidth;
    }

    const doc = element && element.ownerDocument;
    if (doc && doc.documentElement && doc.documentElement.clientWidth > 0) {
      return doc.documentElement.clientWidth;
    }

    return 0;
  }

  function isInCentralViewportBand(element) {
    const viewportWidth = getViewportWidth(element);
    if (!viewportWidth || typeof element.getBoundingClientRect !== "function") {
      return true;
    }

    const rect = element.getBoundingClientRect();
    if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.width) || rect.width <= 0) {
      return true;
    }

    const midpoint = rect.left + rect.width / 2;
    return midpoint >= viewportWidth * 0.2 && midpoint <= viewportWidth * 0.8;
  }

  function isInteractiveControlElement(element) {
    const tagName = getTagName(element);
    return (
      tagName === "BUTTON" ||
      tagName === "INPUT" ||
      tagName === "TEXTAREA" ||
      tagName === "SELECT" ||
      (tagName === "A" && String(element.getAttribute("role") || "").toLowerCase() === "button")
    );
  }

  function collectDescendants(root, visitor) {
    const items = [];

    function walk(node) {
      if (!isElementNode(node)) {
        return;
      }

      for (const child of Array.from(node.children || [])) {
        if (!isVisibleElement(child) || isExcludedSubtreeRoot(child)) {
          continue;
        }

        if (visitor(child)) {
          items.push(child);
        }

        walk(child);
      }
    }

    walk(root);
    return items;
  }

  function scoreYonoteCandidate(candidate) {
    if (!isVisibleElement(candidate) || isExcludedSubtreeRoot(candidate) || !isInCentralViewportBand(candidate)) {
      return null;
    }

    const descendants = collectDescendants(candidate, () => true);
    const semanticDescendants = descendants.filter(element => {
      const tagName = getTagName(element);
      return (
        /^H[1-6]$/.test(tagName) ||
        ["P", "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "BLOCKQUOTE", "PRE", "CODE", "HR", "IMG"]
          .includes(tagName)
      );
    });

    if (!semanticDescendants.length) {
      return null;
    }

    const candidateText = normalizeInlineText(candidate.textContent || "");
    const wordCount = candidateText ? candidateText.split(/\s+/).filter(Boolean).length : 0;
    if (candidateText.length < 80 && wordCount < 12) {
      return null;
    }

    const tables = semanticDescendants.filter(element => getTagName(element) === "TABLE").length;
    const lists = semanticDescendants.filter(element => {
      const tagName = getTagName(element);
      return tagName === "UL" || tagName === "OL";
    }).length;
    const headings = semanticDescendants.filter(element => /^H[2-6]$/.test(getTagName(element))).length;
    const blockquotes = semanticDescendants.filter(element => getTagName(element) === "BLOCKQUOTE").length;
    const preBlocks = semanticDescendants.filter(element => getTagName(element) === "PRE").length;
    const images = semanticDescendants.filter(element => getTagName(element) === "IMG").length;
    const paragraphs = semanticDescendants.filter(element => getTagName(element) === "P").length;
    const interactive = descendants.filter(isInteractiveControlElement).length;
    const commentMarkers = descendants.filter(element => hasExcludedAttribute(element)).length;

    const semanticSignal = semanticDescendants.length + Math.max(1, Math.floor(paragraphs / 2));
    const highInteractiveDensity = interactive >= 3 && interactive * 2 >= semanticSignal;

    let score = 0;
    if (tables > 0) score += 5;
    if (lists > 0) score += 4;
    if (headings > 0) score += 4;
    if (blockquotes > 0) score += 3;
    if (preBlocks > 0) score += 3;
    if (images > 0) score += 2;
    score += Math.floor(paragraphs / 3);
    if (highInteractiveDensity) score -= 5;
    if (commentMarkers > 0 || matchesExcludedTerm(candidateText)) score -= 8;

    return score;
  }

  function findYonoteContentRoot(documentRef) {
    function pickBestCandidate(scopeRoot) {
      if (!scopeRoot || !isVisibleElement(scopeRoot)) {
        return null;
      }

      const candidates = [scopeRoot, ...Array.from(scopeRoot.querySelectorAll("*"))]
        .filter(element => isElementNode(element) && element.children && element.children.length)
        .filter(element => !isInsideExcludedSubtree(element, scopeRoot))
        .map(element => ({
          element,
          score: scoreYonoteCandidate(element)
        }))
        .filter(item => item.score !== null);

      if (!candidates.length) {
        return null;
      }

      candidates.sort((left, right) => right.score - left.score);
      return candidates[0].element;
    }

    const scopedRoot =
      documentRef && (documentRef.querySelector("main") || documentRef.querySelector('[role="main"]'));
    const scopedCandidate = pickBestCandidate(scopedRoot);
    if (scopedCandidate) {
      return scopedCandidate;
    }

    const proseMirrorRoots = Array.from((documentRef && documentRef.querySelectorAll(".ProseMirror")) || [])
      .filter(element => isElementNode(element) && isVisibleElement(element))
      .filter(element => !isExcludedSubtreeRoot(element))
      .map(element => ({
        element,
        score: scoreYonoteCandidate(element)
      }))
      .filter(item => item.score !== null);

    if (!proseMirrorRoots.length) {
      return null;
    }

    proseMirrorRoots.sort((left, right) => right.score - left.score);
    return proseMirrorRoots[0].element;
  }

  function collectTextWithLineBreaks(node) {
    if (isTextNode(node)) {
      return escapeMarkdownPlainText(node.textContent || "");
    }

    if (!isElementNode(node) || !isVisibleElement(node) || isExcludedSubtreeRoot(node)) {
      return "";
    }

    const tagName = getTagName(node);
    if (tagName === "BR") {
      return "\n";
    }

    if (tagName === "A") {
      const linkText = normalizeInlineText(Array.from(node.childNodes || []).map(collectTextWithLineBreaks).join(""));
      if (!linkText) {
        return "";
      }

      const href = resolveMarkdownHref(node);
      if (!href) {
        return linkText;
      }

      return `[${linkText}](${href})`;
    }

    const parts = [];
    for (const child of Array.from(node.childNodes || [])) {
      const piece = collectTextWithLineBreaks(child);
      if (!piece) {
        continue;
      }

      if (isElementNode(child) && BLOCK_BREAK_TAGS.has(getTagName(child))) {
        parts.push(`\n${piece}\n`);
      } else {
        parts.push(piece);
      }
    }

    return parts.join("");
  }

  function resolveMarkdownHref(element) {
    if (!isElementNode(element)) {
      return "";
    }

    const rawHref = String(element.getAttribute("href") || "").trim();
    if (!rawHref) {
      return "";
    }

    if (/^javascript:/i.test(rawHref)) {
      return "";
    }

    try {
      const base =
        (element.ownerDocument && element.ownerDocument.location && element.ownerDocument.location.href) ||
        (globalThis.location && globalThis.location.href) ||
        "https://yonote.ru/";
      return new URL(rawHref, base).href;
    } catch {
      return rawHref;
    }
  }

  function createTextualNodeFromText(text) {
    const normalized = normalizeBlockText(text);
    if (!normalized) {
      return null;
    }

    const pseudoList = parsePseudoList(normalized);
    if (pseudoList) {
      return pseudoList;
    }

    if (RAW_MARKER_RE.test(normalized)) {
      return {
        kind: "raw_marker",
        text: normalized
      };
    }

    return {
      kind: "paragraph",
      text: normalized
    };
  }

  function parsePseudoList(text) {
    const lines = normalizeBlockText(text)
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean);

    if (lines.length < 2 || !lines.every(line => PSEUDO_BULLET_RE.test(line))) {
      return null;
    }

    const items = lines
      .map(line => line.replace(PSEUDO_BULLET_RE, "").trim())
      .filter(Boolean);

    if (items.length < 2) {
      return null;
    }

    return {
      kind: "unordered_list",
      items
    };
  }

  function isBlockLikeElement(element) {
    const tagName = getTagName(element);
    if (BLOCK_LIKE_TAGS.has(tagName)) {
      return true;
    }

    const style = getComputedStyleSafe(element);
    if (!style) {
      return false;
    }

    return style.display !== "inline" && style.display !== "contents";
  }

  function isTextOnlyBlockElement(element) {
    const tagName = getTagName(element);
    if (!tagName || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(tagName)) {
      return false;
    }

    if (!isBlockLikeElement(element)) {
      return false;
    }

    if (element.children.length !== 0) {
      return false;
    }

    return Boolean(normalizeBlockText(element.textContent || ""));
  }

  function normalizeComparisonText(value) {
    return normalizeInlineText(value)
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .toLowerCase();
  }

  function hasForbiddenSyntheticHeadingAncestor(element, rootBoundary) {
    let current = element.parentElement;
    while (current && current !== rootBoundary) {
      const tagName = getTagName(current);
      if (["LI", "TD", "TH", "BLOCKQUOTE", "BUTTON"].includes(tagName)) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }

  function nextMeaningfulSibling(element) {
    let sibling = element.nextElementSibling;
    while (sibling) {
      if (isVisibleElement(sibling) && !isExcludedSubtreeRoot(sibling)) {
        return sibling;
      }
      sibling = sibling.nextElementSibling;
    }
    return null;
  }

  function isParagraphLikeForSyntheticHeading(element) {
    const tagName = getTagName(element);
    if (["P", "UL", "OL", "TABLE"].includes(tagName)) {
      return true;
    }

    return isTextOnlyBlockElement(element);
  }

  function isSyntheticHeadingElement(element, rootBoundary) {
    if (!isTextOnlyBlockElement(element) || hasForbiddenSyntheticHeadingAncestor(element, rootBoundary)) {
      return false;
    }

    const tagName = getTagName(element);
    if (
      /^H[1-6]$/.test(tagName) ||
      ["P", "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "BLOCKQUOTE", "PRE", "CODE", "HR"]
        .includes(tagName)
    ) {
      return false;
    }

    const text = normalizeInlineText(element.textContent || "");
    if (!text || text.length > 120) {
      return false;
    }

    if (RAW_MARKER_RE.test(text) || parsePseudoList(text)) {
      return false;
    }

    const sibling = nextMeaningfulSibling(element);
    if (!sibling || !isParagraphLikeForSyntheticHeading(sibling)) {
      return false;
    }

    return true;
  }

  function extractHeadingNode(element, rootBoundary) {
    const tagName = getTagName(element);
    if (/^H[1-6]$/.test(tagName)) {
      const text = normalizeInlineText(collectTextWithLineBreaks(element));
      if (!text) {
        return null;
      }

      return {
        kind: "heading",
        level: Number(tagName.slice(1)),
        text
      };
    }

    if (isSyntheticHeadingElement(element, rootBoundary)) {
      return {
        kind: "heading",
        level: 2,
        text: normalizeInlineText(element.textContent || "")
      };
    }

    return null;
  }

  function collectListItemContent(listItem) {
    const textParts = [];
    const nestedLines = [];

    for (const child of Array.from(listItem.childNodes || [])) {
      if (isTextNode(child)) {
        textParts.push(child.textContent || "");
        continue;
      }

      if (!isElementNode(child) || !isVisibleElement(child) || isExcludedSubtreeRoot(child)) {
        continue;
      }

      const tagName = getTagName(child);
      if (tagName === "UL" || tagName === "OL") {
        nestedLines.push(...collectNestedListLines(child, "  "));
        continue;
      }

      textParts.push(collectTextWithLineBreaks(child));
    }

    const primaryText = normalizeBlockText(textParts.join(" "));
    if (!primaryText && !nestedLines.length) {
      return "";
    }

    if (!nestedLines.length) {
      return primaryText;
    }

    return [primaryText, ...nestedLines].filter(Boolean).join("\n");
  }

  function collectNestedListLines(listElement, indent) {
    const ordered = getTagName(listElement) === "OL";
    const lines = [];
    let displayIndex = 1;

    for (const child of Array.from(listElement.children || [])) {
      if (getTagName(child) !== "LI" || !isVisibleElement(child) || isExcludedSubtreeRoot(child)) {
        continue;
      }

      const itemText = collectListItemContent(child);
      if (!itemText) {
        continue;
      }

      const itemLines = itemText.split("\n");
      const marker = ordered ? `${displayIndex}.` : "-";
      const [firstLine, ...restLines] = itemLines;

      if (firstLine) {
        lines.push(`${indent}${marker} ${firstLine}`);
      } else {
        lines.push(`${indent}${marker}`);
      }

      restLines.forEach(line => {
        lines.push(`${indent}${line}`);
      });

      displayIndex += 1;
    }

    return lines;
  }

  function extractListNode(listElement) {
    const ordered = getTagName(listElement) === "OL";
    const items = [];

    for (const child of Array.from(listElement.children || [])) {
      if (getTagName(child) !== "LI" || !isVisibleElement(child) || isExcludedSubtreeRoot(child)) {
        continue;
      }

      const content = collectListItemContent(child);
      if (content) {
        items.push(content);
      }
    }

    if (!items.length) {
      return null;
    }

    return {
      kind: ordered ? "ordered_list" : "unordered_list",
      items
    };
  }

  function extractBlockquoteNode(element) {
    const text = normalizeBlockText(collectTextWithLineBreaks(element));
    if (!text) {
      return null;
    }

    return {
      kind: "blockquote",
      text
    };
  }

  function detectCodeLanguage(preElement, codeElement) {
    const className = `${preElement.className || ""} ${codeElement ? codeElement.className || "" : ""}`;
    const match = className.match(/(?:^|\s)language-([a-z0-9_-]+)/i);
    return match ? match[1] : "";
  }

  function extractCodeBlockNode(preElement) {
    const codeElement = preElement.querySelector("code");
    const text = trimBlockText(codeElement ? codeElement.textContent || "" : preElement.textContent || "");
    if (!text) {
      return null;
    }

    return {
      kind: "code_block",
      text,
      language: detectCodeLanguage(preElement, codeElement)
    };
  }

  function extractTableNode(tableElement) {
    const rowElements = Array.from(tableElement.querySelectorAll("tr"));
    const rows = rowElements
      .map(row => {
        return Array.from(row.children || [])
          .filter(cell => {
            const tagName = getTagName(cell);
            return (tagName === "TH" || tagName === "TD") && isVisibleElement(cell) && !isExcludedSubtreeRoot(cell);
          })
          .map(cell => normalizeInlineText(collectTextWithLineBreaks(cell)));
      })
      .filter(row => row.length);

    const width = rows.reduce((maxWidth, row) => Math.max(maxWidth, row.length), 0);
    if (width < 2) {
      return null;
    }

    const normalizedRows = rows.map(row => [...row, ...new Array(width - row.length).fill("")]);
    const thead = tableElement.querySelector("thead");
    const headerRows = thead
      ? Array.from(thead.children || []).filter(child => getTagName(child) === "TR").length || 1
      : 1;

    return {
      kind: "table",
      rows: normalizedRows,
      headerRows
    };
  }

  function tryExtractSemanticNode(element, rootBoundary) {
    if (!isVisibleElement(element) || isExcludedSubtreeRoot(element) || isInteractiveControlElement(element)) {
      return null;
    }

    const headingNode = extractHeadingNode(element, rootBoundary);
    if (headingNode) {
      return headingNode;
    }

    const tagName = getTagName(element);

    if (tagName === "P") {
      return createTextualNodeFromText(collectTextWithLineBreaks(element));
    }

    if (tagName === "UL" || tagName === "OL") {
      return extractListNode(element);
    }

    if (tagName === "BLOCKQUOTE") {
      return extractBlockquoteNode(element);
    }

    if (tagName === "PRE") {
      return extractCodeBlockNode(element);
    }

    if (tagName === "HR") {
      return {
        kind: "hr"
      };
    }

    if (tagName === "TABLE") {
      return extractTableNode(element);
    }

    if (isTextOnlyBlockElement(element)) {
      return createTextualNodeFromText(collectTextWithLineBreaks(element));
    }

    return null;
  }

  function extractChildNodes(container, rootBoundary, nodes) {
    const textBuffer = [];

    function flushTextBuffer() {
      if (!textBuffer.length) {
        return;
      }

      const textNode = createTextualNodeFromText(textBuffer.join(""));
      textBuffer.length = 0;
      if (textNode) {
        nodes.push(textNode);
      }
    }

    for (const child of Array.from(container.childNodes || [])) {
      if (isTextNode(child)) {
        textBuffer.push(child.textContent || "");
        continue;
      }

      if (!isElementNode(child) || !isVisibleElement(child) || isExcludedSubtreeRoot(child) || isInteractiveControlElement(child)) {
        continue;
      }

      const semanticNode = tryExtractSemanticNode(child, rootBoundary);
      if (semanticNode) {
        flushTextBuffer();
        nodes.push(semanticNode);
        continue;
      }

      flushTextBuffer();
      extractChildNodes(child, rootBoundary, nodes);
    }

    flushTextBuffer();
  }

  function extractYonoteSourceAst(root) {
    if (!root) {
      return [];
    }

    const nodes = [];
    extractChildNodes(root, root, nodes);
    return nodes;
  }

  function isMeaningfulStructuredAst(ast) {
    if (!Array.isArray(ast) || ast.length < 3) {
      return false;
    }

    return !(ast.length === 1 && ast[0] && ast[0].kind === "paragraph");
  }

  function escapeTableCell(cell) {
    return normalizeBlockText(cell).replace(/\|/g, "\\|").replace(/\n/g, "<br>");
  }

  function serializeList(items, ordered) {
    return items
      .map((item, index) => {
        const marker = ordered ? `${index + 1}.` : "-";
        const lines = normalizeBlockText(item).split("\n");
        const [firstLine, ...restLines] = lines;

        if (!restLines.length) {
          return `${marker} ${firstLine}`;
        }

        return [`${marker} ${firstLine}`, ...restLines].join("\n");
      })
      .join("\n");
  }

  function serializeTable(rows) {
    if (!rows.length) {
      return "";
    }

    const header = rows[0];
    const separator = new Array(header.length).fill("---");
    const lines = [
      `| ${header.map(escapeTableCell).join(" | ")} |`,
      `| ${separator.join(" | ")} |`
    ];

    rows.slice(1).forEach(row => {
      lines.push(`| ${row.map(escapeTableCell).join(" | ")} |`);
    });

    return lines.join("\n");
  }

  function compileSourceAstToMarkdown(ast) {
    const blocks = [];

    (Array.isArray(ast) ? ast : []).forEach(node => {
      if (!node || !node.kind) {
        return;
      }

      let block = "";

      if (node.kind === "heading") {
        block = `${"#".repeat(node.level)} ${node.text}`;
      } else if (node.kind === "paragraph") {
        block = node.text;
      } else if (node.kind === "unordered_list") {
        block = serializeList(node.items || [], false);
      } else if (node.kind === "ordered_list") {
        block = serializeList(node.items || [], true);
      } else if (node.kind === "blockquote") {
        block = normalizeBlockText(node.text)
          .split("\n")
          .map(line => `> ${line}`)
          .join("\n");
      } else if (node.kind === "code_block") {
        const fence = node.language ? `\`\`\`${node.language}` : "```";
        block = `${fence}\n${trimBlockText(node.text)}\n\`\`\``;
      } else if (node.kind === "table") {
        block = serializeTable(node.rows || []);
      } else if (node.kind === "hr") {
        block = "---";
      } else if (node.kind === "raw_marker") {
        block = node.text;
      }

      if (block) {
        blocks.push(block);
      }
    });

    return blocks.join("\n\n").trim();
  }

  function dropDuplicateTitleHeading(ast, title) {
    if (!title || !Array.isArray(ast) || !ast.length) {
      return Array.isArray(ast) ? ast.slice() : [];
    }

    const [firstNode, ...restNodes] = ast;
    if (
      firstNode &&
      firstNode.kind === "heading" &&
      firstNode.level === 1 &&
      normalizeComparisonText(firstNode.text) === normalizeComparisonText(title)
    ) {
      return restNodes;
    }

    return ast.slice();
  }

  function createYonoteSourceDiagnostics(overrides = {}) {
    return {
      renderApiPath: "",
      renderApiMethod: "",
      schemaKind: "unknown",
      captureStatus: "missing",
      candidateScore: 0,
      fallbackReason: "",
      nodeTypeHints: [],
      ...overrides
    };
  }

  function createYonotePayloadBase(documentData, sourceUrl, sourceSlug) {
    const title = normalizeInlineText(documentData && documentData.title ? documentData.title : "");

    return {
      title,
      sourceUrl,
      sourceSlug,
      documentId: String(documentData && documentData.id ? documentData.id : ""),
      collectionId: String(documentData && documentData.collectionId ? documentData.collectionId : ""),
      revision: Number(documentData && documentData.revision ? documentData.revision : 0),
      provider: "yonote",
      providerLabel: "Yonote",
      bridgeVersion: BRIDGE_BUILD,
      capturedAt: new Date().toISOString()
    };
  }

  function buildYonoteStructuredPayload(ast, metadata, sourceUrl, sourceSlug, options = {}) {
    const base = createYonotePayloadBase(metadata, sourceUrl, sourceSlug);
    const effectiveAst = dropDuplicateTitleHeading(ast, base.title);
    const bodyMarkdown = compileSourceAstToMarkdown(effectiveAst);
    const diagnostics = createYonoteSourceDiagnostics(options.diagnostics || {});

    return {
      ...base,
      markdown: buildMarkdownWithTitle(base.title, bodyMarkdown),
      sourceMode: options.sourceMode || "Rendered DOM fallback",
      blockCount: effectiveAst.length,
      diagnostics
    };
  }

  function buildYonoteFallbackPayload(documentData, sourceUrl, sourceSlug, options = {}) {
    const base = createYonotePayloadBase(documentData, sourceUrl, sourceSlug);
    const body = buildYonoteFallbackBody(documentData && documentData.text ? documentData.text : "");
    const markdown = buildMarkdownWithTitle(base.title, body);
    const diagnostics = createYonoteSourceDiagnostics(options.diagnostics || {});

    return {
      ...base,
      markdown,
      sourceMode: "API text fallback",
      blockCount: compileTheoryBlocks(markdown).length,
      diagnostics
    };
  }

  function buildYonoteNativeExportPayload(markdownText, documentData, sourceUrl, sourceSlug, options = {}) {
    const base = createYonotePayloadBase(documentData, sourceUrl, sourceSlug);
    const rawMarkdown = normalizeNewlines(stripUtf8Bom(markdownText || "")).trim();
    const headingMatch = rawMarkdown.match(/^#\s+(.+)$/m);
    const hasMatchingTitleHeading =
      headingMatch &&
      normalizeComparisonText(headingMatch[1]) === normalizeComparisonText(base.title);
    const markdown =
      rawMarkdown && hasMatchingTitleHeading
        ? rawMarkdown
        : buildMarkdownWithTitle(base.title, rawMarkdown);
    const diagnostics = createYonoteSourceDiagnostics(options.diagnostics || {});

    return {
      ...base,
      markdown,
      sourceMode: "Yonote native export",
      blockCount: compileTheoryBlocks(markdown).length,
      diagnostics
    };
  }

  function matchesWikiUiTerm(value) {
    const normalized = String(value || "").toLowerCase();
    return [
      "avatar",
      "userpic",
      "sidebar",
      "toolbar",
      "control",
      "resource",
      "breadcrumbs",
      "breadcrumb",
      "button",
      "icon"
    ].some(term => normalized.includes(term));
  }

  function hasWikiUiAttribute(element) {
    if (!isElementNode(element)) {
      return false;
    }

    if (matchesWikiUiTerm(element.id) || matchesWikiUiTerm(element.className)) {
      return true;
    }

    return Array.from(element.attributes || []).some(attribute => {
      return attribute.name.startsWith("data-") && matchesWikiUiTerm(attribute.value);
    });
  }

  function isWikiExcludedSubtreeRoot(element) {
    const tagName = getTagName(element);
    if (!tagName) {
      return false;
    }

    if (tagName === "ASIDE" || tagName === "NAV") {
      return true;
    }

    if (String(element.getAttribute("role") || "").toLowerCase() === "dialog") {
      return true;
    }

    if (String(element.getAttribute("aria-modal") || "").toLowerCase() === "true") {
      return true;
    }

    return hasWikiUiAttribute(element);
  }

  function isWikiInlineNoiseElement(element) {
    if (!isElementNode(element)) {
      return false;
    }

    const className = String(element.className || "");
    return (
      className.includes("yfm-anchor") ||
      className.includes("HeadingEditor") ||
      className.includes("HeadingClipboardButton") ||
      className.includes("visually-hidden")
    );
  }

  function hasMeaningfulWikiContent(element) {
    if (!isElementNode(element) || !isVisibleElement(element) || isWikiExcludedSubtreeRoot(element)) {
      return false;
    }

    if (element.querySelector("h1, h2, h3, h4, h5, h6, p, ul, ol, blockquote, pre, hr, img, table")) {
      return true;
    }

    return Boolean(normalizeBlockText(element.textContent || ""));
  }

  function findWikiContentRoot(documentRef) {
    if (!documentRef) {
      return null;
    }

    const mainRoot = documentRef.querySelector("main.WikiPage-Content");
    if (mainRoot) {
      const nestedPreferredCandidates = [
        ...Array.from(mainRoot.querySelectorAll(".PageDoc.PageDoc_type_wysiwyg")),
        ...Array.from(mainRoot.querySelectorAll(".PageDoc"))
      ].filter(element => hasMeaningfulWikiContent(element));

      if (nestedPreferredCandidates.length) {
        return nestedPreferredCandidates[0];
      }

      if (hasMeaningfulWikiContent(mainRoot)) {
        return mainRoot;
      }
    }

    const candidates = Array.from(documentRef.querySelectorAll(".PageDoc"))
      .filter(element => hasMeaningfulWikiContent(element))
      .sort((left, right) => {
        const leftScore = String(left.className || "").includes("PageDoc_type_wysiwyg") ? 1 : 0;
        const rightScore = String(right.className || "").includes("PageDoc_type_wysiwyg") ? 1 : 0;
        return rightScore - leftScore;
      });

    return candidates[0] || null;
  }

  function resolveAbsoluteUrl(rawUrl, baseUrl) {
    const normalized = String(rawUrl || "").trim();
    if (!normalized) {
      return "";
    }

    try {
      return new URL(normalized, baseUrl).href;
    } catch {
      return normalized;
    }
  }

  function resolveWikiImageUrl(element) {
    if (!isElementNode(element)) {
      return "";
    }

    const baseUrl =
      (element.ownerDocument && element.ownerDocument.location && element.ownerDocument.location.href) ||
      (globalThis.location && globalThis.location.href) ||
      "https://wiki.yandex-team.ru/";
    const currentSrc = String(element.currentSrc || "").trim();
    if (currentSrc) {
      return resolveAbsoluteUrl(currentSrc, baseUrl);
    }

    return resolveAbsoluteUrl(element.getAttribute("src") || "", baseUrl);
  }

  function isWikiMetadataText(text) {
    return /^(?:обновлено(?=$|[\s:])|updated(?=$|[\s:]))/i.test(String(text || "").trim());
  }

  function isWikiMetadataElement(element) {
    if (!isElementNode(element)) {
      return false;
    }

    const text = normalizeInlineText(element.textContent || "");
    if (!text || !isWikiMetadataText(text)) {
      return false;
    }

    return !element.querySelector("h1, h2, h3, h4, h5, h6, p, ul, ol, blockquote, pre, table, img");
  }

  function isWikiUiImageElement(element, rootBoundary) {
    if (!isElementNode(element) || getTagName(element) !== "IMG") {
      return false;
    }

    const altText = String(element.getAttribute("alt") || "").toLowerCase();
    if (matchesWikiUiTerm(altText)) {
      return true;
    }

    let current = element;
    while (current && current !== rootBoundary) {
      if (isWikiExcludedSubtreeRoot(current)) {
        return true;
      }

      if (matchesWikiUiTerm(current.className) || matchesWikiUiTerm(current.id)) {
        return true;
      }

      if (isWikiMetadataElement(current)) {
        return true;
      }

      current = current.parentElement;
    }

    return false;
  }

  function buildWikiImageMarkdownFromElement(element) {
    const imageUrl = resolveWikiImageUrl(element);
    if (!imageUrl) {
      return "";
    }

    return buildImageBlockMarkdown(String(element.getAttribute("alt") || "").trim(), imageUrl, "");
  }

  function wrapWikiInlineMarkdown(tagName, text) {
    const normalized = String(text || "");
    if (!normalized) {
      return "";
    }

    if (tagName === "STRONG" || tagName === "B") {
      return `**${normalized}**`;
    }

    if (tagName === "EM" || tagName === "I") {
      return `*${normalized}*`;
    }

    if (tagName === "S" || tagName === "DEL" || tagName === "STRIKE") {
      return `~~${normalized}~~`;
    }

    if (tagName === "CODE" || tagName === "KBD") {
      const escaped = unescapeMarkdownPlainText(normalized).replace(/`/g, "\\`");
      return `\`${escaped}\``;
    }

    if (tagName === "MARK") {
      return normalized;
    }

    return normalized;
  }

  function collectWikiInlineMarkdown(node, rootBoundary) {
    if (isTextNode(node)) {
      return escapeMarkdownPlainText(node.textContent || "");
    }

    if (!isElementNode(node) || !isVisibleElement(node) || isWikiExcludedSubtreeRoot(node) || isWikiInlineNoiseElement(node)) {
      return "";
    }

    const tagName = getTagName(node);
    if (tagName === "BR") {
      return "\n";
    }

    if (tagName === "IMG") {
      return isWikiUiImageElement(node, rootBoundary) ? "" : buildWikiImageMarkdownFromElement(node);
    }

    if (tagName === "A") {
      if (String(node.className || "").includes("yfm-anchor")) {
        return "";
      }

      const linkText = normalizeInlineText(Array.from(node.childNodes || []).map(child => collectWikiInlineMarkdown(child, rootBoundary)).join(""));
      if (!linkText) {
        return "";
      }

      if (linkText.startsWith("![")) {
        return linkText;
      }

      const href = resolveMarkdownHref(node);
      if (!href) {
        return linkText;
      }

      return `[${linkText}](${href})`;
    }

    const parts = [];
    for (const child of Array.from(node.childNodes || [])) {
      const piece = collectWikiInlineMarkdown(child, rootBoundary);
      if (!piece) {
        continue;
      }

      if (isElementNode(child) && BLOCK_BREAK_TAGS.has(getTagName(child))) {
        parts.push(`\n${piece}\n`);
      } else {
        parts.push(piece);
      }
    }

    return wrapWikiInlineMarkdown(tagName, parts.join(""));
  }

  function createWikiParagraphNode(markdownText) {
    const normalized = normalizeBlockText(markdownText);
    if (!normalized) {
      return null;
    }

    return {
      kind: "paragraph",
      text: normalized
    };
  }

  function collectWikiListItemContent(listItem, rootBoundary) {
    const textParts = [];
    const nestedLines = [];

    for (const child of Array.from(listItem.childNodes || [])) {
      if (isTextNode(child)) {
        textParts.push(child.textContent || "");
        continue;
      }

      if (!isElementNode(child) || !isVisibleElement(child) || isWikiExcludedSubtreeRoot(child)) {
        continue;
      }

      const tagName = getTagName(child);
      if (tagName === "UL" || tagName === "OL") {
        nestedLines.push(...collectWikiNestedListLines(child, "  ", rootBoundary));
        continue;
      }

      textParts.push(collectWikiInlineMarkdown(child, rootBoundary));
    }

    const primaryText = normalizeBlockText(textParts.join(" "));
    if (!primaryText && !nestedLines.length) {
      return "";
    }

    if (!nestedLines.length) {
      return primaryText;
    }

    return [primaryText, ...nestedLines].filter(Boolean).join("\n");
  }

  function collectWikiNestedListLines(listElement, indent, rootBoundary) {
    const ordered = getTagName(listElement) === "OL";
    const lines = [];
    let displayIndex = 1;

    for (const child of Array.from(listElement.children || [])) {
      if (getTagName(child) !== "LI" || !isVisibleElement(child) || isWikiExcludedSubtreeRoot(child)) {
        continue;
      }

      const itemText = collectWikiListItemContent(child, rootBoundary);
      if (!itemText) {
        continue;
      }

      const itemLines = itemText.split("\n");
      const marker = ordered ? `${displayIndex}.` : "-";
      const [firstLine, ...restLines] = itemLines;

      if (firstLine) {
        lines.push(`${indent}${marker} ${firstLine}`);
      } else {
        lines.push(`${indent}${marker}`);
      }

      restLines.forEach(line => {
        lines.push(`${indent}${line}`);
      });

      displayIndex += 1;
    }

    return lines;
  }

  function extractWikiListNode(listElement, rootBoundary) {
    const ordered = getTagName(listElement) === "OL";
    const items = [];

    for (const child of Array.from(listElement.children || [])) {
      if (getTagName(child) !== "LI" || !isVisibleElement(child) || isWikiExcludedSubtreeRoot(child)) {
        continue;
      }

      const content = collectWikiListItemContent(child, rootBoundary);
      if (content) {
        items.push(content);
      }
    }

    if (!items.length) {
      return null;
    }

    return {
      kind: ordered ? "ordered_list" : "unordered_list",
      items
    };
  }

  function extractWikiHeadingNode(element) {
    const tagName = getTagName(element);
    if (!/^H[1-6]$/.test(tagName)) {
      return null;
    }

    const normalizedClone = element.cloneNode(true);
    Array.from(
      normalizedClone.querySelectorAll("a.yfm-anchor, .HeadingEditor, .HeadingClipboardButton, .visually-hidden, button")
    ).forEach(node => {
      node.remove();
    });

    const text = normalizeInlineText(normalizedClone.textContent || "");
    if (!text) {
      return null;
    }

    return {
      kind: "heading",
      level: Number(tagName.slice(1)),
      text
    };
  }

  function extractWikiBlockquoteNode(element, rootBoundary) {
    const text = normalizeBlockText(collectWikiInlineMarkdown(element, rootBoundary));
    if (!text) {
      return null;
    }

    return {
      kind: "blockquote",
      text
    };
  }

  function isWikiSkippableElement(element, rootBoundary) {
    if (!isElementNode(element) || !isVisibleElement(element)) {
      return true;
    }

    if (isWikiExcludedSubtreeRoot(element) || isInteractiveControlElement(element)) {
      return true;
    }

    if (matchesWikiUiTerm(element.className) || matchesWikiUiTerm(element.id)) {
      return true;
    }

    if (isWikiMetadataElement(element)) {
      return true;
    }

    return Boolean(rootBoundary && rootBoundary !== element && isWikiUiImageElement(element, rootBoundary));
  }

  function tryExtractWikiSemanticNode(element, rootBoundary) {
    if (isWikiSkippableElement(element, rootBoundary)) {
      return null;
    }

    const headingNode = extractWikiHeadingNode(element);
    if (headingNode) {
      return headingNode;
    }

    const tagName = getTagName(element);

    if (tagName === "P") {
      return createWikiParagraphNode(collectWikiInlineMarkdown(element, rootBoundary));
    }

    if (tagName === "UL" || tagName === "OL") {
      return extractWikiListNode(element, rootBoundary);
    }

    if (tagName === "BLOCKQUOTE") {
      return extractWikiBlockquoteNode(element, rootBoundary);
    }

    if (tagName === "PRE") {
      return extractCodeBlockNode(element);
    }

    if (tagName === "HR") {
      return {
        kind: "hr"
      };
    }

    if (tagName === "TABLE") {
      return extractTableNode(element);
    }

    if (tagName === "IMG") {
      return createWikiParagraphNode(collectWikiInlineMarkdown(element, rootBoundary));
    }

    if (isTextOnlyBlockElement(element)) {
      return createWikiParagraphNode(collectWikiInlineMarkdown(element, rootBoundary));
    }

    return null;
  }

  function extractWikiChildNodes(container, rootBoundary, nodes) {
    const textBuffer = [];

    function flushTextBuffer() {
      if (!textBuffer.length) {
        return;
      }

      const textNode = createWikiParagraphNode(textBuffer.join(""));
      textBuffer.length = 0;
      if (textNode) {
        nodes.push(textNode);
      }
    }

    for (const child of Array.from(container.childNodes || [])) {
      if (isTextNode(child)) {
        textBuffer.push(child.textContent || "");
        continue;
      }

      if (!isElementNode(child) || isWikiSkippableElement(child, rootBoundary)) {
        continue;
      }

      const semanticNode = tryExtractWikiSemanticNode(child, rootBoundary);
      if (semanticNode) {
        flushTextBuffer();
        nodes.push(semanticNode);
        continue;
      }

      flushTextBuffer();
      extractWikiChildNodes(child, rootBoundary, nodes);
    }

    flushTextBuffer();
  }

  function extractWikiSourceAst(root) {
    if (!root) {
      return [];
    }

    const nodes = [];
    extractWikiChildNodes(root, root, nodes);
    return nodes.filter(node => {
      if (!node || !node.kind) {
        return false;
      }

      if (node.kind === "paragraph") {
        return !isWikiMetadataText(node.text);
      }

      return true;
    });
  }

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

  function getYonoteNetworkCaptureRegistry() {
    const registry = globalThis[YONOTE_CAPTURE_REGISTRY_KEY];
    if (Array.isArray(registry)) {
      return registry;
    }

    const nextRegistry = [];
    globalThis[YONOTE_CAPTURE_REGISTRY_KEY] = nextRegistry;
    return nextRegistry;
  }

  function resetYonoteNetworkCaptureRegistry() {
    const registry = getYonoteNetworkCaptureRegistry();
    registry.length = 0;
    return registry;
  }

  function normalizeStructuredType(value) {
    return String(value || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/[\s-]+/g, "_")
      .toLowerCase();
  }

  function getStructuredTypeValue(node) {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      return "";
    }

    for (const key of STRUCTURED_NODE_TYPE_KEYS) {
      if (typeof node[key] === "string" && node[key]) {
        return normalizeStructuredType(node[key]);
      }
    }

    return "";
  }

  function getStructuredChildArray(node) {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      return null;
    }

    for (const key of STRUCTURED_CHILD_KEYS) {
      if (Array.isArray(node[key])) {
        return node[key];
      }
    }

    return null;
  }

  function getStructuredTextValue(node) {
    if (typeof node === "string") {
      return node;
    }

    if (!node || typeof node !== "object" || Array.isArray(node)) {
      return "";
    }

    for (const key of STRUCTURED_TEXT_KEYS) {
      if (typeof node[key] === "string" && node[key]) {
        return node[key];
      }
    }

    return "";
  }

  function isTypedBlockArrayCandidate(value) {
    if (!Array.isArray(value) || value.length < 3) {
      return false;
    }

    const objectCount = value.filter(item => item && typeof item === "object" && !Array.isArray(item)).length;
    if (!objectCount) {
      return false;
    }

    const typedCount = value.filter(item => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return false;
      }

      return STRUCTURED_NODE_TYPE_KEYS.some(key => typeof item[key] === "string" && item[key]);
    }).length;

    return objectCount > 0 && typedCount / objectCount >= 0.6;
  }

  function countStructuredPayloadSignal(value, limit = 250) {
    let count = 0;
    const seen = new Set();

    function visit(node) {
      if (count >= limit || !node || typeof node !== "object" || seen.has(node)) {
        return;
      }

      seen.add(node);

      if (Array.isArray(node)) {
        count += Math.min(node.length, 4);
        node.forEach(visit);
        return;
      }

      if (getStructuredTypeValue(node)) {
        count += 2;
      }

      const childArray = getStructuredChildArray(node);
      if (childArray) {
        count += Math.min(childArray.length, 4);
      }

      Object.values(node).forEach(visit);
    }

    visit(value);
    return count;
  }

  function findProseMirrorDocRoot(payload) {
    let best = null;
    const seen = new Set();

    function visit(node, depth) {
      if (!node || typeof node !== "object" || seen.has(node)) {
        return;
      }

      seen.add(node);

      if (Array.isArray(node)) {
        node.forEach(item => visit(item, depth + 1));
        return;
      }

      if (node.type === "doc" && Array.isArray(node.content)) {
        const signal = countStructuredPayloadSignal(node);
        const weight = depth * 1000 + signal;
        if (!best || weight > best.weight) {
          best = { node, weight };
        }
      }

      Object.values(node).forEach(value => visit(value, depth + 1));
    }

    visit(payload, 0);
    return best ? best.node : null;
  }

  function findTypedBlockRoot(payload) {
    let best = null;
    const seen = new Set();

    function consider(root, schemaKind, depth) {
      if (!root) {
        return;
      }

      const size = Array.isArray(root) ? root.length : (getStructuredChildArray(root) || []).length;
      const signal = countStructuredPayloadSignal(root);
      const weight = depth * 1000 + size * 10 + signal;

      if (!best || weight > best.weight) {
        best = {
          root: Array.isArray(root) ? root : getStructuredChildArray(root) || [],
          schemaKind,
          weight
        };
      }
    }

    function visit(node, depth) {
      if (!node || typeof node !== "object" || seen.has(node)) {
        return;
      }

      seen.add(node);

      if (Array.isArray(node)) {
        if (isTypedBlockArrayCandidate(node)) {
          consider(node, "typed-block-array", depth);
        }
        node.forEach(item => visit(item, depth + 1));
        return;
      }

      for (const key of STRUCTURED_CHILD_KEYS) {
        if (isTypedBlockArrayCandidate(node[key])) {
          consider(node, "typed-block-map", depth + 1);
        }
      }

      Object.values(node).forEach(value => visit(value, depth + 1));
    }

    visit(payload, 0);
    return best ? { root: best.root, schemaKind: best.schemaKind } : null;
  }

  function classifyYonotePayloadShape(payload) {
    if (findProseMirrorDocRoot(payload)) {
      return "prosemirror-doc";
    }

    const typedRoot = findTypedBlockRoot(payload);
    if (typedRoot) {
      return typedRoot.schemaKind;
    }

    return "unknown";
  }

  function collectYonotePayloadNodeTypeHints(payload) {
    const hints = new Set();
    const seen = new Set();

    function visit(node) {
      if (hints.size >= 8 || !node || typeof node !== "object" || seen.has(node)) {
        return;
      }

      seen.add(node);

      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }

      STRUCTURED_NODE_TYPE_KEYS.forEach(key => {
        if (typeof node[key] === "string" && node[key]) {
          hints.add(normalizeStructuredType(node[key]));
        }
      });

      Object.values(node).forEach(visit);
    }

    visit(payload);
    return Array.from(hints).slice(0, 8);
  }

  function safeSerializeForMatch(value) {
    if (typeof value === "string") {
      return value;
    }

    if (value === undefined || value === null) {
      return "";
    }

    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }

  function valueReferencesToken(value, token) {
    if (!token) {
      return false;
    }

    return safeSerializeForMatch(value).toLowerCase().includes(String(token).toLowerCase());
  }

  function hasNestedArrayAboveLength(value, minLength = 3) {
    let found = false;
    const seen = new Set();

    function visit(node) {
      if (found || !node || typeof node !== "object" || seen.has(node)) {
        return;
      }

      seen.add(node);

      if (Array.isArray(node)) {
        if (node.length >= minLength) {
          found = true;
          return;
        }

        node.forEach(visit);
        return;
      }

      Object.values(node).forEach(visit);
    }

    visit(value);
    return found;
  }

  function matchesYonoteCaptureNoise(value) {
    const lower = String(value || "").toLowerCase();
    return YONOTE_CAPTURE_NOISE_TERMS.some(term => lower.includes(term));
  }

  function extractYonoteApiPath(rawUrl) {
    try {
      const url = new URL(rawUrl, globalThis.location && globalThis.location.href ? globalThis.location.href : "https://yonote.ru/");
      return `${url.pathname}${url.search}`;
    } catch {
      return "";
    }
  }

  function isYonoteSameOriginApiUrl(rawUrl) {
    try {
      const base = globalThis.location && globalThis.location.href ? globalThis.location.href : "https://yonote.ru/";
      const url = new URL(rawUrl, base);
      const origin = globalThis.location && globalThis.location.origin ? globalThis.location.origin : url.origin;
      return url.origin === origin && /^\/api\//i.test(url.pathname);
    } catch {
      return false;
    }
  }

  function shouldCaptureYonoteApiResponse({ url, contentType, status, responseLength }) {
    if (!isYonoteSameOriginApiUrl(url)) {
      return false;
    }

    if (!status || status < 200 || status >= 300) {
      return false;
    }

    if (!/application\/json/i.test(String(contentType || ""))) {
      return false;
    }

    if (Number(responseLength || 0) > YONOTE_CAPTURE_MAX_TEXT_BYTES) {
      return false;
    }

    return !matchesYonoteCaptureNoise(extractYonoteApiPath(url));
  }

  function buildYonoteDocumentMatch(snapshot, currentDocContext = {}) {
    const sourceSlug = currentDocContext.sourceSlug || "";
    const documentId = currentDocContext.documentId || "";
    const path = snapshot.renderApiPath || extractYonoteApiPath(snapshot.url || "");

    return {
      requestMentionsSourceSlug:
        Boolean(sourceSlug) &&
        (Boolean(snapshot.documentMatch && snapshot.documentMatch.requestMentionsSourceSlug) ||
          valueReferencesToken(snapshot.requestBody, sourceSlug) ||
          valueReferencesToken(path, sourceSlug)),
      responseMentionsSourceSlug:
        Boolean(sourceSlug) &&
        (Boolean(snapshot.documentMatch && snapshot.documentMatch.responseMentionsSourceSlug) ||
          valueReferencesToken(snapshot.responseBody, sourceSlug)),
      requestMentionsDocumentId:
        Boolean(documentId) &&
        (Boolean(snapshot.documentMatch && snapshot.documentMatch.requestMentionsDocumentId) ||
          valueReferencesToken(snapshot.requestBody, documentId)),
      responseMentionsDocumentId:
        Boolean(documentId) &&
        (Boolean(snapshot.documentMatch && snapshot.documentMatch.responseMentionsDocumentId) ||
          valueReferencesToken(snapshot.responseBody, documentId))
    };
  }

  function scoreYonoteStructuredCandidate(snapshot, currentDocContext = {}) {
    if (!snapshot || typeof snapshot !== "object") {
      return null;
    }

    const schemaKind = snapshot.schemaKind || classifyYonotePayloadShape(snapshot.responseBody);
    const nodeTypeHints = Array.isArray(snapshot.nodeTypeHints)
      ? snapshot.nodeTypeHints
      : collectYonotePayloadNodeTypeHints(snapshot.responseBody);
    const documentMatch = buildYonoteDocumentMatch(snapshot, currentDocContext);
    const path = snapshot.renderApiPath || extractYonoteApiPath(snapshot.url || "");
    const payloadHasNestedArrays = hasNestedArrayAboveLength(snapshot.responseBody, 3);

    let score = 0;

    if (documentMatch.requestMentionsSourceSlug || documentMatch.responseMentionsSourceSlug) {
      score += 8;
    }

    if (schemaKind === "prosemirror-doc") {
      score += 8;
    } else if (schemaKind === "typed-block-array") {
      score += 6;
    } else if (schemaKind === "typed-block-map") {
      score += 5;
    }

    if (
      nodeTypeHints.some(hint => {
        return (
          hint.includes("table") ||
          hint.includes("heading") ||
          hint.includes("paragraph") ||
          hint.includes("bullet") ||
          hint.includes("ordered") ||
          hint.includes("list")
        );
      })
    ) {
      score += 4;
    }

    if (new Set(nodeTypeHints).size >= 3) {
      score += 2;
    }

    if (matchesYonoteCaptureNoise(path)) {
      score -= 6;
    }

    if (!payloadHasNestedArrays) {
      score -= 4;
    }

    return {
      ...snapshot,
      renderApiPath: path,
      renderApiMethod: snapshot.renderApiMethod || snapshot.method || "GET",
      schemaKind,
      nodeTypeHints,
      documentMatch,
      candidateScore: score
    };
  }

  function pickBestYonoteStructuredCandidate(captureRegistry, currentDocContext = {}) {
    const registry = Array.isArray(captureRegistry) ? captureRegistry : getYonoteNetworkCaptureRegistry();
    const scored = registry
      .map(snapshot => scoreYonoteStructuredCandidate(snapshot, currentDocContext))
      .filter(Boolean)
      .filter(snapshot => snapshot.candidateScore > 8)
      .sort((left, right) => {
        if (right.candidateScore !== left.candidateScore) {
          return right.candidateScore - left.candidateScore;
        }

        return new Date(right.capturedAt || 0).getTime() - new Date(left.capturedAt || 0).getTime();
      });

    return scored[0] || null;
  }

  function captureYonoteApiSnapshot({ url, method, requestBody, responseBody, sourceSlug }) {
    if (!isYonoteSameOriginApiUrl(url)) {
      return null;
    }

    const renderApiPath = extractYonoteApiPath(url);
    const schemaKind = classifyYonotePayloadShape(responseBody);
    const nodeTypeHints = collectYonotePayloadNodeTypeHints(responseBody);
    const topLevelNoise = responseBody && typeof responseBody === "object" && !Array.isArray(responseBody)
      ? Object.keys(responseBody).some(matchesYonoteCaptureNoise)
      : false;

    if (matchesYonoteCaptureNoise(renderApiPath)) {
      return null;
    }

    if (topLevelNoise && schemaKind === "unknown") {
      return null;
    }

    const snapshot = {
      url,
      renderApiPath,
      renderApiMethod: String(method || "GET").toUpperCase(),
      requestBody: requestBody === undefined ? null : requestBody,
      responseBody,
      capturedAt: new Date().toISOString(),
      documentMatch: {
        requestMentionsSourceSlug:
          Boolean(sourceSlug) &&
          (valueReferencesToken(requestBody, sourceSlug) || valueReferencesToken(renderApiPath, sourceSlug)),
        responseMentionsSourceSlug: Boolean(sourceSlug) && valueReferencesToken(responseBody, sourceSlug),
        requestMentionsDocumentId: false,
        responseMentionsDocumentId: false
      },
      schemaKind,
      candidateScore: 0,
      nodeTypeHints
    };

    const hydrated = scoreYonoteStructuredCandidate(snapshot, {
      sourceSlug: sourceSlug || "",
      documentId: ""
    });

    const registry = getYonoteNetworkCaptureRegistry();
    registry.push(hydrated);

    while (registry.length > YONOTE_CAPTURE_LIMIT) {
      registry.shift();
    }

    return hydrated;
  }

  function clampHeadingLevel(value, fallback = 2) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }

    return Math.min(6, Math.max(1, Math.round(numeric)));
  }

  function extractInlineTextFromStructuredNode(node) {
    if (typeof node === "string") {
      return node;
    }

    if (Array.isArray(node)) {
      return node.map(item => extractInlineTextFromStructuredNode(item)).join("");
    }

    if (!node || typeof node !== "object") {
      return "";
    }

    const nodeType = getStructuredTypeValue(node);

    if (nodeType === "hard_break" || nodeType === "hardbreak") {
      return "\n";
    }

    if (nodeType === "text" && typeof node.text === "string") {
      return node.text;
    }

    const childArray = getStructuredChildArray(node);
    if (childArray && childArray.length) {
      const childText = childArray.map(item => extractInlineTextFromStructuredNode(item)).join("");
      if (childText) {
        return childText;
      }
    }

    return getStructuredTextValue(node);
  }

  function collapseSourceNodesToText(nodes) {
    return (Array.isArray(nodes) ? nodes : [])
      .map(node => {
        if (!node) {
          return "";
        }

        if (node.kind === "heading") return node.text;
        if (node.kind === "paragraph") return node.text;
        if (node.kind === "raw_marker") return node.text;
        if (node.kind === "blockquote") return node.text;
        if (node.kind === "code_block") return node.text;
        if (node.kind === "unordered_list" || node.kind === "ordered_list") {
          return (node.items || []).join("\n");
        }
        if (node.kind === "table") {
          return (node.rows || []).map(row => row.join(" | ")).join("\n");
        }
        if (node.kind === "hr") return "---";
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  function listNodeToIndentedLines(listNode, indent) {
    return (listNode.items || []).flatMap((item, index) => {
      const marker = listNode.kind === "ordered_list" ? `${index + 1}.` : "-";
      const lines = normalizeBlockText(item).split("\n");
      const [firstLine, ...restLines] = lines;
      const output = [];

      output.push(firstLine ? `${indent}${marker} ${firstLine}` : `${indent}${marker}`);
      restLines.forEach(line => {
        output.push(`${indent}${line}`);
      });

      return output;
    });
  }

  function extractBlockTextFromStructuredChildren(children) {
    return normalizeBlockText(extractInlineTextFromStructuredNode(children));
  }

  function extractSourceAstFromProseMirrorNodes(nodes) {
    const output = [];
    (Array.isArray(nodes) ? nodes : []).forEach(node => {
      output.push(...extractSourceAstFromProseMirrorNode(node));
    });
    return output;
  }

  function extractProseMirrorListNode(node, ordered) {
    const items = [];

    (Array.isArray(node && node.content) ? node.content : []).forEach(itemNode => {
      if (getStructuredTypeValue(itemNode) !== "list_item") {
        const fallbackText = normalizeBlockText(extractInlineTextFromStructuredNode(itemNode));
        if (fallbackText) {
          items.push(fallbackText);
        }
        return;
      }

      const itemParts = [];
      const nestedLines = [];

      (Array.isArray(itemNode.content) ? itemNode.content : []).forEach(child => {
        const childType = getStructuredTypeValue(child);
        if (childType === "bullet_list" || childType === "bulletlist") {
          const nestedList = extractProseMirrorListNode(child, false);
          if (nestedList) {
            nestedLines.push(...listNodeToIndentedLines(nestedList, "  "));
          }
          return;
        }

        if (childType === "ordered_list" || childType === "orderedlist") {
          const nestedList = extractProseMirrorListNode(child, true);
          if (nestedList) {
            nestedLines.push(...listNodeToIndentedLines(nestedList, "  "));
          }
          return;
        }

        const childAst = extractSourceAstFromProseMirrorNode(child);
        const childText = collapseSourceNodesToText(childAst) || normalizeBlockText(extractInlineTextFromStructuredNode(child));
        if (childText) {
          itemParts.push(childText);
        }
      });

      const itemText = [itemParts.join("\n"), ...nestedLines].filter(Boolean).join("\n");
      if (itemText) {
        items.push(itemText);
      }
    });

    if (!items.length) {
      return null;
    }

    return {
      kind: ordered ? "ordered_list" : "unordered_list",
      items
    };
  }

  function extractProseMirrorTableNode(node) {
    const rows = [];

    (Array.isArray(node && node.content) ? node.content : []).forEach(rowNode => {
      const rowType = getStructuredTypeValue(rowNode);
      if (rowType !== "table_row" && rowType !== "tablerow") {
        return;
      }

      const row = [];
      (Array.isArray(rowNode.content) ? rowNode.content : []).forEach(cellNode => {
        const cellType = getStructuredTypeValue(cellNode);
        if (
          cellType !== "table_cell" &&
          cellType !== "tablecell" &&
          cellType !== "table_header" &&
          cellType !== "tableheader"
        ) {
          return;
        }

        row.push(extractBlockTextFromStructuredChildren(cellNode.content || []));
      });

      if (row.length) {
        rows.push(row);
      }
    });

    const width = rows.reduce((maxWidth, row) => Math.max(maxWidth, row.length), 0);
    if (width < 2) {
      return null;
    }

    return {
      kind: "table",
      rows: rows.map(row => [...row, ...new Array(width - row.length).fill("")]),
      headerRows: 1
    };
  }

  function extractSourceAstFromProseMirrorNode(node) {
    if (!node || typeof node !== "object") {
      return [];
    }

    const nodeType = getStructuredTypeValue(node);

    if (!nodeType || nodeType === "doc") {
      return extractSourceAstFromProseMirrorNodes(node.content || []);
    }

    if (nodeType === "heading") {
      const text = normalizeInlineText(extractInlineTextFromStructuredNode(node.content || []));
      return text
        ? [
            {
              kind: "heading",
              level: clampHeadingLevel(node.attrs && node.attrs.level, 2),
              text
            }
          ]
        : [];
    }

    if (nodeType === "paragraph") {
      const textNode = createTextualNodeFromText(extractBlockTextFromStructuredChildren(node.content || []));
      return textNode ? [textNode] : [];
    }

    if (nodeType === "bullet_list" || nodeType === "bulletlist") {
      const listNode = extractProseMirrorListNode(node, false);
      return listNode ? [listNode] : [];
    }

    if (nodeType === "ordered_list" || nodeType === "orderedlist") {
      const listNode = extractProseMirrorListNode(node, true);
      return listNode ? [listNode] : [];
    }

    if (nodeType === "blockquote") {
      const text = extractSourceAstFromProseMirrorNodes(node.content || []);
      const blockText = collapseSourceNodesToText(text);
      return blockText
        ? [
            {
              kind: "blockquote",
              text: blockText
            }
          ]
        : [];
    }

    if (nodeType === "code_block" || nodeType === "codeblock") {
      const text = trimBlockText(extractInlineTextFromStructuredNode(node.content || []));
      return text
        ? [
            {
              kind: "code_block",
              text,
              language: typeof (node.attrs && node.attrs.language) === "string" ? node.attrs.language : ""
            }
          ]
        : [];
    }

    if (nodeType === "horizontal_rule" || nodeType === "horizontalrule") {
      return [{ kind: "hr" }];
    }

    if (nodeType === "table") {
      const tableNode = extractProseMirrorTableNode(node);
      return tableNode ? [tableNode] : [];
    }

    const childNodes = extractSourceAstFromProseMirrorNodes(node.content || []);
    if (childNodes.length) {
      return childNodes;
    }

    const textNode = createTextualNodeFromText(extractInlineTextFromStructuredNode(node));
    return textNode ? [textNode] : [];
  }

  function extractTypedListItemText(node) {
    const itemParts = [];
    const nestedLines = [];
    const children = getStructuredChildArray(node) || [];

    const explicitText = normalizeBlockText(getStructuredTextValue(node));
    if (explicitText) {
      itemParts.push(explicitText);
    }

    children.forEach(child => {
      const childType = getStructuredTypeValue(child);

      if (UNORDERED_LIST_TYPE_ALIASES.has(childType)) {
        const nestedList = extractTypedListNode(child, false);
        if (nestedList) {
          nestedLines.push(...listNodeToIndentedLines(nestedList, "  "));
        }
        return;
      }

      if (ORDERED_LIST_TYPE_ALIASES.has(childType)) {
        const nestedList = extractTypedListNode(child, true);
        if (nestedList) {
          nestedLines.push(...listNodeToIndentedLines(nestedList, "  "));
        }
        return;
      }

      const childAst = extractSourceAstFromTypedBlock(child);
      const childText = collapseSourceNodesToText(childAst);
      if (childText) {
        itemParts.push(childText);
        return;
      }

      const inlineText = normalizeBlockText(extractInlineTextFromStructuredNode(child));
      if (inlineText) {
        itemParts.push(inlineText);
      }
    });

    return [itemParts.join("\n"), ...nestedLines].filter(Boolean).join("\n");
  }

  function extractTypedListNode(node, ordered) {
    const children = getStructuredChildArray(node) || [];
    const items = [];

    children.forEach(child => {
      const childType = getStructuredTypeValue(child);
      if (LIST_ITEM_TYPE_ALIASES.has(childType)) {
        const itemText = extractTypedListItemText(child);
        if (itemText) {
          items.push(itemText);
        }
        return;
      }

      const inlineText = normalizeBlockText(extractInlineTextFromStructuredNode(child));
      if (inlineText) {
        items.push(inlineText);
      }
    });

    if (!items.length) {
      const textNode = createTextualNodeFromText(extractInlineTextFromStructuredNode(node));
      if (textNode && (textNode.kind === "unordered_list" || textNode.kind === "ordered_list")) {
        return textNode;
      }
      return null;
    }

    return {
      kind: ordered ? "ordered_list" : "unordered_list",
      items
    };
  }

  function extractTypedTableNode(node) {
    const tableRows = [];
    const rowSource = getStructuredChildArray(node) || [];

    rowSource.forEach(rowNode => {
      const rowType = getStructuredTypeValue(rowNode);
      if (!TABLE_ROW_TYPE_ALIASES.has(rowType) && rowType !== "tablerow") {
        return;
      }

      const row = [];
      (getStructuredChildArray(rowNode) || []).forEach(cellNode => {
        const cellType = getStructuredTypeValue(cellNode);
        if (!TABLE_CELL_TYPE_ALIASES.has(cellType) && cellType !== "tablecell" && cellType !== "tableheader") {
          return;
        }

        row.push(normalizeBlockText(extractInlineTextFromStructuredNode(cellNode)));
      });

      if (row.length) {
        tableRows.push(row);
      }
    });

    const width = tableRows.reduce((maxWidth, row) => Math.max(maxWidth, row.length), 0);
    if (width < 2) {
      return null;
    }

    return {
      kind: "table",
      rows: tableRows.map(row => [...row, ...new Array(width - row.length).fill("")]),
      headerRows: 1
    };
  }

  function extractSourceAstFromTypedNodes(nodes) {
    const output = [];
    (Array.isArray(nodes) ? nodes : []).forEach(node => {
      output.push(...extractSourceAstFromTypedBlock(node));
    });
    return output;
  }

  function extractSourceAstFromTypedBlock(node) {
    if (!node) {
      return [];
    }

    if (Array.isArray(node)) {
      return extractSourceAstFromTypedNodes(node);
    }

    if (typeof node !== "object") {
      return [];
    }

    const nodeType = getStructuredTypeValue(node);
    const children = getStructuredChildArray(node) || [];
    const explicitText = normalizeBlockText(getStructuredTextValue(node));

    if (!nodeType) {
      if (children.length) {
        return extractSourceAstFromTypedNodes(children);
      }
      const textNode = createTextualNodeFromText(explicitText);
      return textNode ? [textNode] : [];
    }

    if (HEADING_TYPE_ALIASES.has(nodeType)) {
      const text = normalizeInlineText(explicitText || extractInlineTextFromStructuredNode(children));
      return text
        ? [
            {
              kind: "heading",
              level: clampHeadingLevel(node.level || (node.attrs && node.attrs.level), 2),
              text
            }
          ]
        : [];
    }

    if (PARAGRAPH_TYPE_ALIASES.has(nodeType)) {
      const textNode = createTextualNodeFromText(explicitText || extractInlineTextFromStructuredNode(children));
      return textNode ? [textNode] : [];
    }

    if (UNORDERED_LIST_TYPE_ALIASES.has(nodeType)) {
      const listNode = extractTypedListNode(node, false);
      return listNode ? [listNode] : [];
    }

    if (ORDERED_LIST_TYPE_ALIASES.has(nodeType)) {
      const listNode = extractTypedListNode(node, true);
      return listNode ? [listNode] : [];
    }

    if (LIST_ITEM_TYPE_ALIASES.has(nodeType)) {
      const textNode = createTextualNodeFromText(extractTypedListItemText(node));
      return textNode ? [textNode] : [];
    }

    if (TABLE_TYPE_ALIASES.has(nodeType)) {
      const tableNode = extractTypedTableNode(node);
      return tableNode ? [tableNode] : [];
    }

    if (BLOCKQUOTE_TYPE_ALIASES.has(nodeType)) {
      const text = explicitText || collapseSourceNodesToText(extractSourceAstFromTypedNodes(children));
      return text
        ? [
            {
              kind: "blockquote",
              text
            }
          ]
        : [];
    }

    if (CODE_BLOCK_TYPE_ALIASES.has(nodeType)) {
      const text = trimBlockText(explicitText || extractInlineTextFromStructuredNode(children));
      return text
        ? [
            {
              kind: "code_block",
              text,
              language: String(node.language || node.lang || "")
            }
          ]
        : [];
    }

    if (DIVIDER_TYPE_ALIASES.has(nodeType)) {
      return [{ kind: "hr" }];
    }

    if (TABLE_ROW_TYPE_ALIASES.has(nodeType) || TABLE_CELL_TYPE_ALIASES.has(nodeType)) {
      const textNode = createTextualNodeFromText(explicitText || extractInlineTextFromStructuredNode(children));
      return textNode ? [textNode] : [];
    }

    if (children.length) {
      const nestedNodes = extractSourceAstFromTypedNodes(children);
      if (nestedNodes.length) {
        return nestedNodes;
      }
    }

    const textNode = createTextualNodeFromText(explicitText || extractInlineTextFromStructuredNode(node));
    return textNode ? [textNode] : [];
  }

  function extractYonoteSourceAstFromStructuredPayload(snapshot) {
    if (!snapshot || typeof snapshot !== "object") {
      return [];
    }

    const schemaKind = snapshot.schemaKind || classifyYonotePayloadShape(snapshot.responseBody);
    const payload = snapshot.responseBody;

    if (schemaKind === "prosemirror-doc") {
      const docRoot = findProseMirrorDocRoot(payload);
      return docRoot ? extractSourceAstFromProseMirrorNode(docRoot) : [];
    }

    if (schemaKind === "typed-block-array" || schemaKind === "typed-block-map") {
      const typedRoot = findTypedBlockRoot(payload);
      if (!typedRoot) {
        return [];
      }

      return extractSourceAstFromTypedNodes(typedRoot.root);
    }

    return [];
  }

  function buildYonoteSourceResult({ captureRegistry, domAst, documentData, sourceUrl, sourceSlug }) {
    const currentDocContext = {
      sourceSlug: sourceSlug || "",
      documentId: String(documentData && documentData.id ? documentData.id : "")
    };

    const bestSnapshot = pickBestYonoteStructuredCandidate(captureRegistry, currentDocContext);
    let diagnostics;

    if (!bestSnapshot) {
      diagnostics = createYonoteSourceDiagnostics({
        captureStatus: "missing",
        fallbackReason: "no-captured-render-payload"
      });
    } else {
      diagnostics = createYonoteSourceDiagnostics({
        renderApiPath: bestSnapshot.renderApiPath || extractYonoteApiPath(bestSnapshot.url || ""),
        renderApiMethod: bestSnapshot.renderApiMethod || "GET",
        schemaKind: bestSnapshot.schemaKind || "unknown",
        captureStatus: bestSnapshot.schemaKind === "unknown" ? "unsupported" : "captured",
        candidateScore: bestSnapshot.candidateScore || 0,
        nodeTypeHints: bestSnapshot.nodeTypeHints || []
      });
    }

    if (bestSnapshot) {
      const structuredAst = extractYonoteSourceAstFromStructuredPayload(bestSnapshot, documentData);
      if (isMeaningfulStructuredAst(structuredAst)) {
        const payload = buildYonoteStructuredPayload(structuredAst, documentData, sourceUrl, sourceSlug, {
          sourceMode: "Yonote render API",
          diagnostics
        });

        return {
          payload,
          diagnostics: payload.diagnostics
        };
      }

      diagnostics = createYonoteSourceDiagnostics({
        ...diagnostics,
        captureStatus: "unsupported",
        fallbackReason: bestSnapshot.schemaKind === "unknown" ? "unsupported-render-schema" : "render-extraction-too-thin"
      });
    }

    if (isMeaningfulStructuredAst(domAst)) {
      const payload = buildYonoteStructuredPayload(domAst, documentData, sourceUrl, sourceSlug, {
        sourceMode: "Rendered DOM fallback",
        diagnostics
      });

      return {
        payload,
        diagnostics: payload.diagnostics
      };
    }

    if (!diagnostics.fallbackReason) {
      diagnostics = createYonoteSourceDiagnostics({
        ...diagnostics,
        fallbackReason: "dom-extraction-too-thin",
        captureStatus: diagnostics.captureStatus === "captured" ? "captured" : diagnostics.captureStatus
      });
    }

    const payload = buildYonoteFallbackPayload(documentData, sourceUrl, sourceSlug, {
      diagnostics
    });

    return {
      payload,
      diagnostics: payload.diagnostics
    };
  }

  function isFencedCodeStart(line) {
    return /^```[a-z0-9_-]*\s*$/i.test(String(line || "").trim());
  }

  function isHeading(line) {
    return /^(#{1,6})\s+/.test(String(line || "").trim());
  }

  function isHorizontalRule(line) {
    const trimmed = String(line || "").trim();
    return /^---+$/.test(trimmed) || /^\*{3,}$/.test(trimmed);
  }

  function isUnorderedListLine(line) {
    return /^(\s*)- /.test(String(line || ""));
  }

  function isOrderedListLine(line) {
    return /^(\s*)\d+\.\s+/.test(String(line || ""));
  }

  function isListStart(line) {
    return isUnorderedListLine(line) || isOrderedListLine(line);
  }

  function isListContinuation(line) {
    if (isBlank(line)) return false;
    const value = String(line || "");
    return isListStart(value) || /^\s+/.test(value);
  }

  function isBlockquote(line) {
    return /^>\s?/.test(String(line || "").trim());
  }

  function looksLikeTableSeparator(line) {
    const trimmed = String(line || "").trim();
    if (!trimmed.includes("|")) return false;

    const cells = trimmed
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map(cell => cell.trim())
      .filter(Boolean);

    return cells.length >= 2 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
  }

  function isTableStart(lines, index) {
    const current = String(lines[index] || "").trim();
    const next = String(lines[index + 1] || "").trim();
    return current.includes("|") && looksLikeTableSeparator(next);
  }

  function createCompiledBlock(kind, text) {
    const markdown = trimBlockText(text);
    if (!markdown) {
      return null;
    }

    return {
      kind,
      markdown,
      meta: kind === "table" ? { blockType: "Table" } : {}
    };
  }

  function isAbsoluteHttpUrl(value) {
    return /^https?:\/\//i.test(String(value || "").trim());
  }

  function unwrapMarkdownLinkTarget(target) {
    const trimmed = String(target || "").trim();
    if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
      return trimmed.slice(1, -1).trim();
    }

    return trimmed;
  }

  function parseMarkdownImageLinkTarget(target) {
    const trimmed = String(target || "").trim();
    if (!trimmed) {
      return {
        url: "",
        title: ""
      };
    }

    const match = trimmed.match(/^(.*?)(?:\s+("([^"]*)"|'([^']*)'))?$/);
    return {
      url: unwrapMarkdownLinkTarget(match && match[1] ? match[1] : trimmed),
      title: trimBlockText((match && (match[3] || match[4])) || "")
    };
  }

  function isImageTitleMetadataSegment(value) {
    return /^[a-z][a-z0-9_-]*=\S+$/i.test(String(value || "").trim());
  }

  function extractCaptionFromImageTitle(title) {
    const normalized = trimBlockText(title);
    if (!normalized) {
      return "";
    }

    const parts = normalized.split("|||").map(part => trimBlockText(part));
    if (parts.length === 1) {
      return isImageTitleMetadataSegment(normalized) ? "" : normalized;
    }

    const captionPart = parts.find(part => part && !isImageTitleMetadataSegment(part));
    return captionPart || "";
  }

  function extractItalicOnlyCaption(markdown) {
    const trimmed = trimBlockText(markdown);
    const match = trimmed.match(/^\*([^*\n]+)\*$/);
    return match ? trimBlockText(match[1]) : "";
  }

  function buildMarkdownImageLinkTarget(url, title) {
    const normalizedUrl = String(url || "").trim();
    const normalizedTitle = String(title || "").trim();
    if (!normalizedTitle) {
      return normalizedUrl;
    }

    const escapedTitle = normalizedTitle.replace(/"/g, '\\"');
    return `${normalizedUrl} "${escapedTitle}"`;
  }

  function buildImageBlockMarkdown(alt, url, caption, options = {}) {
    const normalizedAlt = String(alt || "").trim();
    const normalizedUrl = String(url || "").trim();
    const normalizedCaption = String(caption || "").trim();
    const normalizedLinkTitle = String(options.linkTitle || "").trim();
    const base = `![${normalizedAlt}](${buildMarkdownImageLinkTarget(normalizedUrl, normalizedLinkTitle)})`;
    if (!normalizedCaption) {
      return base;
    }

    // Keep the visible caption in markdown even when it originated in the link title.
    return `${base}*${normalizedCaption}*`;
  }

  function parseStandaloneImageParagraph(markdown) {
    const normalized = normalizeNewlines(trimBlockText(markdown));
    if (!normalized) {
      return null;
    }

    const lines = normalized
      .split("\n")
      .map(line => String(line || "").trim())
      .filter(Boolean);

    if (!lines.length || lines.length > 2) {
      return null;
    }

    const firstLineMatch = lines[0].match(/^!\[([^\]]*)\]\((.+?)\)(?:\s*(\*([^*\n]+)\*))?$/);
    if (!firstLineMatch) {
      return null;
    }

    const alt = trimBlockText(firstLineMatch[1] || "");
    const parsedTarget = parseMarkdownImageLinkTarget(firstLineMatch[2] || "");
    const url = parsedTarget.url;
    if (!isAbsoluteHttpUrl(url)) {
      return null;
    }

    const inlineCaption = trimBlockText(firstLineMatch[4] || "");
    const titleCaption = extractCaptionFromImageTitle(parsedTarget.title);
    let captionSource = "";
    let caption = "";

    if (inlineCaption) {
      caption = inlineCaption;
      captionSource = "inline";
    } else if (titleCaption) {
      caption = titleCaption;
      captionSource = "title";
    }

    if (!caption && lines.length === 2) {
      caption = extractItalicOnlyCaption(lines[1]);
      if (!caption) {
        return null;
      }
      captionSource = "second-line";
    }

    return {
      alt,
      url,
      caption,
      linkTitle: parsedTarget.title,
      captionSource
    };
  }

  function enrichCompiledBlocksWithImages(blocks) {
    const normalizedBlocks = Array.isArray(blocks) ? blocks : [];
    const enriched = [];

    for (let index = 0; index < normalizedBlocks.length; index += 1) {
      const block = normalizedBlocks[index];
      if (!block || block.kind !== "paragraph") {
        if (block) {
          enriched.push(block);
        }
        continue;
      }

      const inlineImage = parseStandaloneImageParagraph(block.markdown);
      if (!inlineImage) {
        enriched.push(block);
        continue;
      }

      let caption = inlineImage.caption;
      let captionSource = inlineImage.captionSource;
      if (!caption && index + 1 < normalizedBlocks.length) {
        const nextBlock = normalizedBlocks[index + 1];
        if (nextBlock && nextBlock.kind === "paragraph") {
          const nextCaption = extractItalicOnlyCaption(nextBlock.markdown);
          if (nextCaption) {
            caption = nextCaption;
            captionSource = "next-paragraph";
            index += 1;
          }
        }
      }

      enriched.push({
        kind: "image",
        markdown: buildImageBlockMarkdown(inlineImage.alt, inlineImage.url, caption, {
          linkTitle: inlineImage.linkTitle,
          captionSource
        }),
        alt: inlineImage.alt,
        url: inlineImage.url,
        caption,
        linkTitle: inlineImage.linkTitle,
        captionSource,
        meta: {
          blockType: "Image"
        }
      });
    }

    return enriched;
  }

  function compileTheoryBlocks(markdown) {
    const lines = normalizeNewlines(markdown)
      .replace(/\u00a0/g, " ")
      .split("\n");

    const blocks = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];

      if (isBlank(line)) {
        index += 1;
        continue;
      }

      if (isFencedCodeStart(line)) {
        const buffer = [line];
        index += 1;
        while (index < lines.length) {
          buffer.push(lines[index]);
          if (/^```\s*$/.test(String(lines[index] || "").trim())) {
            index += 1;
            break;
          }
          index += 1;
        }
        const block = createCompiledBlock("code", buffer.join("\n"));
        if (block) blocks.push(block);
        continue;
      }

      if (isTableStart(lines, index)) {
        const buffer = [lines[index], lines[index + 1]];
        index += 2;
        while (index < lines.length) {
          const nextLine = lines[index];
          if (isBlank(nextLine) || !String(nextLine || "").includes("|")) {
            break;
          }
          buffer.push(nextLine);
          index += 1;
        }
        const block = createCompiledBlock("table", buffer.join("\n"));
        if (block) blocks.push(block);
        continue;
      }

      if (isListStart(line)) {
        const buffer = [line];
        index += 1;
        while (index < lines.length && isListContinuation(lines[index])) {
          buffer.push(lines[index]);
          index += 1;
        }
        const block = createCompiledBlock("list", buffer.join("\n"));
        if (block) blocks.push(block);
        continue;
      }

      if (isBlockquote(line)) {
        const buffer = [line];
        index += 1;
        while (index < lines.length && isBlockquote(lines[index])) {
          buffer.push(lines[index]);
          index += 1;
        }
        const block = createCompiledBlock("blockquote", buffer.join("\n"));
        if (block) blocks.push(block);
        continue;
      }

      if (isHorizontalRule(line)) {
        const block = createCompiledBlock("hr", line);
        if (block) blocks.push(block);
        index += 1;
        continue;
      }

      if (isHeading(line)) {
        const block = createCompiledBlock("heading", line);
        if (block) blocks.push(block);
        index += 1;
        continue;
      }

      const paragraphLines = [line];
      index += 1;
      while (index < lines.length) {
        const nextLine = lines[index];
        if (isBlank(nextLine)) break;
        if (isFencedCodeStart(nextLine)) break;
        if (isTableStart(lines, index)) break;
        if (isListStart(nextLine)) break;
        if (isBlockquote(nextLine)) break;
        if (isHorizontalRule(nextLine)) break;
        if (isHeading(nextLine)) break;
        paragraphLines.push(nextLine);
        index += 1;
      }

      const block = createCompiledBlock("paragraph", paragraphLines.join("\n"));
      if (block) blocks.push(block);
    }

    return enrichCompiledBlocksWithImages(blocks);
  }

  function getYonoteSlugFromPath(pathname) {
    const match = String(pathname || "").match(YONOTE_DOC_PATH_RE);
    return match ? match[1] : "";
  }

  function isTheoryPath(pathname) {
    return THEORY_PATH_RE.test(String(pathname || ""));
  }

  function extractRootBlockIdFromUrl(rawUrl) {
    const match = String(rawUrl || "").match(THEORY_GET_TREE_RE);
    return match ? match[1] : "";
  }

  function walk(value, visitor) {
    const direct = visitor(value);
    if (direct !== undefined) {
      return direct;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = walk(item, visitor);
        if (nested !== undefined) {
          return nested;
        }
      }
      return undefined;
    }

    if (!value || typeof value !== "object") {
      return undefined;
    }

    for (const nestedValue of Object.values(value)) {
      const nested = walk(nestedValue, visitor);
      if (nested !== undefined) {
        return nested;
      }
    }

    return undefined;
  }

  function extractTreeId(payload) {
    return (
      walk(payload, value => {
        if (value && typeof value === "object") {
          if (typeof value.tree_id === "string" && value.tree_id) {
            return value.tree_id;
          }
          if (typeof value.treeId === "string" && value.treeId) {
            return value.treeId;
          }
        }
        return undefined;
      }) || ""
    );
  }

  function normalizeNestedIds(nested) {
    if (!Array.isArray(nested)) {
      return [];
    }

    return nested
      .map(item => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && typeof item.id === "string") return item.id;
        return "";
      })
      .filter(Boolean);
  }

  function extractRootNested(payload, rootBlockId) {
    const found = walk(payload, value => {
      if (value && typeof value === "object" && value.id === rootBlockId && Array.isArray(value.nested)) {
        return normalizeNestedIds(value.nested);
      }
      return undefined;
    });

    if (Array.isArray(found)) {
      return found;
    }

    if (payload && typeof payload === "object" && Array.isArray(payload.nested)) {
      return normalizeNestedIds(payload.nested);
    }
    if (payload && typeof payload === "object" && payload.data && Array.isArray(payload.data.nested)) {
      return normalizeNestedIds(payload.data.nested);
    }

    return [];
  }

  function extractCreatedBlockId(payload) {
    if (payload && payload.data && typeof payload.data.id === "string" && payload.data.id) {
      return payload.data.id;
    }
    if (payload && typeof payload.id === "string" && payload.id) {
      return payload.id;
    }

    return (
      walk(payload, value => {
        if (value && typeof value === "object" && typeof value.id === "string" && value.id) {
          return value.id;
        }
        return undefined;
      }) || ""
    );
  }

  function buildTheoryBlockPayload(block, context) {
    if (block && block.kind === "image") {
      const caption = String(block.caption || "").trim();
      const url = String(block.url || "").trim();
      const alt = String(block.alt || "").trim();
      const markdown =
        typeof block.markdown === "string" && block.markdown.trim()
          ? block.markdown
          : buildImageBlockMarkdown(alt, url, caption, {
              linkTitle: block.linkTitle,
              captionSource: block.captionSource
            });

      return {
        tree_id: context.treeId,
        type: "Markdown",
        content: {
          type: "theory",
          markdown,
          url,
          alt,
          caption
        },
        parent: context.rootBlockId,
        nested: [],
        meta: {
          ...(block.meta || {}),
          blockType: "Image"
        }
      };
    }

    return {
      tree_id: context.treeId,
      type: "Markdown",
      content: {
        type: "theory",
        markdown: block.markdown
      },
      parent: context.rootBlockId,
      nested: [],
      meta: block.meta || {}
    };
  }

  function isAuthFailure(status) {
    return status === 401 || status === 403;
  }

  globalThis.PracticumHelperBridgeShared = {
    bridgeVersion: BRIDGE_BUILD,
    MESSAGE_TYPES,
    EVENT_TYPES,
    markBridgeInitialized,
    createRequestId,
    parseJsonSafe,
    createBridgeEnvelope,
    hasMatchingBridgeEnvelope,
    createYonoteSourceDiagnostics,
    getYonoteNetworkCaptureRegistry,
    resetYonoteNetworkCaptureRegistry,
    shouldCaptureYonoteApiResponse,
    captureYonoteApiSnapshot,
    classifyYonotePayloadShape,
    collectYonotePayloadNodeTypeHints,
    scoreYonoteStructuredCandidate,
    pickBestYonoteStructuredCandidate,
    findProseMirrorDocRoot,
    findTypedBlockRoot,
    findYonoteContentRoot,
    findWikiContentRoot,
    extractYonoteSourceAst,
    extractWikiSourceAst,
    extractWikiInlineImageAssets,
    extractYonoteSourceAstFromStructuredPayload,
    extractSourceAstFromProseMirrorNode,
    extractSourceAstFromTypedBlock,
    extractInlineTextFromStructuredNode,
    isMeaningfulStructuredAst,
    compileSourceAstToMarkdown,
    buildYonoteStructuredPayload,
    buildWikiStructuredPayload,
    buildYonoteFallbackPayload,
    buildYonoteNativeExportPayload,
    buildYonoteSourceResult,
    decodeTextBytes,
    extractZipEntriesFromArrayBuffer,
    pickPrimaryMarkdownZipEntry,
    compileTheoryBlocks,
    getYonoteSlugFromPath,
    isTheoryPath,
    extractRootBlockIdFromUrl,
    extractTreeId,
    extractRootNested,
    extractCreatedBlockId,
    buildTheoryBlockPayload,
    isAuthFailure
  };
})();
