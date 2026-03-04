(function initBridgeChunk() {
  const bridgeInternals = globalThis.__PHBridgeInternals || (globalThis.__PHBridgeInternals = {});
  Object.assign(globalThis, bridgeInternals);

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

  Object.assign(bridgeInternals, {
    collectWikiNestedListLines,
    extractWikiListNode,
    extractWikiHeadingNode,
    extractWikiBlockquoteNode,
    isWikiSkippableElement,
    tryExtractWikiSemanticNode,
    extractWikiChildNodes,
    extractWikiSourceAst
  });
  Object.assign(globalThis, {
    collectWikiNestedListLines,
    extractWikiListNode,
    extractWikiHeadingNode,
    extractWikiBlockquoteNode,
    isWikiSkippableElement,
    tryExtractWikiSemanticNode,
    extractWikiChildNodes,
    extractWikiSourceAst
  });
})();
