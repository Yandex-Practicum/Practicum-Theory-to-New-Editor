import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { JSDOM } from "jsdom";
import { loadBridgeSharedSource } from "./helpers/load-bridge-shared.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const commonBridgeSource = loadBridgeSharedSource();

function loadShared() {
  const dom = new JSDOM("<!doctype html><main></main>", {
    runScripts: "dangerously",
    url: "https://yonote.ru/doc/score-cv"
  });

  dom.window.eval(commonBridgeSource);
  return dom.window.PracticumHelperBridgeShared;
}

test("prosemirror candidate beats plain metadata payload", () => {
  const shared = loadShared();

  const best = shared.pickBestYonoteStructuredCandidate(
    [
      {
        url: "https://yonote.ru/api/documents.info",
        responseBody: {
          ok: true,
          data: {
            title: "Only metadata"
          }
        }
      },
      {
        url: "https://yonote.ru/api/render/document",
        responseBody: {
          type: "doc",
          content: [
            {
              type: "heading",
              content: [{ type: "text", text: "Visible title" }]
            },
            {
              type: "paragraph",
              content: [{ type: "text", text: "Visible paragraph" }]
            },
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }]
                }
              ]
            }
          ]
        }
      }
    ],
    { sourceSlug: "score-cv" }
  );

  assert.equal(best.schemaKind, "prosemirror-doc");
  assert.equal(best.renderApiPath, "/api/render/document");
});

test("slug match wins between equally structured candidates", () => {
  const shared = loadShared();

  const targetCandidate = {
    url: "https://yonote.ru/api/render/by-slug",
    requestBody: {
      id: "score-cv"
    },
    responseBody: {
      blocks: [
        { type: "heading", text: "Target" },
        { type: "paragraph", text: "Body" },
        { type: "bullet_list", items: [{ type: "list_item", text: "One" }] }
      ]
    }
  };

  const unrelatedCandidate = {
    url: "https://yonote.ru/api/render/by-slug",
    requestBody: {
      id: "other-doc"
    },
    responseBody: {
      blocks: [
        { type: "heading", text: "Other" },
        { type: "paragraph", text: "Body" },
        { type: "bullet_list", items: [{ type: "list_item", text: "Two" }] }
      ]
    }
  };

  const best = shared.pickBestYonoteStructuredCandidate([unrelatedCandidate, targetCandidate], {
    sourceSlug: "score-cv"
  });

  assert.equal(best.documentMatch.requestMentionsSourceSlug, true);
  assert.equal(best.candidateScore > 8, true);
  assert.equal(best.responseBody.blocks[0].text, "Target");
});

test("comment-like endpoints do not become active structured candidates", () => {
  const shared = loadShared();

  const best = shared.pickBestYonoteStructuredCandidate(
    [
      {
        url: "https://yonote.ru/api/comments/list",
        responseBody: {
          blocks: [
            { type: "heading", text: "Looks structured but should be filtered" },
            { type: "paragraph", text: "Comment body" },
            { type: "paragraph", text: "More comment body" }
          ]
        }
      }
    ],
    { sourceSlug: "score-cv" }
  );

  assert.equal(best, null);
});

test("no candidate above threshold returns null", () => {
  const shared = loadShared();

  const best = shared.pickBestYonoteStructuredCandidate(
    [
      {
        url: "https://yonote.ru/api/documents.info",
        responseBody: {
          ok: true,
          data: {
            title: "Only metadata",
            revision: 3
          }
        }
      }
    ],
    { sourceSlug: "score-cv" }
  );

  assert.equal(best, null);
});
