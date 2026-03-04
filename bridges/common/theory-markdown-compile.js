(function initBridgeChunk() {
  const bridgeInternals = globalThis.__PHBridgeInternals || (globalThis.__PHBridgeInternals = {});
  Object.assign(globalThis, bridgeInternals);

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

  Object.assign(bridgeInternals, {
    compileTheoryBlocks,
    getYonoteSlugFromPath,
    isTheoryPath,
    extractRootBlockIdFromUrl
  });
  Object.assign(globalThis, {
    compileTheoryBlocks,
    getYonoteSlugFromPath,
    isTheoryPath,
    extractRootBlockIdFromUrl
  });
})();
