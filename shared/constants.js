export const STORAGE_KEY = "copiedMarkdown";
export const TASK_STORAGE_KEY = "activeBackgroundTask";
export const EXT_BUILD = "3.5.4-background-worker";

export function scopeBridgeName(name, build = EXT_BUILD) {
  return `${name}::${build}`;
}

export const MESSAGE_TYPES = {
  COPY_FROM_YONOTE: scopeBridgeName("PH_COPY_FROM_YONOTE"),
  COPY_FROM_WIKI: scopeBridgeName("PH_COPY_FROM_WIKI"),
  APPEND_TEXT_BLOCKS: scopeBridgeName("PH_APPEND_TEXT_BLOCKS"),
  UPLOAD_THEORY_RESOURCE: scopeBridgeName("PH_UPLOAD_THEORY_RESOURCE")
};

export const BACKGROUND_MESSAGE_TYPES = {
  START_COPY_SOURCE: "PH_BG_START_COPY_SOURCE",
  START_INSERT_SOURCE: "PH_BG_START_INSERT_SOURCE",
  GET_ACTIVE_TASK: "PH_BG_GET_ACTIVE_TASK",
  CANCEL_ACTIVE_TASK: "PH_BG_CANCEL_ACTIVE_TASK"
};

export const BRIDGE_KINDS = {
  YONOTE: "yonote",
  WIKI: "wiki",
  THEORY: "theory"
};

export const YONOTE_HOST_RE = /(^|\.)yonote\.ru$/i;
export const YONOTE_DOC_PATH_RE = /^\/doc\/([^/?#]+)/i;
export const WIKI_HOST_RE = /(^|\.)wiki\.yandex-team\.ru$/i;
export const THEORY_HOST_RE = /(?:(^|\.)admin\.praktikum\.yandex-team\.ru|^admin-prestable\.practicum\.yandex-team\.ru)$/i;
export const THEORY_PATH_RE = /\/theory\/?$/i;

export const SOURCE_PROVIDERS = [
  {
    id: "yonote",
    label: "Yonote",
    bridgeKind: BRIDGE_KINDS.YONOTE,
    copyMessageType: MESSAGE_TYPES.COPY_FROM_YONOTE,
    canHandle(rawUrl) {
      try {
        const url = new URL(rawUrl);
        return YONOTE_HOST_RE.test(url.hostname) && YONOTE_DOC_PATH_RE.test(url.pathname);
      } catch {
        return false;
      }
    }
  },
  {
    id: "wiki",
    label: "Wiki",
    bridgeKind: BRIDGE_KINDS.WIKI,
    copyMessageType: MESSAGE_TYPES.COPY_FROM_WIKI,
    canHandle(rawUrl) {
      try {
        const url = new URL(rawUrl);
        return WIKI_HOST_RE.test(url.hostname);
      } catch {
        return false;
      }
    }
  }
];

export function getSourceProvider(rawUrl) {
  return SOURCE_PROVIDERS.find(provider => provider.canHandle(rawUrl)) || null;
}

export function isTheoryUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return THEORY_HOST_RE.test(url.hostname) && THEORY_PATH_RE.test(url.pathname);
  } catch {
    return false;
  }
}
