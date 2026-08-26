import assert from "node:assert/strict";
import test from "node:test";
import type { ClipboardItem } from "../src/clipboard-model.ts";
import {
  deriveTinycastHost,
  filterWindow,
  orderClipboardItems,
  parseClipboardRows,
  summarizeText,
} from "../src/clipboard-model.ts";

const home = "/Users/viko";

test("derives stable, beta, dev, and future channel database paths", () => {
  for (const bundleId of [
    "com.tinycast.app",
    "com.tinycast.app.beta",
    "com.tinycast.app.dev",
    "com.tinycast.app.nightly-2",
  ]) {
    assert.deepEqual(
      deriveTinycastHost(
        `${home}/Library/Application Support/${bundleId}/extension-support/tinycast-clipboard`,
        home,
      ),
      {
        bundleId,
        databasePath: `${home}/Library/Caches/${bundleId}/clipboard.sqlite3`,
      },
    );
  }
});

test("rejects Raycast, malformed, and out-of-tree support paths", () => {
  for (const supportPath of [
    `${home}/Library/Application Support/com.raycast.macos/extensions/tinycast-clipboard`,
    `${home}/Library/Application Support/com.tinycast.app/extension-data/tinycast-clipboard`,
    `${home}/Library/Caches/com.tinycast.app/extension-support/tinycast-clipboard`,
  ]) {
    assert.throws(
      () => deriveTinycastHost(supportPath, home),
      /designed for Tinycast/,
    );
  }
});

test("parses rows and preserves missing nullable fields", () => {
  assert.deepEqual(
    parseClipboardRows([
      { row_id: 8, id: "text-id", kind: "text", text: "hello", created_at: 10 },
      {
        row_id: 7,
        id: "image-id",
        kind: "image",
        image_path: "/tmp/image.png",
        created_at: 9,
        pinned_at: 3,
      },
      { row_id: 6, id: "bad-kind", kind: "file", created_at: 8 },
    ]),
    [
      {
        rowId: 8,
        id: "text-id",
        kind: "text",
        text: "hello",
        imagePath: null,
        createdAt: 10,
        sourceApp: null,
        pinnedAt: null,
      },
      {
        rowId: 7,
        id: "image-id",
        kind: "image",
        text: null,
        imagePath: "/tmp/image.png",
        createdAt: 9,
        sourceApp: null,
        pinnedAt: 3,
      },
    ],
  );
});

test("orders pins oldest-pin-first and normal history newest-row-first", () => {
  const item = (
    id: string,
    rowId: number,
    pinnedAt: number | null,
  ): ClipboardItem => ({
    id,
    rowId,
    kind: "text",
    text: id,
    imagePath: null,
    createdAt: rowId,
    sourceApp: null,
    pinnedAt,
  });
  const ordered = orderClipboardItems([
    item("normal-old", 2, null),
    item("pin-new", 8, 20),
    item("normal-new", 9, null),
    item("pin-old", 3, 10),
  ]);
  assert.deepEqual(
    ordered.map(({ id }) => id),
    ["pin-old", "pin-new", "normal-new", "normal-old"],
  );
  assert.deepEqual(
    filterWindow(ordered, "PIN").map(({ id }) => id),
    ["pin-old", "pin-new"],
  );
});

test("summarizes multiline and long text", () => {
  assert.equal(summarizeText(" first\n\nsecond\tthird "), "first second third");
  assert.equal(summarizeText("abcdef", 5), "abcd…");
});
