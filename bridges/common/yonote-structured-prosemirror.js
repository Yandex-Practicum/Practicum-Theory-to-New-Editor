(function initBridgeChunk() {
  const bridgeInternals = globalThis.__PHBridgeInternals || (globalThis.__PHBridgeInternals = {});
  Object.assign(globalThis, bridgeInternals);

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

  Object.assign(bridgeInternals, {
    extractSourceAstFromProseMirrorNode
  });
  Object.assign(globalThis, {
    extractSourceAstFromProseMirrorNode
  });
})();
