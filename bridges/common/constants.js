(function initBridgeChunk() {
  const bridgeInternals = globalThis.__PHBridgeInternals || (globalThis.__PHBridgeInternals = {});
  Object.assign(globalThis, bridgeInternals);

  const BRIDGE_BUILD = "3.5.3-background-worker";

  function scopeBridgeName(name) {
    return `${name}::${BRIDGE_BUILD}`;
  }

  const MESSAGE_TYPES = {
    COPY_FROM_YONOTE: scopeBridgeName("PH_COPY_FROM_YONOTE"),
    COPY_FROM_WIKI: scopeBridgeName("PH_COPY_FROM_WIKI"),
    APPEND_TEXT_BLOCKS: scopeBridgeName("PH_APPEND_TEXT_BLOCKS"),
    UPLOAD_THEORY_RESOURCE: scopeBridgeName("PH_UPLOAD_THEORY_RESOURCE")
  };

  const EVENT_TYPES = {
    YONOTE_COPY_REQUEST: scopeBridgeName("PH_YONOTE_COPY_REQUEST"),
    YONOTE_COPY_RESPONSE: scopeBridgeName("PH_YONOTE_COPY_RESPONSE"),
    WIKI_COPY_REQUEST: scopeBridgeName("PH_WIKI_COPY_REQUEST"),
    WIKI_COPY_RESPONSE: scopeBridgeName("PH_WIKI_COPY_RESPONSE"),
    THEORY_APPEND_REQUEST: scopeBridgeName("PH_THEORY_APPEND_REQUEST"),
    THEORY_APPEND_RESPONSE: scopeBridgeName("PH_THEORY_APPEND_RESPONSE"),
    THEORY_UPLOAD_RESOURCE_REQUEST: scopeBridgeName("PH_THEORY_UPLOAD_RESOURCE_REQUEST"),
    THEORY_UPLOAD_RESOURCE_RESPONSE: scopeBridgeName("PH_THEORY_UPLOAD_RESOURCE_RESPONSE")
  };

  const YONOTE_DOC_PATH_RE = /^\/doc\/([^/?#]+)/i;
  const THEORY_PATH_RE = /\/theory\/?$/i;
  const THEORY_GET_TREE_RE = /\/api\/theory_blocks\/([0-9a-f-]+)\/get_tree\/?$/i;
  const EXCLUDED_SUBTREE_TERMS = [
    "comment",
    "sidebar",
    "toolbar",
    "popover",
    "tooltip",
    "drawer",
    "avatar",
    "breadcrumbs"
  ];
  const BLOCK_LIKE_TAGS = new Set([
    "ADDRESS",
    "ARTICLE",
    "ASIDE",
    "BLOCKQUOTE",
    "DD",
    "DIV",
    "DL",
    "DT",
    "FIELDSET",
    "FIGCAPTION",
    "FIGURE",
    "FOOTER",
    "FORM",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HEADER",
    "HR",
    "LI",
    "MAIN",
    "NAV",
    "OL",
    "P",
    "PRE",
    "SECTION",
    "TABLE",
    "TD",
    "TH",
    "UL"
  ]);
  const BLOCK_BREAK_TAGS = new Set([
    "ADDRESS",
    "ARTICLE",
    "BLOCKQUOTE",
    "DIV",
    "FIGCAPTION",
    "FIGURE",
    "FOOTER",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HEADER",
    "HR",
    "LI",
    "P",
    "PRE",
    "SECTION",
    "TABLE",
    "TR"
  ]);
  const RAW_MARKER_RE = /^(?:\[Кнопка\]:\s*.+|Кнопка:\s*.+|⚒️\s*Задание\b.*|Квиз-текстовое поле без проверки)$/i;
  const PSEUDO_BULLET_RE = /^[•–—]\s+/;
  const INIT_REGISTRY_KEY = "__PH_BRIDGE_INIT__";
  const YONOTE_CAPTURE_REGISTRY_KEY = "__PH_YONOTE_NETWORK_CAPTURE__";
  const YONOTE_CAPTURE_LIMIT = 20;
  const YONOTE_CAPTURE_MAX_TEXT_BYTES = 3 * 1024 * 1024;
  const YONOTE_CAPTURE_NOISE_TERMS = [
    "comment",
    "comments",
    "reaction",
    "presence",
    "analytics",
    "track",
    "events",
    "notifications"
  ];
  const STRUCTURED_NODE_TYPE_KEYS = ["type", "kind", "nodeType", "blockType"];
  const STRUCTURED_CHILD_KEYS = ["content", "children", "items", "nodes", "blocks"];
  const STRUCTURED_TEXT_KEYS = ["text", "plainText", "value", "title", "label"];
  const HEADING_TYPE_ALIASES = new Set(["heading", "header", "title", "subtitle"]);
  const PARAGRAPH_TYPE_ALIASES = new Set(["paragraph", "text", "rich_text", "body"]);
  const UNORDERED_LIST_TYPE_ALIASES = new Set(["bullet_list", "bulleted_list", "unordered_list", "list"]);
  const ORDERED_LIST_TYPE_ALIASES = new Set(["ordered_list", "numbered_list"]);
  const LIST_ITEM_TYPE_ALIASES = new Set(["list_item", "item"]);
  const TABLE_TYPE_ALIASES = new Set(["table"]);
  const TABLE_ROW_TYPE_ALIASES = new Set(["table_row", "row"]);
  const TABLE_CELL_TYPE_ALIASES = new Set(["table_cell", "table_header", "cell"]);
  const BLOCKQUOTE_TYPE_ALIASES = new Set(["blockquote", "quote", "callout"]);
  const CODE_BLOCK_TYPE_ALIASES = new Set(["code", "code_block", "preformatted"]);
  const DIVIDER_TYPE_ALIASES = new Set(["divider", "hr", "separator"]);

  function createRequestId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    return `ph-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function parseJsonSafe(value) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  Object.assign(bridgeInternals, {
    BRIDGE_BUILD,
    MESSAGE_TYPES,
    EVENT_TYPES,
    YONOTE_DOC_PATH_RE,
    THEORY_PATH_RE,
    THEORY_GET_TREE_RE,
    EXCLUDED_SUBTREE_TERMS,
    BLOCK_LIKE_TAGS,
    BLOCK_BREAK_TAGS,
    RAW_MARKER_RE,
    PSEUDO_BULLET_RE,
    INIT_REGISTRY_KEY,
    YONOTE_CAPTURE_REGISTRY_KEY,
    YONOTE_CAPTURE_LIMIT,
    YONOTE_CAPTURE_MAX_TEXT_BYTES,
    YONOTE_CAPTURE_NOISE_TERMS,
    STRUCTURED_NODE_TYPE_KEYS,
    STRUCTURED_CHILD_KEYS,
    STRUCTURED_TEXT_KEYS,
    HEADING_TYPE_ALIASES,
    PARAGRAPH_TYPE_ALIASES,
    UNORDERED_LIST_TYPE_ALIASES,
    ORDERED_LIST_TYPE_ALIASES,
    LIST_ITEM_TYPE_ALIASES,
    TABLE_TYPE_ALIASES,
    TABLE_ROW_TYPE_ALIASES,
    TABLE_CELL_TYPE_ALIASES,
    BLOCKQUOTE_TYPE_ALIASES,
    CODE_BLOCK_TYPE_ALIASES,
    DIVIDER_TYPE_ALIASES,
    scopeBridgeName,
    createRequestId,
    parseJsonSafe
  });
  Object.assign(globalThis, bridgeInternals);
})();
