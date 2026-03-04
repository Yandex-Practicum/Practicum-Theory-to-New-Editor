(function initBridgeChunk() {
  const bridgeInternals = globalThis.__PHBridgeInternals || (globalThis.__PHBridgeInternals = {});
  Object.assign(globalThis, bridgeInternals);

function isElementNode(node) {
  return Boolean(node && node.nodeType === 1);
}

function isTextNode(node) {
  return Boolean(node && node.nodeType === 3);
}

function getTagName(element) {
  return isElementNode(element) ? element.tagName.toUpperCase() : "";
}

function getOwnerWindow(node) {
  return (node && node.ownerDocument && node.ownerDocument.defaultView) || globalThis;
}

function getComputedStyleSafe(element) {
  const view = getOwnerWindow(element);
  if (!view || typeof view.getComputedStyle !== "function") {
    return null;
  }
  return view.getComputedStyle(element);
}

function isVisibleElement(element) {
  if (!isElementNode(element)) {
    return false;
  }

  if (element.hidden) {
    return false;
  }

  if (String(element.getAttribute("aria-hidden") || "").toLowerCase() === "true") {
    return false;
  }

  const style = getComputedStyleSafe(element);
  if (!style) {
    return true;
  }

  return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse";
}

function matchesExcludedTerm(value) {
  const normalized = String(value || "").toLowerCase();
  return EXCLUDED_SUBTREE_TERMS.some(term => normalized.includes(term));
}

function hasExcludedAttribute(element) {
  if (!isElementNode(element)) {
    return false;
  }

  if (matchesExcludedTerm(element.id) || matchesExcludedTerm(element.className)) {
    return true;
  }

  return Array.from(element.attributes || []).some(attribute => {
    return attribute.name.startsWith("data-") && matchesExcludedTerm(attribute.value);
  });
}

function isExcludedSubtreeRoot(element) {
  const tagName = getTagName(element);
  if (!tagName) {
    return false;
  }

  if (tagName === "ASIDE" || tagName === "NAV") {
    return true;
  }

  if (String(element.getAttribute("role") || "").toLowerCase() === "dialog") {
    return true;
  }

  if (String(element.getAttribute("aria-modal") || "").toLowerCase() === "true") {
    return true;
  }

  return hasExcludedAttribute(element);
}

function isInsideExcludedSubtree(element, boundary) {
  let current = element;
  while (current && current !== boundary) {
    if (isExcludedSubtreeRoot(current)) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function getViewportWidth(element) {
  const view = getOwnerWindow(element);
  if (view && typeof view.innerWidth === "number" && view.innerWidth > 0) {
    return view.innerWidth;
  }

  const doc = element && element.ownerDocument;
  if (doc && doc.documentElement && doc.documentElement.clientWidth > 0) {
    return doc.documentElement.clientWidth;
  }

  return 0;
}

function isInCentralViewportBand(element) {
  const viewportWidth = getViewportWidth(element);
  if (!viewportWidth || typeof element.getBoundingClientRect !== "function") {
    return true;
  }

  const rect = element.getBoundingClientRect();
  if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.width) || rect.width <= 0) {
    return true;
  }

  const midpoint = rect.left + rect.width / 2;
  return midpoint >= viewportWidth * 0.2 && midpoint <= viewportWidth * 0.8;
}

function isInteractiveControlElement(element) {
  const tagName = getTagName(element);
  return (
    tagName === "BUTTON" ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    (tagName === "A" && String(element.getAttribute("role") || "").toLowerCase() === "button")
  );
}

function collectDescendants(root, visitor) {
  const items = [];

  function walk(node) {
    if (!isElementNode(node)) {
      return;
    }

    for (const child of Array.from(node.children || [])) {
      if (!isVisibleElement(child) || isExcludedSubtreeRoot(child)) {
        continue;
      }

      if (visitor(child)) {
        items.push(child);
      }

      walk(child);
    }
  }

  walk(root);
  return items;
}

function scoreYonoteCandidate(candidate) {
  if (!isVisibleElement(candidate) || isExcludedSubtreeRoot(candidate) || !isInCentralViewportBand(candidate)) {
    return null;
  }

  const descendants = collectDescendants(candidate, () => true);
  const semanticDescendants = descendants.filter(element => {
    const tagName = getTagName(element);
    return (
      /^H[1-6]$/.test(tagName) ||
      ["P", "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "BLOCKQUOTE", "PRE", "CODE", "HR", "IMG"]
        .includes(tagName)
    );
  });

  if (!semanticDescendants.length) {
    return null;
  }

  const candidateText = normalizeInlineText(candidate.textContent || "");
  const wordCount = candidateText ? candidateText.split(/\s+/).filter(Boolean).length : 0;
  if (candidateText.length < 80 && wordCount < 12) {
    return null;
  }

  const tables = semanticDescendants.filter(element => getTagName(element) === "TABLE").length;
  const lists = semanticDescendants.filter(element => {
    const tagName = getTagName(element);
    return tagName === "UL" || tagName === "OL";
  }).length;
  const headings = semanticDescendants.filter(element => /^H[2-6]$/.test(getTagName(element))).length;
  const blockquotes = semanticDescendants.filter(element => getTagName(element) === "BLOCKQUOTE").length;
  const preBlocks = semanticDescendants.filter(element => getTagName(element) === "PRE").length;
  const images = semanticDescendants.filter(element => getTagName(element) === "IMG").length;
  const paragraphs = semanticDescendants.filter(element => getTagName(element) === "P").length;
  const interactive = descendants.filter(isInteractiveControlElement).length;
  const commentMarkers = descendants.filter(element => hasExcludedAttribute(element)).length;

  const semanticSignal = semanticDescendants.length + Math.max(1, Math.floor(paragraphs / 2));
  const highInteractiveDensity = interactive >= 3 && interactive * 2 >= semanticSignal;

  let score = 0;
  if (tables > 0) score += 5;
  if (lists > 0) score += 4;
  if (headings > 0) score += 4;
  if (blockquotes > 0) score += 3;
  if (preBlocks > 0) score += 3;
  if (images > 0) score += 2;
  score += Math.floor(paragraphs / 3);
  if (highInteractiveDensity) score -= 5;
  if (commentMarkers > 0 || matchesExcludedTerm(candidateText)) score -= 8;

  return score;
}

function findYonoteContentRoot(documentRef) {
  function pickBestCandidate(scopeRoot) {
    if (!scopeRoot || !isVisibleElement(scopeRoot)) {
      return null;
    }

    const candidates = [scopeRoot, ...Array.from(scopeRoot.querySelectorAll("*"))]
      .filter(element => isElementNode(element) && element.children && element.children.length)
      .filter(element => !isInsideExcludedSubtree(element, scopeRoot))
      .map(element => ({
        element,
        score: scoreYonoteCandidate(element)
      }))
      .filter(item => item.score !== null);

    if (!candidates.length) {
      return null;
    }

    candidates.sort((left, right) => right.score - left.score);
    return candidates[0].element;
  }

  const scopedRoot =
    documentRef && (documentRef.querySelector("main") || documentRef.querySelector('[role="main"]'));
  const scopedCandidate = pickBestCandidate(scopedRoot);
  if (scopedCandidate) {
    return scopedCandidate;
  }

  const proseMirrorRoots = Array.from((documentRef && documentRef.querySelectorAll(".ProseMirror")) || [])
    .filter(element => isElementNode(element) && isVisibleElement(element))
    .filter(element => !isExcludedSubtreeRoot(element))
    .map(element => ({
      element,
      score: scoreYonoteCandidate(element)
    }))
    .filter(item => item.score !== null);

  if (!proseMirrorRoots.length) {
    return null;
  }

  proseMirrorRoots.sort((left, right) => right.score - left.score);
  return proseMirrorRoots[0].element;
}

  Object.assign(bridgeInternals, {
    isElementNode,
    isTextNode,
    getTagName,
    getOwnerWindow,
    getComputedStyleSafe,
    isVisibleElement,
    matchesExcludedTerm,
    hasExcludedAttribute,
    isExcludedSubtreeRoot,
    isInsideExcludedSubtree,
    getViewportWidth,
    isInCentralViewportBand,
    isInteractiveControlElement,
    collectDescendants,
    scoreYonoteCandidate,
    findYonoteContentRoot
  });
  Object.assign(globalThis, {
    isElementNode,
    isTextNode,
    getTagName,
    getOwnerWindow,
    getComputedStyleSafe,
    isVisibleElement,
    matchesExcludedTerm,
    hasExcludedAttribute,
    isExcludedSubtreeRoot,
    isInsideExcludedSubtree,
    getViewportWidth,
    isInCentralViewportBand,
    isInteractiveControlElement,
    collectDescendants,
    scoreYonoteCandidate,
    findYonoteContentRoot
  });
})();
