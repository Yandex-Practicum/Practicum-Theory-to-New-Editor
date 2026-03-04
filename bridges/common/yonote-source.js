(function initBridgeChunk() {
  const bridgeInternals = globalThis.__PHBridgeInternals || (globalThis.__PHBridgeInternals = {});
  Object.assign(globalThis, bridgeInternals);

function buildYonoteSourceResult({ captureRegistry, domAst, documentData, sourceUrl, sourceSlug }) {
  const currentDocContext = {
    sourceSlug: sourceSlug || "",
    documentId: String(documentData && documentData.id ? documentData.id : "")
  };

  const bestSnapshot = pickBestYonoteStructuredCandidate(captureRegistry, currentDocContext);
  let diagnostics;

  if (!bestSnapshot) {
    diagnostics = createYonoteSourceDiagnostics({
      captureStatus: "missing",
      fallbackReason: "no-captured-render-payload"
    });
  } else {
    diagnostics = createYonoteSourceDiagnostics({
      renderApiPath: bestSnapshot.renderApiPath || extractYonoteApiPath(bestSnapshot.url || ""),
      renderApiMethod: bestSnapshot.renderApiMethod || "GET",
      schemaKind: bestSnapshot.schemaKind || "unknown",
      captureStatus: bestSnapshot.schemaKind === "unknown" ? "unsupported" : "captured",
      candidateScore: bestSnapshot.candidateScore || 0,
      nodeTypeHints: bestSnapshot.nodeTypeHints || []
    });
  }

  if (bestSnapshot) {
    const structuredAst = extractYonoteSourceAstFromStructuredPayload(bestSnapshot, documentData);
    if (isMeaningfulStructuredAst(structuredAst)) {
      const payload = buildYonoteStructuredPayload(structuredAst, documentData, sourceUrl, sourceSlug, {
        sourceMode: "Yonote render API",
        diagnostics
      });

      return {
        payload,
        diagnostics: payload.diagnostics
      };
    }

    diagnostics = createYonoteSourceDiagnostics({
      ...diagnostics,
      captureStatus: "unsupported",
      fallbackReason: bestSnapshot.schemaKind === "unknown" ? "unsupported-render-schema" : "render-extraction-too-thin"
    });
  }

  if (isMeaningfulStructuredAst(domAst)) {
    const payload = buildYonoteStructuredPayload(domAst, documentData, sourceUrl, sourceSlug, {
      sourceMode: "Rendered DOM fallback",
      diagnostics
    });

    return {
      payload,
      diagnostics: payload.diagnostics
    };
  }

  if (!diagnostics.fallbackReason) {
    diagnostics = createYonoteSourceDiagnostics({
      ...diagnostics,
      fallbackReason: "dom-extraction-too-thin",
      captureStatus: diagnostics.captureStatus === "captured" ? "captured" : diagnostics.captureStatus
    });
  }

  const payload = buildYonoteFallbackPayload(documentData, sourceUrl, sourceSlug, {
    diagnostics
  });

  return {
    payload,
    diagnostics: payload.diagnostics
  };
}

  Object.assign(bridgeInternals, {
    buildYonoteSourceResult
  });
  Object.assign(globalThis, {
    buildYonoteSourceResult
  });
})();
