(function initBridgeChunk() {
  const bridgeInternals = globalThis.__PHBridgeInternals || (globalThis.__PHBridgeInternals = {});
  Object.assign(globalThis, bridgeInternals);

function walk(value, visitor) {
  const direct = visitor(value);
  if (direct !== undefined) {
    return direct;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = walk(item, visitor);
      if (nested !== undefined) {
        return nested;
      }
    }
    return undefined;
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  for (const nestedValue of Object.values(value)) {
    const nested = walk(nestedValue, visitor);
    if (nested !== undefined) {
      return nested;
    }
  }

  return undefined;
}

function extractTreeId(payload) {
  return (
    walk(payload, value => {
      if (value && typeof value === "object") {
        if (typeof value.tree_id === "string" && value.tree_id) {
          return value.tree_id;
        }
        if (typeof value.treeId === "string" && value.treeId) {
          return value.treeId;
        }
      }
      return undefined;
    }) || ""
  );
}

function normalizeNestedIds(nested) {
  if (!Array.isArray(nested)) {
    return [];
  }

  return nested
    .map(item => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && typeof item.id === "string") return item.id;
      return "";
    })
    .filter(Boolean);
}

function extractRootNested(payload, rootBlockId) {
  const found = walk(payload, value => {
    if (value && typeof value === "object" && value.id === rootBlockId && Array.isArray(value.nested)) {
      return normalizeNestedIds(value.nested);
    }
    return undefined;
  });

  if (Array.isArray(found)) {
    return found;
  }

  if (payload && typeof payload === "object" && Array.isArray(payload.nested)) {
    return normalizeNestedIds(payload.nested);
  }
  if (payload && typeof payload === "object" && payload.data && Array.isArray(payload.data.nested)) {
    return normalizeNestedIds(payload.data.nested);
  }

  return [];
}

function extractCreatedBlockId(payload) {
  if (payload && payload.data && typeof payload.data.id === "string" && payload.data.id) {
    return payload.data.id;
  }
  if (payload && typeof payload.id === "string" && payload.id) {
    return payload.id;
  }

  return (
    walk(payload, value => {
      if (value && typeof value === "object" && typeof value.id === "string" && value.id) {
        return value.id;
      }
      return undefined;
    }) || ""
  );
}

function buildTheoryBlockPayload(block, context) {
  if (block && block.kind === "image") {
    const caption = String(block.caption || "").trim();
    const url = String(block.url || "").trim();
    const alt = String(block.alt || "").trim();
    const markdown =
      typeof block.markdown === "string" && block.markdown.trim()
        ? block.markdown
        : buildImageBlockMarkdown(alt, url, caption, {
            linkTitle: block.linkTitle,
            captionSource: block.captionSource
          });

    return {
      tree_id: context.treeId,
      type: "Markdown",
      content: {
        type: "theory",
        markdown,
        url,
        alt,
        caption
      },
      parent: context.rootBlockId,
      nested: [],
      meta: {
        ...(block.meta || {}),
        blockType: "Image"
      }
    };
  }

  return {
    tree_id: context.treeId,
    type: "Markdown",
    content: {
      type: "theory",
      markdown: block.markdown
    },
    parent: context.rootBlockId,
    nested: [],
    meta: block.meta || {}
  };
}

function isAuthFailure(status) {
  return status === 401 || status === 403;
}

  Object.assign(bridgeInternals, {
    walk,
    extractTreeId,
    normalizeNestedIds,
    extractRootNested,
    extractCreatedBlockId,
    buildTheoryBlockPayload,
    isAuthFailure
  });
  Object.assign(globalThis, {
    walk,
    extractTreeId,
    normalizeNestedIds,
    extractRootNested,
    extractCreatedBlockId,
    buildTheoryBlockPayload,
    isAuthFailure
  });
})();
