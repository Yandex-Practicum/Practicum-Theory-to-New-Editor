(function initBridgeChunk() {
  const bridgeInternals = globalThis.__PHBridgeInternals || (globalThis.__PHBridgeInternals = {});
  Object.assign(globalThis, bridgeInternals);

function getYonoteNetworkCaptureRegistry() {
  const registry = globalThis[YONOTE_CAPTURE_REGISTRY_KEY];
  if (Array.isArray(registry)) {
    return registry;
  }

  const nextRegistry = [];
  globalThis[YONOTE_CAPTURE_REGISTRY_KEY] = nextRegistry;
  return nextRegistry;
}

function resetYonoteNetworkCaptureRegistry() {
  const registry = getYonoteNetworkCaptureRegistry();
  registry.length = 0;
  return registry;
}

function normalizeStructuredType(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

function getStructuredTypeValue(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return "";
  }

  for (const key of STRUCTURED_NODE_TYPE_KEYS) {
    if (typeof node[key] === "string" && node[key]) {
      return normalizeStructuredType(node[key]);
    }
  }

  return "";
}

function getStructuredChildArray(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return null;
  }

  for (const key of STRUCTURED_CHILD_KEYS) {
    if (Array.isArray(node[key])) {
      return node[key];
    }
  }

  return null;
}

function getStructuredTextValue(node) {
  if (typeof node === "string") {
    return node;
  }

  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return "";
  }

  for (const key of STRUCTURED_TEXT_KEYS) {
    if (typeof node[key] === "string" && node[key]) {
      return node[key];
    }
  }

  return "";
}

function isTypedBlockArrayCandidate(value) {
  if (!Array.isArray(value) || value.length < 3) {
    return false;
  }

  const objectCount = value.filter(item => item && typeof item === "object" && !Array.isArray(item)).length;
  if (!objectCount) {
    return false;
  }

  const typedCount = value.filter(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return false;
    }

    return STRUCTURED_NODE_TYPE_KEYS.some(key => typeof item[key] === "string" && item[key]);
  }).length;

  return objectCount > 0 && typedCount / objectCount >= 0.6;
}

function countStructuredPayloadSignal(value, limit = 250) {
  let count = 0;
  const seen = new Set();

  function visit(node) {
    if (count >= limit || !node || typeof node !== "object" || seen.has(node)) {
      return;
    }

    seen.add(node);

    if (Array.isArray(node)) {
      count += Math.min(node.length, 4);
      node.forEach(visit);
      return;
    }

    if (getStructuredTypeValue(node)) {
      count += 2;
    }

    const childArray = getStructuredChildArray(node);
    if (childArray) {
      count += Math.min(childArray.length, 4);
    }

    Object.values(node).forEach(visit);
  }

  visit(value);
  return count;
}

function findProseMirrorDocRoot(payload) {
  let best = null;
  const seen = new Set();

  function visit(node, depth) {
    if (!node || typeof node !== "object" || seen.has(node)) {
      return;
    }

    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach(item => visit(item, depth + 1));
      return;
    }

    if (node.type === "doc" && Array.isArray(node.content)) {
      const signal = countStructuredPayloadSignal(node);
      const weight = depth * 1000 + signal;
      if (!best || weight > best.weight) {
        best = { node, weight };
      }
    }

    Object.values(node).forEach(value => visit(value, depth + 1));
  }

  visit(payload, 0);
  return best ? best.node : null;
}

function findTypedBlockRoot(payload) {
  let best = null;
  const seen = new Set();

  function consider(root, schemaKind, depth) {
    if (!root) {
      return;
    }

    const size = Array.isArray(root) ? root.length : (getStructuredChildArray(root) || []).length;
    const signal = countStructuredPayloadSignal(root);
    const weight = depth * 1000 + size * 10 + signal;

    if (!best || weight > best.weight) {
      best = {
        root: Array.isArray(root) ? root : getStructuredChildArray(root) || [],
        schemaKind,
        weight
      };
    }
  }

  function visit(node, depth) {
    if (!node || typeof node !== "object" || seen.has(node)) {
      return;
    }

    seen.add(node);

    if (Array.isArray(node)) {
      if (isTypedBlockArrayCandidate(node)) {
        consider(node, "typed-block-array", depth);
      }
      node.forEach(item => visit(item, depth + 1));
      return;
    }

    for (const key of STRUCTURED_CHILD_KEYS) {
      if (isTypedBlockArrayCandidate(node[key])) {
        consider(node, "typed-block-map", depth + 1);
      }
    }

    Object.values(node).forEach(value => visit(value, depth + 1));
  }

  visit(payload, 0);
  return best ? { root: best.root, schemaKind: best.schemaKind } : null;
}

function classifyYonotePayloadShape(payload) {
  if (findProseMirrorDocRoot(payload)) {
    return "prosemirror-doc";
  }

  const typedRoot = findTypedBlockRoot(payload);
  if (typedRoot) {
    return typedRoot.schemaKind;
  }

  return "unknown";
}

function collectYonotePayloadNodeTypeHints(payload) {
  const hints = new Set();
  const seen = new Set();

  function visit(node) {
    if (hints.size >= 8 || !node || typeof node !== "object" || seen.has(node)) {
      return;
    }

    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    STRUCTURED_NODE_TYPE_KEYS.forEach(key => {
      if (typeof node[key] === "string" && node[key]) {
        hints.add(normalizeStructuredType(node[key]));
      }
    });

    Object.values(node).forEach(visit);
  }

  visit(payload);
  return Array.from(hints).slice(0, 8);
}

