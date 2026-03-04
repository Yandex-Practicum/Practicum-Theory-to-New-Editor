import assert from "node:assert/strict";
import test from "node:test";

import { getSourceProvider } from "../shared/constants.js";

test("source provider detection supports yonote and wiki hosts", () => {
  assert.equal(getSourceProvider("https://practicum.yonote.ru/doc/test-doc")?.id, "yonote");
  assert.equal(getSourceProvider("https://wiki.yandex-team.ru/tools/practicum-helper/")?.id, "wiki");
  assert.equal(getSourceProvider("https://docs.wiki.yandex-team.ru/tools/practicum-helper/")?.id, "wiki");
});

test("source provider detection rejects unsupported urls", () => {
  assert.equal(getSourceProvider("https://yonote.ru/collections/test")?.id, undefined);
  assert.equal(getSourceProvider("https://example.com/")?.id, undefined);
  assert.equal(getSourceProvider("not-a-url")?.id, undefined);
});
