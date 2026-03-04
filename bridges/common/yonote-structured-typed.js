(function initBridgeChunk() {
  const bridgeInternals = globalThis.__PHBridgeInternals || (globalThis.__PHBridgeInternals = {});
  Object.assign(globalThis, bridgeInternals);

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

  Object.assign(bridgeInternals, {
    extractTypedListItemText,
    extractTypedListNode,
    extractTypedTableNode,
    extractSourceAstFromTypedNodes,
    extractSourceAstFromTypedBlock,
    extractYonoteSourceAstFromStructuredPayload
  });
  Object.assign(globalThis, {
    extractTypedListItemText,
    extractTypedListNode,
    extractTypedTableNode,
    extractSourceAstFromTypedNodes,
    extractSourceAstFromTypedBlock,
    extractYonoteSourceAstFromStructuredPayload
  });
})();
