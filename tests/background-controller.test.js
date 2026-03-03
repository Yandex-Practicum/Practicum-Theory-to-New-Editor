import assert from "node:assert/strict";
import test from "node:test";

import { createBackgroundController } from "../shared/background-controller.js";
import { BACKGROUND_MESSAGE_TYPES, MESSAGE_TYPES } from "../shared/constants.js";

function createHarness(overrides = {}) {
  const state = {
    task: null,
    source: overrides.initialSource || null,
    sourceAssets: overrides.initialSourceAssets || new Map(),
    scheduled: [],
    timeoutCallback: null,
    timeoutDelay: null,
    reloadedTabs: [],
    savedAssetWrites: [],
    clearedSourceAssets: 0
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
    replaceSourceAssets:
      overrides.replaceSourceAssets ||
      (async (sourceStorageId, assets) => {
        state.savedAssetWrites.push({
          sourceStorageId,
          assets
        });
        state.sourceAssets.clear();
        (Array.isArray(assets) ? assets : []).forEach(asset => {
          state.sourceAssets.set(`${sourceStorageId}:${asset.id}`, asset.bytes);
        });
      }),
    loadSourceAssetBytes:
      overrides.loadSourceAssetBytes ||
      (async (sourceStorageId, assetId) => state.sourceAssets.get(`${sourceStorageId}:${assetId}`) || null),
    clearSourceAssets:
      overrides.clearSourceAssets ||
      (async () => {
        state.clearedSourceAssets += 1;
        state.sourceAssets.clear();
      }),
    getActiveTab: overrides.getActiveTab || (async () => ({ id: 12, url: "https://practicum.yonote.ru/doc/test-doc" })),
    sendBridgeMessage:
      overrides.sendBridgeMessage ||
      (async () => ({
        success: true,
        bridgeVersion: "3.4.1-background-worker",
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
        bridgeVersion: "3.4.1-background-worker",
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

test("copy flow stores referenced image assets from native export", async () => {
  const { controller, state } = createHarness({
    requestNativeExport: async () => ({
      markdown: "![Alt](assets/picture.png)",
      entries: [
        {
          name: "lesson.md",
          data: new Uint8Array([35, 32, 84])
        },
        {
          name: "assets/picture.png",
          data: new Uint8Array([1, 2, 3, 4])
        },
        {
          name: "assets/unused.jpg",
          data: new Uint8Array([5, 6, 7])
        }
      ]
    })
  });

  await controller.handleRuntimeMessage({
    type: BACKGROUND_MESSAGE_TYPES.START_COPY_SOURCE
  });
  await runScheduledTasks(state);

  assert.equal(state.task.stage, "success");
  assert.equal(state.source.assetCount, 1);
  assert.equal(state.source.assets[0].id, "assets/picture.png");
  assert.equal(state.savedAssetWrites.length, 1);
  assert.equal(state.savedAssetWrites[0].assets.length, 1);
});

test("copy flow stores image assets when markdown image includes a title attribute", async () => {
  const { controller, state } = createHarness({
    requestNativeExport: async () => ({
      markdown:
        '![ALT](uploads/doc-1/image.png "Пример стандартного резюме|||aspect=1")',
      entries: [
        {
          name: "lesson.md",
          data: new Uint8Array([35, 32, 84])
        },
        {
          name: "uploads/doc-1/image.png",
          data: new Uint8Array([1, 2, 3, 4])
        }
      ]
    })
  });

  await controller.handleRuntimeMessage({
    type: BACKGROUND_MESSAGE_TYPES.START_COPY_SOURCE
  });
  await runScheduledTasks(state);

  assert.equal(state.task.stage, "success");
  assert.equal(state.source.assetCount, 1);
  assert.equal(state.source.assets[0].id, "uploads/doc-1/image.png");
});

test("copy flow humanizes message-channel-closed bridge errors", async () => {
  const { controller, state } = createHarness({
    sendBridgeMessage: async () => {
      throw new Error(
        "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received"
      );
    }
  });

  await controller.handleRuntimeMessage({
    type: BACKGROUND_MESSAGE_TYPES.START_COPY_SOURCE
  });
  await runScheduledTasks(state);

  assert.equal(state.task.stage, "error");
  assert.equal(state.task.message, "Страница была закрыта или перезагружена до ответа. Повторите действие.");
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

test("CANCEL_ACTIVE_TASK interrupts a queued task and keeps it cancelled", async () => {
  const { controller, state } = createHarness();

  const started = await controller.handleRuntimeMessage({
    type: BACKGROUND_MESSAGE_TYPES.START_COPY_SOURCE
  });
  assert.equal(started.accepted, true);

  const cancelled = await controller.handleRuntimeMessage({
    type: BACKGROUND_MESSAGE_TYPES.CANCEL_ACTIVE_TASK
  });

  assert.equal(cancelled.cancelled, true);
  assert.equal(state.task.stage, "error");
  assert.equal(state.task.message, "Задача прервана.");

  await runScheduledTasks(state);

  assert.equal(state.task.stage, "error");
  assert.equal(state.source, null);
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

test("GET_ACTIVE_TASK recovers stale starting task but keeps a recent running task", async () => {
  const staleStarting = {
    id: "stale-starting",
    kind: "copy_source",
    stage: "starting",
    message: "Собираю source в фоне...",
    startedAt: "2026-03-03T10:00:00.000Z",
    updatedAt: "2026-03-03T10:00:00.000Z"
  };

  const staleStartingHarness = createHarness({
    now: () => new Date("2026-03-03T10:00:16.000Z")
  });
  staleStartingHarness.state.task = staleStarting;

  const recovered = await staleStartingHarness.controller.handleRuntimeMessage({
    type: BACKGROUND_MESSAGE_TYPES.GET_ACTIVE_TASK
  });

  assert.equal(recovered.task.stage, "error");
  assert.equal(recovered.task.message, "Фоновая задача прервалась. Повторите действие.");

  const runningHarness = createHarness({
    now: () => new Date("2026-03-03T10:00:16.000Z")
  });
  runningHarness.state.task = {
    id: "running-insert",
    kind: "insert_source",
    stage: "running",
    message: "Отправляю markdown в bridge теории...",
    startedAt: "2026-03-03T10:00:00.000Z",
    updatedAt: "2026-03-03T10:00:00.000Z"
  };

  const stillRunning = await runningHarness.controller.handleRuntimeMessage({
    type: BACKGROUND_MESSAGE_TYPES.GET_ACTIVE_TASK
  });

  assert.equal(stillRunning.task.stage, "running");
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

test("insert flow uploads stored images and rewrites markdown before append", async () => {
  let appendMarkdown = "";
  let uploadRequests = 0;

  const { controller, state } = createHarness({
    initialSource: {
      markdown: "![ALT](assets/picture.png)\n\n*ОПИСАНИЕ*",
      sourceStorageId: "source-1",
      assetBasePath: "",
      assets: [
        {
          id: "assets/picture.png",
          path: "assets/picture.png",
          fileName: "picture.png",
          mimeType: "image/png",
          byteLength: 3
        }
      ]
    },
    initialSourceAssets: new Map([["source-1:assets/picture.png", new Uint8Array([1, 2, 3]).buffer]]),
    getActiveTab: async () => ({
      id: 77,
      url: "https://admin.praktikum.yandex-team.ru/course/lesson/theory/"
    }),
    sendBridgeMessage: async ({ message }) => {
      if (message.type === MESSAGE_TYPES.UPLOAD_THEORY_RESOURCE) {
        uploadRequests += 1;
        assert.equal(message.fileName, "picture.png");
        assert.equal(message.mimeType, "image/png");
        assert.equal(message.bytesBase64, "AQID");
        return {
          success: true,
          fileUrl: "https://pictures.s3.yandex.net/resources/picture_1.png"
        };
      }

      if (message.type === MESSAGE_TYPES.APPEND_TEXT_BLOCKS) {
        appendMarkdown = message.markdown;
        return {
          success: true,
          appendedCount: 1,
          tableCount: 0,
          imageCount: 1
        };
      }

      throw new Error(`Unexpected message type: ${message.type}`);
    }
  });

  await controller.handleRuntimeMessage({
    type: BACKGROUND_MESSAGE_TYPES.START_INSERT_SOURCE
  });
  await runScheduledTasks(state);

  assert.equal(uploadRequests, 1);
  assert.match(appendMarkdown, /https:\/\/pictures\.s3\.yandex\.net\/resources\/picture_1\.png/);
  assert.equal(state.task.stage, "reloading");
  assert.equal(state.task.result.imageCount, 1);
  assert.equal(state.task.result.uploadedImageCount, 1);
  assert.equal(state.task.result.skippedImageCount, 0);
  assert.equal(state.clearedSourceAssets, 1);
  assert.equal(state.source.assetCount, 0);
});

test("insert flow preserves markdown image title metadata when rewriting uploaded urls", async () => {
  let appendMarkdown = "";

  const { controller, state } = createHarness({
    initialSource: {
      markdown:
        '![ALT](uploads/doc-1/image.png "Пример стандартного резюме|||aspect=1")',
      sourceStorageId: "source-1",
      assetBasePath: "",
      assets: [
        {
          id: "uploads/doc-1/image.png",
          path: "uploads/doc-1/image.png",
          fileName: "image.png",
          mimeType: "image/png",
          byteLength: 3
        }
      ]
    },
    initialSourceAssets: new Map([["source-1:uploads/doc-1/image.png", new Uint8Array([1, 2, 3]).buffer]]),
    getActiveTab: async () => ({
      id: 77,
      url: "https://admin.praktikum.yandex-team.ru/course/lesson/theory/"
    }),
    sendBridgeMessage: async ({ message }) => {
      if (message.type === MESSAGE_TYPES.UPLOAD_THEORY_RESOURCE) {
        return {
          success: true,
          fileUrl: "https://pictures.s3.yandex.net/resources/picture_1.png"
        };
      }

      if (message.type === MESSAGE_TYPES.APPEND_TEXT_BLOCKS) {
        appendMarkdown = message.markdown;
        return {
          success: true,
          appendedCount: 1,
          tableCount: 0,
          imageCount: 1
        };
      }

      throw new Error(`Unexpected message type: ${message.type}`);
    }
  });

  await controller.handleRuntimeMessage({
    type: BACKGROUND_MESSAGE_TYPES.START_INSERT_SOURCE
  });
  await runScheduledTasks(state);

  assert.equal(
    appendMarkdown,
    '![ALT](https://pictures.s3.yandex.net/resources/picture_1.png "Пример стандартного резюме|||aspect=1")'
  );
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
