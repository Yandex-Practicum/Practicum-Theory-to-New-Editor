export const BRIDGE_SHARED_SCRIPT_FILES = [
  "bridges/common/constants.js",
  "bridges/common/bootstrap.js",
  "bridges/common/archive.js",
  "bridges/common/dom-core.js",
  "bridges/common/yonote-dom-text.js",
  "bridges/common/yonote-dom-ast.js",
  "bridges/common/source-markdown.js",
  "bridges/common/wiki-core.js",
  "bridges/common/wiki-inline.js",
  "bridges/common/wiki-ast.js",
  "bridges/common/wiki-assets.js",
  "bridges/common/yonote-capture-core.js",
  "bridges/common/yonote-capture-scoring.js",
  "bridges/common/yonote-structured-helpers.js",
  "bridges/common/yonote-structured-prosemirror.js",
  "bridges/common/yonote-structured-typed.js",
  "bridges/common/yonote-source.js",
  "bridges/common/theory-markdown-core.js",
  "bridges/common/theory-markdown-compile.js",
  "bridges/common/theory-payload.js",
  "bridges/common.js"
];

export const BRIDGE_SCRIPT_FILES = {
  yonote: {
    main: [...BRIDGE_SHARED_SCRIPT_FILES, "bridges/yonote-main.js"],
    isolated: [...BRIDGE_SHARED_SCRIPT_FILES, "bridges/yonote-relay.js"]
  },
  wiki: {
    main: [...BRIDGE_SHARED_SCRIPT_FILES, "bridges/wiki-main.js"],
    isolated: [...BRIDGE_SHARED_SCRIPT_FILES, "bridges/wiki-relay.js"]
  },
  theory: {
    main: [...BRIDGE_SHARED_SCRIPT_FILES, "bridges/theory-main.js"],
    isolated: [...BRIDGE_SHARED_SCRIPT_FILES, "bridges/theory-relay.js"]
  }
};

export function getBridgeScriptFiles(kind, world) {
  const bucket = BRIDGE_SCRIPT_FILES[String(kind || "")];
  if (!bucket) {
    return [];
  }

  if (String(world || "").toUpperCase() === "MAIN") {
    return bucket.main.slice();
  }

  if (String(world || "").toUpperCase() === "ISOLATED") {
    return bucket.isolated.slice();
  }

  return [];
}
