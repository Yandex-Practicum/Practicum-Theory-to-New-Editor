import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { JSDOM } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const commonBridgeSource = readFileSync(path.join(__dirname, "..", "bridges", "common.js"), "utf8");

function loadShared() {
  const dom = new JSDOM("<!doctype html><main></main>", {
    runScripts: "dangerously",
    url: "https://admin.praktikum.yandex-team.ru/course/lesson/theory/"
  });

  dom.window.eval(commonBridgeSource);
  return dom.window.PracticumHelperBridgeShared;
}

test("compileTheoryBlocks upgrades absolute markdown image and following italic caption into image block", () => {
  const shared = loadShared();

  const blocks = shared.compileTheoryBlocks(
    "![ALT](https://pictures.s3.yandex.net/resources/picture.png)\n\n*ОПИСАНИЕ*"
  );

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, "image");
  assert.equal(blocks[0].alt, "ALT");
  assert.equal(blocks[0].caption, "ОПИСАНИЕ");
  assert.equal(blocks[0].meta.blockType, "Image");
});

test("buildTheoryBlockPayload serializes image captions in ui-compatible markdown format", () => {
  const shared = loadShared();

  const payload = shared.buildTheoryBlockPayload(
    {
      kind: "image",
      url: "https://pictures.s3.yandex.net/resources/picture.png",
      alt: "ALT",
      caption: "ОПИСАНИЕ",
      meta: {
        blockType: "Image"
      }
    },
    {
      treeId: "tree-id",
      rootBlockId: "root-id"
    }
  );

  assert.equal(payload.type, "Markdown");
  assert.equal(payload.content.url, "https://pictures.s3.yandex.net/resources/picture.png");
  assert.equal(payload.content.alt, "ALT");
  assert.equal(payload.content.caption, "ОПИСАНИЕ");
  assert.equal(
    payload.content.markdown,
    "![ALT](https://pictures.s3.yandex.net/resources/picture.png)*ОПИСАНИЕ*"
  );
  assert.equal(payload.meta.blockType, "Image");
});
