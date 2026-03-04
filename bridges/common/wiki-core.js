(function initBridgeChunk() {
  const bridgeInternals = globalThis.__PHBridgeInternals || (globalThis.__PHBridgeInternals = {});
  Object.assign(globalThis, bridgeInternals);

function matchesWikiUiTerm(value) {
  const normalized = String(value || "").toLowerCase();
  return [
    "avatar",
    "userpic",
    "sidebar",
    "toolbar",
    "control",
    "resource",
    "breadcrumbs",
    "breadcrumb",
    "button",
    "icon"
  ].some(term => normalized.includes(term));
}

function hasWikiUiAttribute(element) {
  if (!isElementNode(element)) {
    return false;
  }

  if (matchesWikiUiTerm(element.id) || matchesWikiUiTerm(element.className)) {
    return true;
  }

  return Array.from(element.attributes || []).some(attribute => {
    return attribute.name.startsWith("data-") && matchesWikiUiTerm(attribute.value);
  });
}

function isWikiExcludedSubtreeRoot(element) {
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

  return hasWikiUiAttribute(element);
}

function isWikiInlineNoiseElement(element) {
  if (!isElementNode(element)) {
    return false;
  }

  const className = String(element.className || "");
  return (
    className.includes("yfm-anchor") ||
    className.includes("HeadingEditor") ||
    className.includes("HeadingClipboardButton") ||
    className.includes("visually-hidden")
  );
}

function hasMeaningfulWikiContent(element) {
  if (!isElementNode(element) || !isVisibleElement(element) || isWikiExcludedSubtreeRoot(element)) {
    return false;
  }

  if (element.querySelector("h1, h2, h3, h4, h5, h6, p, ul, ol, blockquote, pre, hr, img, table")) {
    return true;
  }

  return Boolean(normalizeBlockText(element.textContent || ""));
}

function findWikiContentRoot(documentRef) {
  if (!documentRef) {
    return null;
  }

  const mainRoot = documentRef.querySelector("main.WikiPage-Content");
  if (mainRoot) {
    const nestedPreferredCandidates = [
      ...Array.from(mainRoot.querySelectorAll(".PageDoc.PageDoc_type_wysiwyg")),
      ...Array.from(mainRoot.querySelectorAll(".PageDoc"))
    ].filter(element => hasMeaningfulWikiContent(element));

    if (nestedPreferredCandidates.length) {
      return nestedPreferredCandidates[0];
    }

    if (hasMeaningfulWikiContent(mainRoot)) {
      return mainRoot;
    }
  }

  const candidates = Array.from(documentRef.querySelectorAll(".PageDoc"))
    .filter(element => hasMeaningfulWikiContent(element))
    .sort((left, right) => {
      const leftScore = String(left.className || "").includes("PageDoc_type_wysiwyg") ? 1 : 0;
      const rightScore = String(right.className || "").includes("PageDoc_type_wysiwyg") ? 1 : 0;
      return rightScore - leftScore;
    });

  return candidates[0] || null;
}

function resolveAbsoluteUrl(rawUrl, baseUrl) {
  const normalized = String(rawUrl || "").trim();
  if (!normalized) {
    return "";
  }

  try {
    return new URL(normalized, baseUrl).href;
  } catch {
    return normalized;
  }
}

function resolveWikiImageUrl(element) {
  if (!isElementNode(element)) {
    return "";
  }

  const baseUrl =
    (element.ownerDocument && element.ownerDocument.location && element.ownerDocument.location.href) ||
    (globalThis.location && globalThis.location.href) ||
    "https://wiki.yandex-team.ru/";
  const currentSrc = String(element.currentSrc || "").trim();
  if (currentSrc) {
    return resolveAbsoluteUrl(currentSrc, baseUrl);
  }

  return resolveAbsoluteUrl(element.getAttribute("src") || "", baseUrl);
}

function isWikiMetadataText(text) {
  return /^(?:обновлено(?=$|[\s:])|updated(?=$|[\s:]))/i.test(String(text || "").trim());
}

function isWikiMetadataElement(element) {
  if (!isElementNode(element)) {
    return false;
  }

  const text = normalizeInlineText(element.textContent || "");
  if (!text || !isWikiMetadataText(text)) {
    return false;
  }

  return !element.querySelector("h1, h2, h3, h4, h5, h6, p, ul, ol, blockquote, pre, table, img");
}

function isWikiUiImageElement(element, rootBoundary) {
  if (!isElementNode(element) || getTagName(element) !== "IMG") {
    return false;
  }

  const altText = String(element.getAttribute("alt") || "").toLowerCase();
  if (matchesWikiUiTerm(altText)) {
    return true;
  }

  let current = element;
  while (current && current !== rootBoundary) {
    if (isWikiExcludedSubtreeRoot(current)) {
      return true;
    }

    if (matchesWikiUiTerm(current.className) || matchesWikiUiTerm(current.id)) {
      return true;
    }

    if (isWikiMetadataElement(current)) {
      return true;
    }

    current = current.parentElement;
  }

  return false;
}

  Object.assign(bridgeInternals, {
    matchesWikiUiTerm,
    hasWikiUiAttribute,
    isWikiExcludedSubtreeRoot,
    isWikiInlineNoiseElement,
    hasMeaningfulWikiContent,
    findWikiContentRoot,
    resolveAbsoluteUrl,
    resolveWikiImageUrl,
    isWikiMetadataText,
    isWikiMetadataElement,
    isWikiUiImageElement
  });
  Object.assign(globalThis, {
    matchesWikiUiTerm,
    hasWikiUiAttribute,
    isWikiExcludedSubtreeRoot,
    isWikiInlineNoiseElement,
    hasMeaningfulWikiContent,
    findWikiContentRoot,
    resolveAbsoluteUrl,
    resolveWikiImageUrl,
    isWikiMetadataText,
    isWikiMetadataElement,
    isWikiUiImageElement
  });
})();
