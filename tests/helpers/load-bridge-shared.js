import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BRIDGE_SHARED_SCRIPT_FILES } from "../../shared/bridge-script-files.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..", "..");

export function loadBridgeSharedSource() {
  return BRIDGE_SHARED_SCRIPT_FILES.map(filePath => {
    return readFileSync(path.join(projectRoot, filePath), "utf8");
  }).join("\n");
}

export function injectBridgeShared(windowRef) {
  windowRef.eval(loadBridgeSharedSource());
  return windowRef.PracticumHelperBridgeShared;
}
