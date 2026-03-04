(function initBridgeChunk() {
  const bridgeInternals = globalThis.__PHBridgeInternals || (globalThis.__PHBridgeInternals = {});
  Object.assign(globalThis, bridgeInternals);

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

  Object.assign(bridgeInternals, {
    buildWikiImageMarkdownFromElement,
    wrapWikiInlineMarkdown,
    collectWikiInlineMarkdown,
    createWikiParagraphNode,
    collectWikiListItemContent
  });
  Object.assign(globalThis, {
    buildWikiImageMarkdownFromElement,
    wrapWikiInlineMarkdown,
    collectWikiInlineMarkdown,
    createWikiParagraphNode,
    collectWikiListItemContent
  });
})();
