function normalizeHeadingText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isMarkdownIdentifierChar(value) {
  return /^[0-9A-Za-z\u0400-\u04FF]$/.test(String(value || ""));
}

function escapeIdentifierUnderscoresInPlainText(value) {
  const text = String(value || "");
  let output = "";

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (
      char === "_" &&
      isMarkdownIdentifierChar(text[index - 1]) &&
      isMarkdownIdentifierChar(text[index + 1])
    ) {
      output += "\\_";
      continue;
    }

    output += char;
  }

  return output;
}

function consumeMarkdownFence(text, startIndex) {
  if (!(startIndex === 0 || text[startIndex - 1] === "\n") || !text.startsWith("```", startIndex)) {
    return -1;
  }

  const openingLineEnd = text.indexOf("\n", startIndex);
  if (openingLineEnd < 0) {
    return text.length;
  }

  let cursor = openingLineEnd + 1;
  while (cursor < text.length) {
    if ((cursor === 0 || text[cursor - 1] === "\n") && text.startsWith("```", cursor)) {
      const closingLineEnd = text.indexOf("\n", cursor);
      return closingLineEnd < 0 ? text.length : closingLineEnd + 1;
    }

    const nextLineStart = text.indexOf("\n", cursor);
    if (nextLineStart < 0) {
      return text.length;
    }
    cursor = nextLineStart + 1;
  }

  return text.length;
}

function consumeInlineCodeSpan(text, startIndex) {
  if (text[startIndex] !== "`") {
    return -1;
  }

  let tickCount = 1;
  while (text[startIndex + tickCount] === "`") {
    tickCount += 1;
  }

  const delimiter = "`".repeat(tickCount);
  const closingIndex = text.indexOf(delimiter, startIndex + tickCount);
  if (closingIndex < 0) {
    return startIndex + tickCount;
  }

  return closingIndex + tickCount;
}

function consumeMarkdownLinkLike(text, startIndex) {
  const startsImage = text[startIndex] === "!" && text[startIndex + 1] === "[";
  let cursor = startsImage ? startIndex + 1 : startIndex;
  if (text[cursor] !== "[") {
    return -1;
  }

  let bracketDepth = 0;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === "\\") {
      cursor += 2;
      continue;
    }

    if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]") {
      bracketDepth -= 1;
      if (bracketDepth === 0) {
        cursor += 1;
        break;
      }
    }

    cursor += 1;
  }

  if (bracketDepth !== 0 || text[cursor] !== "(") {
    return -1;
  }

  cursor += 1;
  let parenDepth = 1;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === "\\") {
      cursor += 2;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
    } else if (char === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) {
        return cursor + 1;
      }
    }

    cursor += 1;
  }

  return -1;
}

export function normalizeMarkdownForTheoryInsert(markdown) {
  const text = String(markdown || "");
  let output = "";
  let textBuffer = "";
  let index = 0;

  function flushTextBuffer() {
    if (!textBuffer) {
      return;
    }

    output += escapeIdentifierUnderscoresInPlainText(textBuffer);
    textBuffer = "";
  }

  while (index < text.length) {
    const fenceEnd = consumeMarkdownFence(text, index);
    if (fenceEnd > index) {
      flushTextBuffer();
      output += text.slice(index, fenceEnd);
      index = fenceEnd;
      continue;
    }

    const codeEnd = consumeInlineCodeSpan(text, index);
    if (codeEnd > index) {
      flushTextBuffer();
      output += text.slice(index, codeEnd);
      index = codeEnd;
      continue;
    }

    const linkEnd = consumeMarkdownLinkLike(text, index);
    if (linkEnd > index) {
      flushTextBuffer();
      output += text.slice(index, linkEnd);
      index = linkEnd;
      continue;
    }

    textBuffer += text[index];
    index += 1;
  }

  flushTextBuffer();
  return output;
}

export function ensureLeadingTitleHeading(title, markdown) {
  const normalizedTitle = String(title || "").trim();
  const body = String(markdown || "").replace(/\r\n?/g, "\n").trim();

  if (!normalizedTitle) {
    return body;
  }

  const match = body.match(/^#\s+(.+)$/m);
  if (match && normalizeHeadingText(match[1]) === normalizeHeadingText(normalizedTitle)) {
    return body;
  }

  return body ? `# ${normalizedTitle}\n\n${body}` : `# ${normalizedTitle}`;
}
