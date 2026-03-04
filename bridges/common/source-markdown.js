(function initBridgeChunk() {
  const bridgeInternals = globalThis.__PHBridgeInternals || (globalThis.__PHBridgeInternals = {});
  Object.assign(globalThis, bridgeInternals);

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

  Object.assign(bridgeInternals, {
    isMeaningfulStructuredAst,
    escapeTableCell,
    serializeList,
    serializeTable,
    compileSourceAstToMarkdown,
    dropDuplicateTitleHeading,
    createYonoteSourceDiagnostics,
    createYonotePayloadBase,
    buildYonoteStructuredPayload,
    buildYonoteFallbackPayload,
    buildYonoteNativeExportPayload
  });
  Object.assign(globalThis, {
    isMeaningfulStructuredAst,
    escapeTableCell,
    serializeList,
    serializeTable,
    compileSourceAstToMarkdown,
    dropDuplicateTitleHeading,
    createYonoteSourceDiagnostics,
    createYonotePayloadBase,
    buildYonoteStructuredPayload,
    buildYonoteFallbackPayload,
    buildYonoteNativeExportPayload
  });
})();
