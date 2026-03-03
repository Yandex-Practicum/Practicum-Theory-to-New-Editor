import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { JSDOM } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const commonBridgeSource = readFileSync(path.join(__dirname, "..", "bridges", "common.js"), "utf8");

function loadShared() {
  const dom = new JSDOM("<!doctype html><main></main>", {
    runScripts: "dangerously",
    url: "https://yonote.ru/doc/score-cv"
  });

  dom.window.eval(commonBridgeSource);
  return dom.window.PracticumHelperBridgeShared;
}

async function loadJsonFixture(name) {
  const content = await readFile(path.join(__dirname, "fixtures", "yonote", "render-api", name), "utf8");
  return JSON.parse(content);
}

test("prosemirror render payload becomes structured AST and markdown", async () => {
  const shared = loadShared();
  const payload = await loadJsonFixture("prosemirror-doc.json");

  const ast = shared.extractYonoteSourceAstFromStructuredPayload({
    schemaKind: "prosemirror-doc",
    responseBody: payload
  });

  assert.ok(ast.some(node => node.kind === "heading"));
  assert.ok(ast.some(node => node.kind === "unordered_list"));
  assert.ok(ast.some(node => node.kind === "table"));
  assert.ok(ast.some(node => node.kind === "code_block" && node.language === "js"));

  const markdown = shared.compileSourceAstToMarkdown(ast);
  assert.match(markdown, /## Как отличить сильное резюме/);
  assert.match(markdown, /\| Критерий \| Комментарий \|/);
  assert.match(markdown, /```js\nconst score = 42;\n```/);
});

test("typed-block render payload becomes structured AST and markdown", async () => {
  const shared = loadShared();
  const payload = await loadJsonFixture("typed-blocks.json");

  const ast = shared.extractYonoteSourceAstFromStructuredPayload({
    schemaKind: "typed-block-map",
    responseBody: payload
  });

  assert.ok(ast.some(node => node.kind === "heading"));
  assert.ok(ast.some(node => node.kind === "unordered_list"));
  assert.ok(ast.some(node => node.kind === "table"));

  const markdown = shared.compileSourceAstToMarkdown(ast);
  assert.match(markdown, /## Содержание портфолио/);
  assert.match(markdown, /- Онлайн-формат/);
  assert.match(markdown, /\| Критерий \| Хороший пример \|/);
});

test("unknown typed blocks degrade into paragraphs and raw markers", async () => {
  const shared = loadShared();
  const payload = await loadJsonFixture("unknown-typed.json");

  const ast = shared.extractYonoteSourceAstFromStructuredPayload({
    schemaKind: "typed-block-array",
    responseBody: payload
  });

  assert.ok(ast.some(node => node.kind === "raw_marker" && node.text === "[Кнопка]: Идём дальше"));
  assert.ok(ast.some(node => node.kind === "paragraph"));
  assert.ok(ast.some(node => node.kind === "raw_marker" && node.text === "Квиз-текстовое поле без проверки"));
});

test("pipeline prefers render API, then DOM, then text fallback", async () => {
  const shared = loadShared();
  const renderPayload = await loadJsonFixture("typed-blocks.json");

  const renderResult = shared.buildYonoteSourceResult({
    captureRegistry: [
      {
        url: "https://yonote.ru/api/render/doc",
        requestBody: { id: "score-cv" },
        responseBody: renderPayload
      }
    ],
    domAst: [],
    documentData: {
      title: "Скоринг CV",
      id: "doc-1",
      collectionId: "c-1",
      revision: 5,
      text: "fallback text"
    },
    sourceUrl: "https://yonote.ru/doc/score-cv",
    sourceSlug: "score-cv"
  });

  assert.equal(renderResult.payload.sourceMode, "Yonote render API");
  assert.equal(renderResult.diagnostics.captureStatus, "captured");

  const domResult = shared.buildYonoteSourceResult({
    captureRegistry: [
      {
        url: "https://yonote.ru/api/render/unknown",
        requestBody: { id: "score-cv" },
        responseBody: {
          items: [
            { type: "table_widget", label: "preview only" },
            { note: "unsupported" },
            { extra: "unsupported" }
          ]
        }
      }
    ],
    domAst: [
      { kind: "heading", level: 2, text: "DOM heading" },
      { kind: "paragraph", text: "DOM paragraph" },
      { kind: "unordered_list", items: ["DOM item"] }
    ],
    documentData: {
      title: "Скоринг CV",
      id: "doc-1",
      collectionId: "c-1",
      revision: 5,
      text: "fallback text"
    },
    sourceUrl: "https://yonote.ru/doc/score-cv",
    sourceSlug: "score-cv"
  });

  assert.equal(domResult.payload.sourceMode, "Rendered DOM fallback");
  assert.equal(domResult.diagnostics.fallbackReason, "unsupported-render-schema");

  const textResult = shared.buildYonoteSourceResult({
    captureRegistry: [],
    domAst: [{ kind: "paragraph", text: "too thin" }],
    documentData: {
      title: "Скоринг CV",
      id: "doc-1",
      collectionId: "c-1",
      revision: 5,
      text: "Plain fallback body"
    },
    sourceUrl: "https://yonote.ru/doc/score-cv",
    sourceSlug: "score-cv"
  });

  assert.equal(textResult.payload.sourceMode, "API text fallback");
  assert.equal(textResult.diagnostics.fallbackReason, "no-captured-render-payload");
});
