import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { JSDOM } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const commonBridgeSource = readFileSync(path.join(__dirname, "..", "bridges", "common.js"), "utf8");

async function loadFixture(name) {
  const html = await readFile(path.join(__dirname, "fixtures", "wiki", name), "utf8");
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://wiki.yandex-team.ru/tools/practicum-helper/"
  });

  dom.window.innerWidth = 1280;
  dom.window.eval(commonBridgeSource);

  return {
    dom,
    shared: dom.window.PracticumHelperBridgeShared
  };
}

test("wiki extractor prefers the inner PageDoc root and keeps semantic content", async () => {
  const { dom, shared } = await loadFixture("wysiwyg-page.html");
  const root = shared.findWikiContentRoot(dom.window.document);
  assert.ok(root, "wiki content root should be found");
  assert.equal(root.tagName, "DIV");
  assert.ok(root.classList.contains("PageDoc"));
  assert.ok(root.classList.contains("PageDoc_type_wysiwyg"));

  const ast = shared.extractWikiSourceAst(root);
  assert.ok(ast.some(node => node.kind === "heading" && node.level === 1 && node.text === "Как перенести страницу"));
  assert.ok(ast.some(node => node.kind === "unordered_list"));
  assert.ok(ast.some(node => node.kind === "blockquote"));
  assert.ok(ast.some(node => node.kind === "code_block" && node.language === "js"));

  const markdown = shared.compileSourceAstToMarkdown(ast);
  assert.doesNotMatch(markdown, /Обновлено 4 марта 2026/);
  assert.match(markdown, /\[внутренний гайд\]\(https:\/\/wiki\.yandex-team\.ru\/tools\/internal-guide\/\)/);
  assert.match(markdown, /!\[Схема процесса\]\(https:\/\/wiki\.yandex-team\.ru\/\.files\/inline-diagram\.png\)/);
  assert.match(markdown, /\*\*Жирный текст\*\*/);
  assert.match(markdown, /\*курсив\*/);
  assert.match(markdown, /`public\.table_name`/);
  assert.match(markdown, /\*\*важно\*\*/);
  assert.match(markdown, /~~устарело~~/);
  assert.match(markdown, /online\\_store/);
  assert.match(markdown, /tools\\_shop/);
});

test("wiki extractor filters avatar images and builds stable asset descriptors", async () => {
  const { dom, shared } = await loadFixture("wysiwyg-page.html");
  const root = shared.findWikiContentRoot(dom.window.document);
  const assets = shared.extractWikiInlineImageAssets(root);

  assert.equal(assets.length, 1);
  assert.equal(assets[0].id, "https://wiki.yandex-team.ru/.files/inline-diagram.png");
  assert.equal(assets[0].path, "https://wiki.yandex-team.ru/.files/inline-diagram.png");
  assert.equal(assets[0].fileName, "inline-diagram.png");
  assert.equal(assets[0].mimeType, "image/png");
});

test("wiki payload uses body h1 as title and does not duplicate the leading heading", async () => {
  const { dom, shared } = await loadFixture("wysiwyg-page.html");
  const root = shared.findWikiContentRoot(dom.window.document);
  const ast = shared.extractWikiSourceAst(root);
  const assets = shared.extractWikiInlineImageAssets(root);

  const payload = shared.buildWikiStructuredPayload(ast, assets, dom.window.location.href, {
    documentTitle: dom.window.document.title,
    contentRootSelector: "main.WikiPage-Content"
  });

  const titleOccurrences = (payload.markdown.match(/# Как перенести страницу/g) || []).length;

  assert.equal(payload.title, "Как перенести страницу");
  assert.equal(titleOccurrences, 1);
  assert.equal(payload.provider, "wiki");
  assert.equal(payload.providerLabel, "Wiki");
  assert.equal(payload.sourceMode, "Wiki rendered DOM");
  assert.equal(payload.assetCount, 1);
  assert.equal(payload.diagnostics.contentRootSelector, "main.WikiPage-Content");
});
