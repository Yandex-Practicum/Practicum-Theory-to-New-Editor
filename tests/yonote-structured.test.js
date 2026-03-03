import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { JSDOM } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const commonBridgeSource = readFileSync(path.join(__dirname, "..", "bridges", "common.js"), "utf8");

async function loadFixture(name) {
  const html = await readFile(path.join(__dirname, "fixtures", "yonote", name), "utf8");
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://yonote.ru/doc/test-lesson"
  });

  dom.window.innerWidth = 1280;
  dom.window.eval(commonBridgeSource);

  return {
    dom,
    shared: dom.window.PracticumHelperBridgeShared
  };
}

test("structured extractor keeps heading and paragraph order", async () => {
  const { dom, shared } = await loadFixture("heading-paragraph.html");
  const root = shared.findYonoteContentRoot(dom.window.document);
  assert.ok(root, "content root should be found");

  const ast = shared.extractYonoteSourceAst(root);
  assert.equal(ast[0].kind, "heading");
  assert.equal(ast[0].text, "Как отличить сильное резюме");
  assert.equal(ast[1].kind, "paragraph");
  assert.match(ast[1].text, /контекст, конкретный вклад/i);
});

test("structured extractor falls back to ProseMirror when main is absent", async () => {
  const { dom, shared } = await loadFixture("prosemirror-no-main.html");
  const root = shared.findYonoteContentRoot(dom.window.document);
  assert.ok(root, "ProseMirror root should be found when main is absent");
  assert.equal(root.className, "ProseMirror");

  const ast = shared.extractYonoteSourceAst(root);
  assert.ok(ast.length >= 4);
  assert.ok(ast.some(node => node.kind === "heading" && node.text === "Как отличить сильное резюме от слабого"));
  assert.ok(ast.some(node => node.kind === "unordered_list"));
  assert.ok(ast.some(node => node.kind === "table"));
});

test("plain paragraphs stay paragraphs and inline links survive in markdown", async () => {
  const { dom, shared } = await loadFixture("paragraph-link.html");
  const root = shared.findYonoteContentRoot(dom.window.document);
  const ast = shared.extractYonoteSourceAst(root);

  assert.equal(ast[0].kind, "paragraph");
  assert.equal(ast[0].text, "Для начала разберёмся в терминах.");
  assert.equal(ast[1].kind, "paragraph");
  assert.match(ast[1].text, /\[пример типичного резюме\]\(https:\/\/example\.com\/resume\)/);

  const markdown = shared.compileSourceAstToMarkdown(ast);
  assert.doesNotMatch(markdown, /^## Для начала разберёмся в терминах\./m);
  assert.match(markdown, /\[пример типичного резюме\]\(https:\/\/example\.com\/resume\)/);
});

test("structured extractor serializes lists, blockquotes, tables and code blocks", async () => {
  const { dom, shared } = await loadFixture("list-table-code.html");
  const root = shared.findYonoteContentRoot(dom.window.document);
  const ast = shared.extractYonoteSourceAst(root);

  assert.ok(ast.some(node => node.kind === "unordered_list"));
  assert.ok(ast.some(node => node.kind === "ordered_list"));
  assert.ok(ast.some(node => node.kind === "blockquote"));
  assert.ok(ast.some(node => node.kind === "table"));
  assert.ok(ast.some(node => node.kind === "code_block" && node.language === "js"));

  const markdown = shared.compileSourceAstToMarkdown(ast);
  assert.match(markdown, /\| Критерий \| Хороший пример \| Плохой пример \|/);
  assert.match(markdown, /\n> Формулировка должна быть проверяемой\./);
  assert.match(markdown, /```js\nconst score = "strong";\n```/);
});

test("raw markers survive while comment noise is excluded", async () => {
  const { dom, shared } = await loadFixture("raw-noise.html");
  const root = shared.findYonoteContentRoot(dom.window.document);
  const ast = shared.extractYonoteSourceAst(root);

  const rawMarkers = ast.filter(node => node.kind === "raw_marker").map(node => node.text);
  assert.ok(rawMarkers.includes("[Кнопка]: Сохранить"));
  assert.ok(rawMarkers.includes("Квиз-текстовое поле без проверки"));

  const serialized = shared.compileSourceAstToMarkdown(ast);
  assert.doesNotMatch(serialized, /Комментарий модератора/);
});

test("structured payload drops duplicate leading H1 matching metadata title", async () => {
  const { dom, shared } = await loadFixture("duplicate-title.html");
  const root = shared.findYonoteContentRoot(dom.window.document);
  const ast = shared.extractYonoteSourceAst(root);

  const payload = shared.buildYonoteStructuredPayload(
    ast,
    {
      title: "Повторяющийся заголовок",
      id: "doc-1",
      collectionId: "collection-1",
      revision: 7
    },
    "https://yonote.ru/doc/test-lesson",
    "test-lesson"
  );

  const headingOccurrences = (payload.markdown.match(/# Повторяющийся заголовок/g) || []).length;
  assert.equal(headingOccurrences, 1);
  assert.equal(payload.sourceMode, "Rendered DOM fallback");
  assert.equal(payload.blockCount, ast.length - 1);
  assert.equal(payload.diagnostics.captureStatus, "missing");
  assert.match(payload.markdown, /## Следующий раздел/);
});
