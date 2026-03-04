(function initBridgeChunk() {
  const bridgeInternals = globalThis.__PHBridgeInternals || (globalThis.__PHBridgeInternals = {});
  Object.assign(globalThis, bridgeInternals);

function scoreYonoteStructuredCandidate(snapshot, currentDocContext = {}) {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }

  const schemaKind = snapshot.schemaKind || classifyYonotePayloadShape(snapshot.responseBody);
  const nodeTypeHints = Array.isArray(snapshot.nodeTypeHints)
    ? snapshot.nodeTypeHints
    : collectYonotePayloadNodeTypeHints(snapshot.responseBody);
  const documentMatch = buildYonoteDocumentMatch(snapshot, currentDocContext);
  const path = snapshot.renderApiPath || extractYonoteApiPath(snapshot.url || "");
  const payloadHasNestedArrays = hasNestedArrayAboveLength(snapshot.responseBody, 3);

  let score = 0;

  if (documentMatch.requestMentionsSourceSlug || documentMatch.responseMentionsSourceSlug) {
    score += 8;
  }

  if (schemaKind === "prosemirror-doc") {
    score += 8;
  } else if (schemaKind === "typed-block-array") {
    score += 6;
  } else if (schemaKind === "typed-block-map") {
    score += 5;
  }

  if (
    nodeTypeHints.some(hint => {
      return (
        hint.includes("table") ||
        hint.includes("heading") ||
        hint.includes("paragraph") ||
        hint.includes("bullet") ||
        hint.includes("ordered") ||
        hint.includes("list")
      );
    })
  ) {
    score += 4;
  }

  if (new Set(nodeTypeHints).size >= 3) {
    score += 2;
  }

  if (matchesYonoteCaptureNoise(path)) {
    score -= 6;
  }

  if (!payloadHasNestedArrays) {
    score -= 4;
  }

  return {
    ...snapshot,
    renderApiPath: path,
    renderApiMethod: snapshot.renderApiMethod || snapshot.method || "GET",
    schemaKind,
    nodeTypeHints,
    documentMatch,
    candidateScore: score
  };
}

function pickBestYonoteStructuredCandidate(captureRegistry, currentDocContext = {}) {
  const registry = Array.isArray(captureRegistry) ? captureRegistry : getYonoteNetworkCaptureRegistry();
  const scored = registry
    .map(snapshot => scoreYonoteStructuredCandidate(snapshot, currentDocContext))
    .filter(Boolean)
    .filter(snapshot => snapshot.candidateScore > 8)
    .sort((left, right) => {
      if (right.candidateScore !== left.candidateScore) {
        return right.candidateScore - left.candidateScore;
      }

      return new Date(right.capturedAt || 0).getTime() - new Date(left.capturedAt || 0).getTime();
    });

  return scored[0] || null;
}

function captureYonoteApiSnapshot({ url, method, requestBody, responseBody, sourceSlug }) {
  if (!isYonoteSameOriginApiUrl(url)) {
    return null;
  }

  const renderApiPath = extractYonoteApiPath(url);
  const schemaKind = classifyYonotePayloadShape(responseBody);
  const nodeTypeHints = collectYonotePayloadNodeTypeHints(responseBody);
  const topLevelNoise = responseBody && typeof responseBody === "object" && !Array.isArray(responseBody)
    ? Object.keys(responseBody).some(matchesYonoteCaptureNoise)
    : false;

  if (matchesYonoteCaptureNoise(renderApiPath)) {
    return null;
  }

  if (topLevelNoise && schemaKind === "unknown") {
    return null;
  }

  const snapshot = {
    url,
    renderApiPath,
    renderApiMethod: String(method || "GET").toUpperCase(),
    requestBody: requestBody === undefined ? null : requestBody,
    responseBody,
    capturedAt: new Date().toISOString(),
    documentMatch: {
      requestMentionsSourceSlug:
        Boolean(sourceSlug) &&
        (valueReferencesToken(requestBody, sourceSlug) || valueReferencesToken(renderApiPath, sourceSlug)),
      responseMentionsSourceSlug: Boolean(sourceSlug) && valueReferencesToken(responseBody, sourceSlug),
      requestMentionsDocumentId: false,
      responseMentionsDocumentId: false
    },
    schemaKind,
    candidateScore: 0,
    nodeTypeHints
  };

  const hydrated = scoreYonoteStructuredCandidate(snapshot, {
    sourceSlug: sourceSlug || "",
    documentId: ""
  });

  const registry = getYonoteNetworkCaptureRegistry();
  registry.push(hydrated);

  while (registry.length > YONOTE_CAPTURE_LIMIT) {
    registry.shift();
  }

  return hydrated;
}

  Object.assign(bridgeInternals, {
    scoreYonoteStructuredCandidate,
    pickBestYonoteStructuredCandidate,
    captureYonoteApiSnapshot
  });
  Object.assign(globalThis, {
    scoreYonoteStructuredCandidate,
    pickBestYonoteStructuredCandidate,
    captureYonoteApiSnapshot
  });
})();
