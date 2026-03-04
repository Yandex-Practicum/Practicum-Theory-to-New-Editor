(function initBridgeChunk() {
  const bridgeInternals = globalThis.__PHBridgeInternals || (globalThis.__PHBridgeInternals = {});
  Object.assign(globalThis, bridgeInternals);

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

  Object.assign(bridgeInternals, {
    clampHeadingLevel,
    extractInlineTextFromStructuredNode,
    collapseSourceNodesToText,
    listNodeToIndentedLines,
    extractBlockTextFromStructuredChildren,
    extractSourceAstFromProseMirrorNodes,
    extractProseMirrorListNode,
    extractProseMirrorTableNode
  });
  Object.assign(globalThis, {
    clampHeadingLevel,
    extractInlineTextFromStructuredNode,
    collapseSourceNodesToText,
    listNodeToIndentedLines,
    extractBlockTextFromStructuredChildren,
    extractSourceAstFromProseMirrorNodes,
    extractProseMirrorListNode,
    extractProseMirrorTableNode
  });
})();
