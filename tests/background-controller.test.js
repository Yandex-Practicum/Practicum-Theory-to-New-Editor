import assert from "node:assert/strict";
import test from "node:test";

import { createBackgroundController } from "../shared/background-controller.js";
import { BACKGROUND_MESSAGE_TYPES, BRIDGE_KINDS, EXT_BUILD, MESSAGE_TYPES } from "../shared/constants.js";

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
    fetchSourceAssetBytes: overrides.fetchSourceAssetBytes,
    getActiveTab: overrides.getActiveTab || (async () => ({ id: 12, url: "https://practicum.yonote.ru/doc/test-doc" })),
    sendBridgeMessage:
      overrides.sendBridgeMessage ||
      (async () => ({
        success: true,
        bridgeVersion: EXT_BUILD,
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
        bridgeVersion: EXT_BUILD,
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

test("copy flow humanizes message-port-closed bridge errors", async () => {
  const { controller, state } = createHarness({
    sendBridgeMessage: async () => {
      throw new Error("The message port closed before a response was received.");
    }
  });

  await controller.handleRuntimeMessage({
    type: BACKGROUND_MESSAGE_TYPES.START_COPY_SOURCE
  });
  await runScheduledTasks(state);

  assert.equal(state.task.stage, "error");
  assert.equal(state.task.message, "Страница была закрыта или перезагружена до ответа. Повторите действие.");
});

test("wiki copy flow uses immediate payload, skips native export, and stores only fetched assets", async () => {
  let receivedKind = "";
  let receivedType = "";
  let nativeExportCalls = 0;
  const wikiAssetUrlA = "https://wiki.yandex-team.ru/.files/diagram-a.png";
  const wikiAssetUrlB = "https://wiki.yandex-team.ru/.files/diagram-b.png";

  const { controller, state } = createHarness({
    getActiveTab: async () => ({
      id: 44,
      url: "https://wiki.yandex-team.ru/tools/practicum-helper/"
    }),
    sendBridgeMessage: async ({ kind, message }) => {
      receivedKind = kind;
      receivedType = message.type;

      return {
        success: true,
        bridgeVersion: EXT_BUILD,
        payload: {
          title: "Wiki title",
          markdown: "# Wiki title\n\nText\n\n![A](https://wiki.yandex-team.ru/.files/diagram-a.png)",
          sourceUrl: "https://wiki.yandex-team.ru/tools/practicum-helper/",
          sourceMode: "Wiki rendered DOM",
          assets: [
            {
              id: wikiAssetUrlA,
              path: wikiAssetUrlA,
              fileName: "diagram-a.png",
              mimeType: "image/png",
              byteLength: 0
            },
            {
              id: wikiAssetUrlB,
              path: wikiAssetUrlB,
              fileName: "diagram-b.png",
              mimeType: "image/png",
              byteLength: 0
            }
          ],
          assetBasePath: "",
          assetCount: 2
        }
      };
    },
    fetchSourceAssetBytes: async asset => {
      if (asset.id !== wikiAssetUrlA) {
        return null;
      }

      const bytes = new Uint8Array([1, 2, 3]).buffer;
      return {
        bytes,
        mimeType: "image/png",
        byteLength: bytes.byteLength
      };
    },
    requestNativeExport: async () => {
      nativeExportCalls += 1;
      return {
        markdown: "unused"
      };
    }
  });

  await controller.handleRuntimeMessage({
    type: BACKGROUND_MESSAGE_TYPES.START_COPY_SOURCE
  });
  await runScheduledTasks(state);

  assert.equal(receivedKind, BRIDGE_KINDS.WIKI);
  assert.equal(receivedType, MESSAGE_TYPES.COPY_FROM_WIKI);
  assert.equal(nativeExportCalls, 0);
  assert.equal(state.task.stage, "success");
  assert.equal(state.source.provider, "wiki");
  assert.equal(state.source.assetCount, 1);
  assert.equal(state.source.assets[0].id, wikiAssetUrlA);
  assert.ok(state.source.sourceStorageId);
  assert.equal(state.savedAssetWrites.length, 1);
  assert.equal(state.savedAssetWrites[0].assets.length, 1);
});

test("wiki copy flow stays successful and clears stale assets when background fetch fails for all images", async () => {
  const wikiAssetUrl = "https://wiki.yandex-team.ru/.files/missing.png";

  const { controller, state } = createHarness({
    getActiveTab: async () => ({
      id: 45,
      url: "https://wiki.yandex-team.ru/tools/practicum-helper/"
    }),
    sendBridgeMessage: async () => ({
      success: true,
      bridgeVersion: EXT_BUILD,
      payload: {
        title: "Wiki title",
        markdown: "# Wiki title\n\n![ALT](https://wiki.yandex-team.ru/.files/missing.png)",
        sourceUrl: "https://wiki.yandex-team.ru/tools/practicum-helper/",
        sourceMode: "Wiki rendered DOM",
        assets: [
          {
            id: wikiAssetUrl,
            path: wikiAssetUrl,
            fileName: "missing.png",
            mimeType: "image/png",
            byteLength: 0
          }
        ],
        assetBasePath: "",
        assetCount: 1
      }
    }),
    fetchSourceAssetBytes: async () => null
  });

  await controller.handleRuntimeMessage({
    type: BACKGROUND_MESSAGE_TYPES.START_COPY_SOURCE
  });
  await runScheduledTasks(state);

  assert.equal(state.task.stage, "success");
  assert.equal(state.source.provider, "wiki");
  assert.equal(state.source.assetCount, 0);
  assert.deepEqual(state.source.assets, []);
  assert.equal(state.source.sourceStorageId, "");
  assert.equal(state.savedAssetWrites.length, 0);
  assert.equal(state.clearedSourceAssets, 1);
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
    message: "Считываю контент источника...",
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

test("insert flow on migrated prestable moves into reloading and completes from tabs.onUpdated", async () => {
  const { controller, state } = createHarness({
    initialSource: {
      markdown: "# Title\n\nText"
    },
    getActiveTab: async () => ({
      id: 77,
      url: "https://admin-prestable.practicum.yandex-team.ru/course/lesson/theory/"
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
        assert.match(message.fileName, /^picture-[a-f0-9]{8}\.png$/);
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

test("insert flow starts multiple image uploads before waiting for responses", async () => {
  const uploadResolvers = new Map();
  const startedUploads = [];
  let appendRequests = 0;

  const { controller, state } = createHarness({
    initialSource: {
      markdown: "![A](assets/a.png)\n\n![B](assets/b.png)",
      sourceStorageId: "source-1",
      assetBasePath: "",
      assets: [
        {
          id: "assets/a.png",
          path: "assets/a.png",
          fileName: "a.png",
          mimeType: "image/png",
          byteLength: 1
        },
        {
          id: "assets/b.png",
          path: "assets/b.png",
          fileName: "b.png",
          mimeType: "image/png",
          byteLength: 1
        }
      ]
    },
    initialSourceAssets: new Map([
      ["source-1:assets/a.png", new Uint8Array([1]).buffer],
      ["source-1:assets/b.png", new Uint8Array([2]).buffer]
    ]),
    getActiveTab: async () => ({
      id: 77,
      url: "https://admin.praktikum.yandex-team.ru/course/lesson/theory/"
    }),
    sendBridgeMessage: ({ message }) => {
      if (message.type === MESSAGE_TYPES.UPLOAD_THEORY_RESOURCE) {
        startedUploads.push(message.fileName);
        return new Promise(resolve => {
          uploadResolvers.set(message.fileName, resolve);
        });
      }

      if (message.type === MESSAGE_TYPES.APPEND_TEXT_BLOCKS) {
        appendRequests += 1;
        return Promise.resolve({
          success: true,
          appendedCount: 2,
          tableCount: 0,
          imageCount: 2
        });
      }

      throw new Error(`Unexpected message type: ${message.type}`);
    }
  });

  await controller.handleRuntimeMessage({
    type: BACKGROUND_MESSAGE_TYPES.START_INSERT_SOURCE
  });
  await runScheduledTasks(state);

  assert.equal(startedUploads.length, 2);
  assert.match(startedUploads[0], /^a-[a-f0-9]{8}\.png$/);
  assert.match(startedUploads[1], /^b-[a-f0-9]{8}\.png$/);
  assert.equal(appendRequests, 0);

  uploadResolvers.get(startedUploads[0])({
    success: true,
    fileUrl: "https://pictures.s3.yandex.net/resources/a.png"
  });
  for (let step = 0; step < 40; step += 1) {
    await Promise.resolve();
  }
  assert.equal(appendRequests, 0);

  uploadResolvers.get(startedUploads[1])({
    success: true,
    fileUrl: "https://pictures.s3.yandex.net/resources/b.png"
  });
  for (let step = 0; step < 80; step += 1) {
    await Promise.resolve();
  }

  assert.equal(appendRequests, 1);
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
        assert.match(message.fileName, /^image-[a-f0-9]{8}\.png$/);
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

test("insert flow rewrites absolute wiki image urls after upload", async () => {
  let appendMarkdown = "";
  const wikiAssetUrl = "https://wiki.yandex-team.ru/.files/inline-diagram.png";

  const { controller, state } = createHarness({
    initialSource: {
      markdown: `![ALT](${wikiAssetUrl})`,
      sourceStorageId: "source-1",
      assetBasePath: "",
      assets: [
        {
          id: wikiAssetUrl,
          path: wikiAssetUrl,
          fileName: "inline-diagram.png",
          mimeType: "image/png",
          byteLength: 3
        }
      ]
    },
    initialSourceAssets: new Map([["source-1:https://wiki.yandex-team.ru/.files/inline-diagram.png", new Uint8Array([1, 2, 3]).buffer]]),
    getActiveTab: async () => ({
      id: 77,
      url: "https://admin.praktikum.yandex-team.ru/course/lesson/theory/"
    }),
    sendBridgeMessage: async ({ message }) => {
      if (message.type === MESSAGE_TYPES.UPLOAD_THEORY_RESOURCE) {
        assert.match(message.fileName, /^inline-diagram-[a-f0-9]{8}\.png$/);
        return {
          success: true,
          fileUrl: "https://pictures.s3.yandex.net/resources/wiki-image.png"
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

  assert.equal(appendMarkdown, "![ALT](https://pictures.s3.yandex.net/resources/wiki-image.png)");
});

test("insert flow uses unique upload file names for assets with the same basename", async () => {
  const seenFileNames = [];

  const { controller, state } = createHarness({
    initialSource: {
      markdown: "![A](images/one/image.png)\n\n![B](images/two/image.png)",
      sourceStorageId: "source-1",
      assetBasePath: "",
      assets: [
        {
          id: "images/one/image.png",
          path: "images/one/image.png",
          fileName: "image.png",
          mimeType: "image/png",
          byteLength: 3
        },
        {
          id: "images/two/image.png",
          path: "images/two/image.png",
          fileName: "image.png",
          mimeType: "image/png",
          byteLength: 3
        }
      ]
    },
    initialSourceAssets: new Map([
      ["source-1:images/one/image.png", new Uint8Array([1, 2, 3]).buffer],
      ["source-1:images/two/image.png", new Uint8Array([4, 5, 6]).buffer]
    ]),
    getActiveTab: async () => ({
      id: 77,
      url: "https://admin.praktikum.yandex-team.ru/course/lesson/theory/"
    }),
    sendBridgeMessage: async ({ message }) => {
      if (message.type === MESSAGE_TYPES.UPLOAD_THEORY_RESOURCE) {
        seenFileNames.push(message.fileName);
        return {
          success: true,
          fileUrl: `https://pictures.s3.yandex.net/resources/${message.fileName}`
        };
      }

      if (message.type === MESSAGE_TYPES.APPEND_TEXT_BLOCKS) {
        return {
          success: true,
          appendedCount: 2,
          tableCount: 0,
          imageCount: 2
        };
      }

      throw new Error(`Unexpected message type: ${message.type}`);
    }
  });

  await controller.handleRuntimeMessage({
    type: BACKGROUND_MESSAGE_TYPES.START_INSERT_SOURCE
  });
  await runScheduledTasks(state);

  assert.equal(seenFileNames.length, 2);
  assert.notEqual(seenFileNames[0], seenFileNames[1]);
  assert.match(seenFileNames[0], /^image-[a-f0-9]{8}\.png$/);
  assert.match(seenFileNames[1], /^image-[a-f0-9]{8}\.png$/);
});

test("insert flow escapes snake_case in plain text without touching markdown syntax", async () => {
  let appendMarkdown = "";

  const { controller, state } = createHarness({
    initialSource: {
      markdown:
        'Идентификаторы online_store и tools_shop.\n\n`public.table_name`\n\n[Гайд](https://example.com/online_store)\n\n![ALT](https://cdn.example.com/tools_shop.png)'
    },
    getActiveTab: async () => ({
      id: 77,
      url: "https://admin.praktikum.yandex-team.ru/course/lesson/theory/"
    }),
    sendBridgeMessage: async ({ message }) => {
      if (message.type === MESSAGE_TYPES.APPEND_TEXT_BLOCKS) {
        appendMarkdown = message.markdown;
        return {
          success: true,
          appendedCount: 1,
          tableCount: 0,
          imageCount: 0
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
    'Идентификаторы online\\_store и tools\\_shop.\n\n`public.table_name`\n\n[Гайд](https://example.com/online_store)\n\n![ALT](https://cdn.example.com/tools_shop.png)'
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
