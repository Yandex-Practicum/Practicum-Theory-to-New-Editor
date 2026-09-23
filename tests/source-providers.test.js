import assert from "node:assert/strict";
import test from "node:test";

import { getSourceProvider, isTheoryUrl } from "../shared/constants.js";

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

test("theory detection supports migrated prestable and existing admin hosts", () => {
  for (const host of [
    "admin-prestable.practicum.yandex-team.ru",
    "admin.praktikum.yandex-team.ru",
    "prestable.admin.praktikum.yandex-team.ru"
  ]) {
    assert.equal(isTheoryUrl(`https://${host}/course/lesson/theory/`), true, host);
    assert.equal(isTheoryUrl(`https://${host}/course/lesson/theory?tab=editor#block`), true, host);
    assert.equal(isTheoryUrl(`https://${host}/course/lesson/settings/`), false, host);
  }
});

test("theory detection rejects unrelated hosts and lookalike prestable domains", () => {
  for (const url of [
    "https://practicum.yandex-team.ru/course/lesson/theory/",
    "https://evil.admin-prestable.practicum.yandex-team.ru/course/lesson/theory/",
    "https://admin-prestable.practicum.yandex-team.ru.example.com/course/lesson/theory/",
    "https://fakeadmin-prestable.practicum.yandex-team.ru/course/lesson/theory/",
    "not-a-url"
  ]) {
    assert.equal(isTheoryUrl(url), false, url);
  }
});
