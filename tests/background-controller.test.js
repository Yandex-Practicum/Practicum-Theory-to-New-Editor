import assert from "node:assert/strict";
import test from "node:test";

import { createBackgroundController } from "../shared/background-controller.js";
import { BACKGROUND_MESSAGE_TYPES } from "../shared/constants.js";

function createHarness(overrides = {}) {
  const state = {
    task: null,
    source: overrides.initialSource || null,
    scheduled: [],
    timeoutCallback: null,
    timeoutDelay: null,
    reloadedTabs: []
  };

  const controller = createBackgroundController({
    loadActiveTask: async () => state.task,
    saveActiveTask: async task => {
      state.task = task;
      return task;
    },
    loadStoredSource: async () => state.source,
    saveStoredSource: async payload => {
      state.source = payload;
      return payload;
    },
    getActiveTab: overrides.getActiveTab || (async () => ({ id: 12, url: "https://practicum.yonote.ru/doc/test-doc" })),
    sendBridgeMessage:
      overrides.sendBridgeMessage ||
      (async () => ({
        success: true,
        bridgeVersion: "3.3.1-background-worker",
        nativeExportContext: {
          title: "Doc title",
          sourceUrl: "https://practicum.yonote.ru/doc/test-doc",
          sourceSlug: "test-doc",
          documentId: "doc-id",
          collectionId: "collection-id",
          revision: 3,
          baseOrigin: "https://practicum.yonote.ru",
          operationId: "operation-id"
        }
      })),
    requestNativeExport:
      overrides.requestNativeExport ||
      (async () => ({
        markdown: "Body"
      })),
    reloadTab:
      overrides.reloadTab ||
      (async tabId => {
        state.reloadedTabs.push(tabId);
      }),
    setTimeoutFn:
      overrides.setTimeoutFn ||
      ((callback, delay) => {
        state.timeoutCallback = callback;
        state.timeoutDelay = delay;
        return "timeout-handle";
      }),
    clearTimeoutFn:
      overrides.clearTimeoutFn ||
      (() => {}),
    scheduleTask:
      overrides.scheduleTask ||
      (callback => {
        state.scheduled.push(callback);
      }),
    now:
      overrides.now ||
      (() => new Date("2026-03-03T10:00:00.000Z"))
  });

  return {
    controller,
    state
  };
}

async function runScheduledTasks(state) {
  while (state.scheduled.length) {
    const task = state.scheduled.shift();
    task();
    for (let step = 0; step < 80; step += 1) {
      await Promise.resolve();
    }
  }
}

test("START_COPY_SOURCE returns immediately and persists a starting task", async () => {
  const { controller, state } = createHarness();

  const response = await controller.handleRuntimeMessage({
    type: BACKGROUND_MESSAGE_TYPES.START_COPY_SOURCE
  });

  assert.equal(response.accepted, true);
  assert.equal(state.task.kind, "copy_source");
  assert.equal(state.task.stage, "starting");
  assert.equal(state.scheduled.length, 1);
});

test("copy flow uses native-export context and saves payload from the background runner", async () => {
  let preferredMode = "";
  let receivedOperationId = "";

  const { controller, state } = createHarness({
    sendBridgeMessage: async ({ message }) => {
      preferredMode = message.preferredMode;
      return {
        success: true,
        bridgeVersion: "3.3.1-background-worker",
        diagnostics: {
          renderApiPath: "/api/documents.export"
        },
        nativeExportContext: {
          title: "Doc title",
          sourceUrl: "https://practicum.yonote.ru/doc/test-doc",
          sourceSlug: "test-doc",
          documentId: "doc-id",
          collectionId: "collection-id",
          revision: 3,
          baseOrigin: "https://practicum.yonote.ru",
          operationId: "operation-id"
        }
      };
    },
    requestNativeExport: async context => {
      receivedOperationId = context.operationId;
      return {
        markdown: "Paragraph"
      };
    }
  });

  await controller.handleRuntimeMessage({
    type: BACKGROUND_MESSAGE_TYPES.START_COPY_SOURCE
  });
  await runScheduledTasks(state);

  assert.equal(preferredMode, "native-export-context");
  assert.equal(receivedOperationId, "operation-id");
  assert.equal(state.task.stage, "success");
  assert.equal(state.source.markdown, "# Doc title\n\nParagraph");
  assert.equal(state.source.sourceMode, "Yonote native export");
});

test("a second task is rejected while one background task is active", async () => {
  const { controller } = createHarness();

  const first = await controller.handleRuntimeMessage({
    type: BACKGROUND_MESSAGE_TYPES.START_COPY_SOURCE
  });
  assert.equal(first.accepted, true);

  const second = await controller.handleRuntimeMessage({
    type: BACKGROUND_MESSAGE_TYPES.START_INSERT_SOURCE
  });

  assert.equal(second.accepted, false);
  assert.equal(second.task.stage, "starting");
});

test("GET_ACTIVE_TASK returns the persisted task snapshot", async () => {
  const { controller } = createHarness();

  await controller.handleRuntimeMessage({
    type: BACKGROUND_MESSAGE_TYPES.START_COPY_SOURCE
  });

  const response = await controller.handleRuntimeMessage({
    type: BACKGROUND_MESSAGE_TYPES.GET_ACTIVE_TASK
  });

  assert.equal(response.task.kind, "copy_source");
  assert.equal(response.task.stage, "starting");
});

test("insert flow moves into reloading and completes from tabs.onUpdated", async () => {
  const { controller, state } = createHarness({
    initialSource: {
      markdown: "# Title\n\nText"
    },
    getActiveTab: async () => ({
      id: 77,
      url: "https://admin.praktikum.yandex-team.ru/course/lesson/theory/"
    }),
    sendBridgeMessage: async ({ kind }) => {
      assert.equal(kind, "theory");
      return {
        success: true,
        appendedCount: 4,
        tableCount: 1
      };
    }
  });

  const response = await controller.handleRuntimeMessage({
    type: BACKGROUND_MESSAGE_TYPES.START_INSERT_SOURCE
  });

  assert.equal(response.accepted, true);
  assert.equal(state.task.stage, "starting");

  await runScheduledTasks(state);

  assert.equal(state.task.stage, "reloading");
  assert.equal(state.task.result.appendedCount, 4);
  assert.equal(state.timeoutDelay, 15000);
  assert.deepEqual(state.reloadedTabs, [77]);

  await controller.handleTabUpdated(77, { status: "complete" });

  assert.equal(state.task.stage, "success");
  assert.equal(state.task.message, "Страница обновлена. Проверьте результат.");
  assert.equal(state.task.result.reloadTimedOut, false);
});

test("insert reload timeout still ends with success and a warning-style message", async () => {
  const { controller, state } = createHarness({
    initialSource: {
      markdown: "# Title\n\nText"
    },
    getActiveTab: async () => ({
      id: 88,
      url: "https://admin.praktikum.yandex-team.ru/course/lesson/theory/"
    }),
    sendBridgeMessage: async () => ({
      success: true,
      appendedCount: 2,
      tableCount: 0
    })
  });

  await controller.handleRuntimeMessage({
    type: BACKGROUND_MESSAGE_TYPES.START_INSERT_SOURCE
  });
  await runScheduledTasks(state);

  assert.equal(typeof state.timeoutCallback, "function");

  state.timeoutCallback();
  for (let step = 0; step < 80; step += 1) {
    await Promise.resolve();
  }

  assert.equal(state.task.stage, "success");
  assert.match(state.task.message, /вручную/i);
  assert.equal(state.task.result.reloadTimedOut, true);
});
