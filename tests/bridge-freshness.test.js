import assert from "node:assert/strict";
import test from "node:test";

import { BRIDGE_KINDS, EXT_BUILD } from "../shared/constants.js";
import { getStaleBridgeErrorMessage, sendMessageWithBridgeFreshness } from "../shared/bridge-freshness.js";

function createSend(sequence) {
  let index = 0;

  return async function send() {
    const next = sequence[index];
    index += 1;

    if (next instanceof Error) {
      throw next;
    }

    return next;
  };
}

test("bridge freshness reinjects on mismatched version and accepts second response", async () => {
  let injectCount = 0;

  const response = await sendMessageWithBridgeFreshness({
    tabId: 1,
    kind: BRIDGE_KINDS.YONOTE,
    message: { type: "TEST" },
    sendMessage: createSend([
      { bridgeVersion: "3.0.2-api-first", bridgeKind: "yonote", success: true },
      { bridgeVersion: EXT_BUILD, bridgeKind: "yonote", success: true }
    ]),
    injectBridge: async () => {
      injectCount += 1;
    }
  });

  assert.equal(injectCount, 1);
  assert.equal(response.bridgeVersion, EXT_BUILD);
});

test("bridge freshness reinjects on missing bridgeVersion", async () => {
  let injectCount = 0;

  const response = await sendMessageWithBridgeFreshness({
    tabId: 1,
    kind: BRIDGE_KINDS.YONOTE,
    message: { type: "TEST" },
    sendMessage: createSend([
      { bridgeKind: "yonote", success: true },
      { bridgeVersion: EXT_BUILD, bridgeKind: "yonote", success: true }
    ]),
    injectBridge: async () => {
      injectCount += 1;
    }
  });

  assert.equal(injectCount, 1);
  assert.equal(response.bridgeVersion, EXT_BUILD);
});

test("bridge freshness reinjects when the first response is missing", async () => {
  let injectCount = 0;

  const response = await sendMessageWithBridgeFreshness({
    tabId: 1,
    kind: BRIDGE_KINDS.YONOTE,
    message: { type: "TEST" },
    sendMessage: createSend([
      undefined,
      { bridgeVersion: EXT_BUILD, bridgeKind: "yonote", success: true }
    ]),
    injectBridge: async () => {
      injectCount += 1;
    }
  });

  assert.equal(injectCount, 1);
  assert.equal(response.bridgeVersion, EXT_BUILD);
});

test("bridge freshness throws a hard stale error after a second invalid response", async () => {
  await assert.rejects(
    () =>
      sendMessageWithBridgeFreshness({
        tabId: 1,
        kind: BRIDGE_KINDS.YONOTE,
        message: { type: "TEST" },
        sendMessage: createSend([
          { bridgeVersion: "old-build", bridgeKind: "yonote", success: true },
          { bridgeVersion: "still-old", bridgeKind: "yonote", success: true }
        ]),
        injectBridge: async () => {}
      }),
    new Error(getStaleBridgeErrorMessage(BRIDGE_KINDS.YONOTE))
  );
});

test("bridge freshness does not reinject when the first response already matches", async () => {
  let injectCount = 0;

  const response = await sendMessageWithBridgeFreshness({
    tabId: 1,
    kind: BRIDGE_KINDS.THEORY,
    message: { type: "TEST" },
    sendMessage: createSend([
      { bridgeVersion: EXT_BUILD, bridgeKind: "theory", success: true }
    ]),
    injectBridge: async () => {
      injectCount += 1;
    }
  });

  assert.equal(injectCount, 0);
  assert.equal(response.bridgeKind, "theory");
});

test("bridge freshness reports a wiki-specific stale bridge error", () => {
  assert.equal(
    getStaleBridgeErrorMessage(BRIDGE_KINDS.WIKI),
    "На вкладке работает устаревший bridge. Обновите саму страницу wiki."
  );
});

test("bridge freshness accepts a reinjected wiki response", async () => {
  let injectCount = 0;

  const response = await sendMessageWithBridgeFreshness({
    tabId: 2,
    kind: BRIDGE_KINDS.WIKI,
    message: { type: "TEST" },
    sendMessage: createSend([
      { bridgeVersion: "old-build", bridgeKind: "wiki", success: true },
      { bridgeVersion: EXT_BUILD, bridgeKind: "wiki", success: true }
    ]),
    injectBridge: async () => {
      injectCount += 1;
    }
  });

  assert.equal(injectCount, 1);
  assert.equal(response.bridgeKind, "wiki");
});
