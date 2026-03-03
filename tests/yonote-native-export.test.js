import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeTextBytes,
  extractZipEntriesFromArrayBuffer,
  pickPrimaryMarkdownZipEntry,
  requestYonoteNativeExport
} from "../shared/native-export.js";

function u16(value) {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u32(value) {
  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff
  ];
}

function buildStoredZip(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  entries.forEach(entry => {
    const nameBytes = encoder.encode(entry.name);
    const dataBytes = entry.data instanceof Uint8Array ? entry.data : encoder.encode(String(entry.data || ""));

    const localHeader = new Uint8Array([
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0x0800),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(dataBytes.length),
      ...u32(dataBytes.length),
      ...u16(nameBytes.length),
      ...u16(0),
      ...nameBytes
    ]);

    localParts.push(localHeader, dataBytes);

    const centralHeader = new Uint8Array([
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(0x0800),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(dataBytes.length),
      ...u32(dataBytes.length),
      ...u16(nameBytes.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(localOffset),
      ...nameBytes
    ]);

    centralParts.push(centralHeader);
    localOffset += localHeader.length + dataBytes.length;
  });

  const centralDirectoryOffset = localOffset;
  const centralDirectorySize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endOfCentralDirectory = new Uint8Array([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(centralDirectorySize),
    ...u32(centralDirectoryOffset),
    ...u16(0)
  ]);

  const parts = [...localParts, ...centralParts, endOfCentralDirectory];
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  parts.forEach(part => {
    output.set(part, offset);
    offset += part.length;
  });

  return output.buffer;
}

test("native export zip is unpacked in memory and yields markdown payload", async () => {
  const zipBuffer = buildStoredZip([
    { name: "lesson.md", data: "# Lesson\n\n[Example](https://example.com)\n" },
    { name: "assets/picture.png", data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) }
  ]);

  const entries = await extractZipEntriesFromArrayBuffer(zipBuffer);
  assert.equal(entries.length, 2);

  const markdownEntry = pickPrimaryMarkdownZipEntry(entries);
  assert.ok(markdownEntry);
  assert.equal(markdownEntry.name, "lesson.md");

  const markdown = decodeTextBytes(markdownEntry.data);
  assert.match(markdown, /^# Lesson/);
  assert.equal(markdown.trim(), "# Lesson\n\n[Example](https://example.com)");
});

test("native export can resolve a signed URL from fileOperations.redirect before downloading zip", async () => {
  const zipBuffer = buildStoredZip([
    { name: "lesson.md", data: "# Native\n\n~~inline~~\n" }
  ]);

  const originalFetch = globalThis.fetch;
  let redirectPollCount = 0;

  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);

    if (href.includes("/api/fileOperations.redirect")) {
      redirectPollCount += 1;

      if (redirectPollCount < 2) {
        return new Response(JSON.stringify({ data: { state: "waiting" } }), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        });
      }

      return new Response(null, {
        status: 302,
        headers: {
          location: "https://yonote.storage.yandexcloud.net/fake-export.zip"
        }
      });
    }

    if (href.includes("yonote.storage.yandexcloud.net/fake-export.zip")) {
      return new Response(zipBuffer, {
        status: 200,
        headers: {
          "content-type": "application/zip"
        }
      });
    }

    throw new Error(`Unexpected fetch: ${href} (${init.redirect || "follow"})`);
  };

  try {
    const result = await requestYonoteNativeExport({
      baseOrigin: "https://practicum.yonote.ru",
      documentId: "doc-id",
      operationId: "op-id"
    });

    assert.equal(result.markdown, "# Native\n\n~~inline~~");
    assert.equal(redirectPollCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("native export accepts direct markdown from xhr polling", async () => {
  const originalXhr = globalThis.XMLHttpRequest;
  const encoder = new TextEncoder();

  class FakeMarkdownXhr {
    constructor() {
      this.headers = {};
      this.status = 0;
      this.response = null;
      this.responseURL = "";
      this.onload = null;
      this.onerror = null;
      this.onabort = null;
    }

    open(method, url) {
      this.method = method;
      this.url = url;
    }

    setRequestHeader(name, value) {
      this.headers[name] = value;
    }

    getAllResponseHeaders() {
      return "content-type: text/markdown\r\n";
    }

    send() {
      this.status = 200;
      this.responseURL = "https://yonote.storage.yandexcloud.net/fake-export.md";
      this.response = encoder.encode("# Direct\n\n~~inline~~\n").buffer;
      if (typeof this.onload === "function") {
        this.onload();
      }
    }
  }

  globalThis.XMLHttpRequest = FakeMarkdownXhr;

  try {
    const result = await requestYonoteNativeExport({
      baseOrigin: "https://practicum.yonote.ru",
      documentId: "doc-id",
      operationId: "op-id"
    });

    assert.equal(result.markdown, "# Direct\n\n~~inline~~");
  } finally {
    globalThis.XMLHttpRequest = originalXhr;
  }
});

test("native export accepts markdown from followed opaqueredirect in fetch mode", async () => {
  const originalFetch = globalThis.fetch;
  const originalXhr = globalThis.XMLHttpRequest;
  const encoder = new TextEncoder();
  let manualPollCount = 0;

  globalThis.XMLHttpRequest = undefined;
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);

    if (href.includes("/api/fileOperations.redirect") && init.redirect === "manual") {
      manualPollCount += 1;

      return {
        status: 0,
        ok: false,
        type: "opaqueredirect",
        redirected: false,
        url: "",
        headers: new Headers()
      };
    }

    if (href.includes("/api/fileOperations.redirect") && init.redirect === "follow") {
      return {
        status: 200,
        ok: true,
        type: "basic",
        redirected: true,
        url: "https://yonote.storage.yandexcloud.net/fake-export.md",
        headers: new Headers({
          "content-type": "text/markdown"
        }),
        arrayBuffer: async () => encoder.encode("# Followed\n\nBody\n").buffer
      };
    }

    throw new Error(`Unexpected fetch: ${href} (${init.redirect || "follow"})`);
  };

  try {
    const result = await requestYonoteNativeExport({
      baseOrigin: "https://practicum.yonote.ru",
      documentId: "doc-id",
      operationId: "op-id"
    });

    assert.equal(result.markdown, "# Followed\n\nBody");
    assert.equal(manualPollCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.XMLHttpRequest = originalXhr;
  }
});
