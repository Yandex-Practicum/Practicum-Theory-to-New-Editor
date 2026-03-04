(function initBridgeChunk() {
  const bridgeInternals = globalThis.__PHBridgeInternals || (globalThis.__PHBridgeInternals = {});
  Object.assign(globalThis, bridgeInternals);

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

  Object.assign(bridgeInternals, {
    collectTextWithLineBreaks,
    resolveMarkdownHref,
    createTextualNodeFromText,
    parsePseudoList,
    isBlockLikeElement,
    isTextOnlyBlockElement,
    normalizeComparisonText,
    hasForbiddenSyntheticHeadingAncestor,
    nextMeaningfulSibling,
    isParagraphLikeForSyntheticHeading,
    isSyntheticHeadingElement,
    extractHeadingNode
  });
  Object.assign(globalThis, {
    collectTextWithLineBreaks,
    resolveMarkdownHref,
    createTextualNodeFromText,
    parsePseudoList,
    isBlockLikeElement,
    isTextOnlyBlockElement,
    normalizeComparisonText,
    hasForbiddenSyntheticHeadingAncestor,
    nextMeaningfulSibling,
    isParagraphLikeForSyntheticHeading,
    isSyntheticHeadingElement,
    extractHeadingNode
  });
})();
