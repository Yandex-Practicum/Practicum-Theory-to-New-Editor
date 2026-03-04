(function initBridgeChunk() {
  const bridgeInternals = globalThis.__PHBridgeInternals || (globalThis.__PHBridgeInternals = {});
  Object.assign(globalThis, bridgeInternals);

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

  Object.assign(bridgeInternals, {
    isFencedCodeStart,
    isHeading,
    isHorizontalRule,
    isUnorderedListLine,
    isOrderedListLine,
    isListStart,
    isListContinuation,
    isBlockquote,
    looksLikeTableSeparator,
    isTableStart,
    createCompiledBlock,
    isAbsoluteHttpUrl,
    unwrapMarkdownLinkTarget,
    parseMarkdownImageLinkTarget,
    isImageTitleMetadataSegment,
    extractCaptionFromImageTitle,
    extractItalicOnlyCaption,
    buildMarkdownImageLinkTarget,
    buildImageBlockMarkdown,
    parseStandaloneImageParagraph,
    enrichCompiledBlocksWithImages
  });
  Object.assign(globalThis, {
    isFencedCodeStart,
    isHeading,
    isHorizontalRule,
    isUnorderedListLine,
    isOrderedListLine,
    isListStart,
    isListContinuation,
    isBlockquote,
    looksLikeTableSeparator,
    isTableStart,
    createCompiledBlock,
    isAbsoluteHttpUrl,
    unwrapMarkdownLinkTarget,
    parseMarkdownImageLinkTarget,
    isImageTitleMetadataSegment,
    extractCaptionFromImageTitle,
    extractItalicOnlyCaption,
    buildMarkdownImageLinkTarget,
    buildImageBlockMarkdown,
    parseStandaloneImageParagraph,
    enrichCompiledBlocksWithImages
  });
})();
