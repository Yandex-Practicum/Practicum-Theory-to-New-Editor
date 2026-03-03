export const STORAGE_KEY = "copiedMarkdown";
export const TASK_STORAGE_KEY = "activeBackgroundTask";
export const EXT_BUILD = "3.3.2-background-worker";

export function scopeBridgeName(name, build = EXT_BUILD) {
  return `${name}::${build}`;
}

export const MESSAGE_TYPES = {
  COPY_FROM_YONOTE: scopeBridgeName("PH_COPY_FROM_YONOTE"),
  APPEND_TEXT_BLOCKS: scopeBridgeName("PH_APPEND_TEXT_BLOCKS")
};

export const BACKGROUND_MESSAGE_TYPES = {
  START_COPY_SOURCE: "PH_BG_START_COPY_SOURCE",
  START_INSERT_SOURCE: "PH_BG_START_INSERT_SOURCE",
  GET_ACTIVE_TASK: "PH_BG_GET_ACTIVE_TASK"
};

export const BRIDGE_KINDS = {
  YONOTE: "yonote",
  THEORY: "theory"
};

export const YONOTE_HOST_RE = /(^|\.)yonote\.ru$/i;
export const YONOTE_DOC_PATH_RE = /^\/doc\/([^/?#]+)/i;
export const THEORY_HOST_RE = /(^|\.)admin\.praktikum\.yandex-team\.ru$/i;
export const THEORY_PATH_RE = /\/theory\/?$/i;

export const SOURCE_PROVIDERS = [
  {
    id: "yonote",
    label: "Yonote",
    copyMessageType: MESSAGE_TYPES.COPY_FROM_YONOTE,
    canHandle(rawUrl) {
      try {
        const url = new URL(rawUrl);
        return YONOTE_HOST_RE.test(url.hostname) && YONOTE_DOC_PATH_RE.test(url.pathname);
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