function safeSerializeForMatch(value) {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined || value === null) {
    return "";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function valueReferencesToken(value, token) {
  if (!token) {
    return false;
  }

  return safeSerializeForMatch(value).toLowerCase().includes(String(token).toLowerCase());
}

function hasNestedArrayAboveLength(value, minLength = 3) {
  let found = false;
  const seen = new Set();

  function visit(node) {
    if (found || !node || typeof node !== "object" || seen.has(node)) {
      return;
    }

    seen.add(node);

    if (Array.isArray(node)) {
      if (node.length >= minLength) {
        found = true;
        return;
      }

      node.forEach(visit);
      return;
    }

    Object.values(node).forEach(visit);
  }

  visit(value);
  return found;
}

function matchesYonoteCaptureNoise(value) {
  const lower = String(value || "").toLowerCase();
  return YONOTE_CAPTURE_NOISE_TERMS.some(term => lower.includes(term));
}

function extractYonoteApiPath(rawUrl) {
  try {
    const url = new URL(rawUrl, globalThis.location && globalThis.location.href ? globalThis.location.href : "https://yonote.ru/");
    return `${url.pathname}${url.search}`;
  } catch {
    return "";
  }
}

function isYonoteSameOriginApiUrl(rawUrl) {
  try {
    const base = globalThis.location && globalThis.location.href ? globalThis.location.href : "https://yonote.ru/";
    const url = new URL(rawUrl, base);
    const origin = globalThis.location && globalThis.location.origin ? globalThis.location.origin : url.origin;
    return url.origin === origin && /^\/api\//i.test(url.pathname);
  } catch {
    return false;
  }
}

function shouldCaptureYonoteApiResponse({ url, contentType, status, responseLength }) {
  if (!isYonoteSameOriginApiUrl(url)) {
    return false;
  }

  if (!status || status < 200 || status >= 300) {
    return false;
  }

  if (!/application\/json/i.test(String(contentType || ""))) {
    return false;
  }

  if (Number(responseLength || 0) > YONOTE_CAPTURE_MAX_TEXT_BYTES) {
    return false;
  }

  return !matchesYonoteCaptureNoise(extractYonoteApiPath(url));
}

function buildYonoteDocumentMatch(snapshot, currentDocContext = {}) {
  const sourceSlug = currentDocContext.sourceSlug || "";
  const documentId = currentDocContext.documentId || "";
  const path = snapshot.renderApiPath || extractYonoteApiPath(snapshot.url || "");

  return {
    requestMentionsSourceSlug:
      Boolean(sourceSlug) &&
      (Boolean(snapshot.documentMatch && snapshot.documentMatch.requestMentionsSourceSlug) ||
        valueReferencesToken(snapshot.requestBody, sourceSlug) ||
        valueReferencesToken(path, sourceSlug)),
    responseMentionsSourceSlug:
      Boolean(sourceSlug) &&
      (Boolean(snapshot.documentMatch && snapshot.documentMatch.responseMentionsSourceSlug) ||
        valueReferencesToken(snapshot.responseBody, sourceSlug)),
    requestMentionsDocumentId:
      Boolean(documentId) &&
      (Boolean(snapshot.documentMatch && snapshot.documentMatch.requestMentionsDocumentId) ||
        valueReferencesToken(snapshot.requestBody, documentId)),
    responseMentionsDocumentId:
      Boolean(documentId) &&
      (Boolean(snapshot.documentMatch && snapshot.documentMatch.responseMentionsDocumentId) ||
        valueReferencesToken(snapshot.responseBody, documentId))
  };
}

  Object.assign(bridgeInternals, {
    getYonoteNetworkCaptureRegistry,
    resetYonoteNetworkCaptureRegistry,
    normalizeStructuredType,
    getStructuredTypeValue,
    getStructuredChildArray,
    getStructuredTextValue,
    isTypedBlockArrayCandidate,
    countStructuredPayloadSignal,
    findProseMirrorDocRoot,
    findTypedBlockRoot,
    classifyYonotePayloadShape,
    collectYonotePayloadNodeTypeHints,
    safeSerializeForMatch,
    valueReferencesToken,
    hasNestedArrayAboveLength,
    matchesYonoteCaptureNoise,
    extractYonoteApiPath,
    isYonoteSameOriginApiUrl,
    shouldCaptureYonoteApiResponse,
    buildYonoteDocumentMatch
  });
  Object.assign(globalThis, {
    getYonoteNetworkCaptureRegistry,
    resetYonoteNetworkCaptureRegistry,
    normalizeStructuredType,
    getStructuredTypeValue,
    getStructuredChildArray,
    getStructuredTextValue,
    isTypedBlockArrayCandidate,
    countStructuredPayloadSignal,
    findProseMirrorDocRoot,
    findTypedBlockRoot,
    classifyYonotePayloadShape,
    collectYonotePayloadNodeTypeHints,
    safeSerializeForMatch,
    valueReferencesToken,
    hasNestedArrayAboveLength,
    matchesYonoteCaptureNoise,
    extractYonoteApiPath,
    isYonoteSameOriginApiUrl,
    shouldCaptureYonoteApiResponse,
    buildYonoteDocumentMatch
  });
})();
