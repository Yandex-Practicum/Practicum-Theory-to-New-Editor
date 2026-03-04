(function initBridgeChunk() {
  const bridgeInternals = globalThis.__PHBridgeInternals || (globalThis.__PHBridgeInternals = {});
  Object.assign(globalThis, bridgeInternals);

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

  Object.assign(bridgeInternals, {
    collectListItemContent,
    collectNestedListLines,
    extractListNode,
    extractBlockquoteNode,
    detectCodeLanguage,
    extractCodeBlockNode,
    extractTableNode,
    tryExtractSemanticNode,
    extractChildNodes,
    extractYonoteSourceAst
  });
  Object.assign(globalThis, {
    collectListItemContent,
    collectNestedListLines,
    extractListNode,
    extractBlockquoteNode,
    detectCodeLanguage,
    extractCodeBlockNode,
    extractTableNode,
    tryExtractSemanticNode,
    extractChildNodes,
    extractYonoteSourceAst
  });
})();
