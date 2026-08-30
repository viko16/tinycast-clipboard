import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";

export type ClipboardKind = "text" | "image";

export interface ClipboardItem {
  id: string;
  rowId: number;
  kind: ClipboardKind;
  text: string | null;
  imagePath: string | null;
  createdAt: number;
  sourceApp: string | null;
  pinnedAt: number | null;
}

interface ClipboardRow {
  row_id?: unknown;
  id?: unknown;
  kind?: unknown;
  text?: unknown;
  image_path?: unknown;
  created_at?: unknown;
  source_app?: unknown;
  pinned_at?: unknown;
}

export interface TinycastHost {
  bundleId: string;
  databasePath: string;
}

const TINYCAST_BUNDLE_ID = /^com\.tinycast\.app(?:\.[A-Za-z0-9-]+)*$/;

export function deriveTinycastHost(
  supportPath: string,
  home = homedir(),
): TinycastHost {
  const appSupport = join(home, "Library", "Application Support");
  const pathFromAppSupport = relative(appSupport, resolve(supportPath));
  const parts = pathFromAppSupport.split(sep);
  const [bundleId, storageKind, extensionName] = parts;

  if (
    pathFromAppSupport.startsWith(`..${sep}`) ||
    parts.length < 3 ||
    storageKind !== "extension-support" ||
    !extensionName ||
    !TINYCAST_BUNDLE_ID.test(bundleId)
  ) {
    throw new Error("This extension is designed for Tinycast.");
  }

  return {
    bundleId,
    databasePath: join(appSupport, bundleId, "clipboard.sqlite3"),
  };
}

export function parseClipboardRows(value: unknown): ClipboardItem[] {
  if (!Array.isArray(value)) {
    throw new Error("SQLite returned an unexpected result.");
  }

  return value.flatMap((raw: ClipboardRow) => {
    const rowId = toFiniteNumber(raw.row_id);
    const createdAt = toFiniteNumber(raw.created_at);
    if (
      rowId === null ||
      createdAt === null ||
      typeof raw.id !== "string" ||
      !raw.id ||
      (raw.kind !== "text" && raw.kind !== "image")
    ) {
      return [];
    }

    return [
      {
        id: raw.id,
        rowId,
        kind: raw.kind,
        text: toNullableString(raw.text),
        imagePath: toNullableString(raw.image_path),
        createdAt,
        sourceApp: toNullableString(raw.source_app),
        pinnedAt: toFiniteNumber(raw.pinned_at),
      },
    ];
  });
}

export function orderClipboardItems(items: ClipboardItem[]): ClipboardItem[] {
  const pinned = items
    .filter((item) => item.pinnedAt !== null)
    .sort(
      (left, right) =>
        (left.pinnedAt ?? Number.MAX_VALUE) -
        (right.pinnedAt ?? Number.MAX_VALUE),
    );
  const history = items
    .filter((item) => item.pinnedAt === null)
    .sort((left, right) => right.rowId - left.rowId);
  return [...pinned, ...history];
}

export function filterWindow(
  items: ClipboardItem[],
  query: string,
): ClipboardItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return orderClipboardItems(items);
  return orderClipboardItems(
    items.filter(
      (item) =>
        item.text?.toLocaleLowerCase().includes(normalizedQuery) ?? false,
    ),
  );
}

export function summarizeText(text: string, maxLength = 180): string {
  const summary = text.replace(/\s+/g, " ").trim();
  if (!summary) return "Empty Text";
  return summary.length > maxLength
    ? `${summary.slice(0, maxLength - 1)}…`
    : summary;
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
