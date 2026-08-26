import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import {
  ClipboardItem,
  orderClipboardItems,
  parseClipboardRows,
} from "./clipboard-model";

const SQLITE = "/usr/bin/sqlite3";
const REQUIRED_COLUMNS = [
  "id",
  "kind",
  "text",
  "image_path",
  "created_at",
  "source_app",
  "pinned_at",
];
const execFileAsync = promisify(execFile);

const WINDOW_QUERY = `
WITH window_floor AS (
  SELECT COALESCE((
    SELECT rowid
    FROM items
    WHERE pinned_at IS NULL
    ORDER BY rowid DESC
    LIMIT 1 OFFSET 999
  ), 0) AS floor
)
SELECT rid AS row_id, id, kind, text, image_path, created_at, source_app, pinned_at
FROM (
  SELECT rowid AS rid, * FROM items WHERE rowid >= (SELECT floor FROM window_floor)
  UNION ALL
  SELECT rowid AS rid, * FROM items
  WHERE pinned_at IS NOT NULL AND rowid < (SELECT floor FROM window_floor)
)
ORDER BY rid DESC;
`;

export class DatabaseNotFoundError extends Error {}
export class IncompatibleDatabaseError extends Error {}

export async function loadClipboardWindow(
  databasePath: string,
): Promise<ClipboardItem[]> {
  if (!existsSync(databasePath)) {
    throw new DatabaseNotFoundError(
      `Tinycast clipboard history database was not found.\n${databasePath}`,
    );
  }

  await validateSchema(databasePath);
  return orderClipboardItems(
    parseClipboardRows(await queryJson(databasePath, WINDOW_QUERY)),
  );
}

export async function searchClipboard(
  databasePath: string,
  query: string,
  pinnedItems: ClipboardItem[],
): Promise<ClipboardItem[]> {
  const normalizedQuery = query.trim();
  const queryHex = Buffer.from(normalizedQuery, "utf8").toString("hex");
  const sql = `
SELECT f.rowid AS row_id, i.id, i.kind, i.text, i.image_path, i.created_at, i.source_app, i.pinned_at
FROM items_fts AS f
JOIN items AS i ON i.rowid = f.rowid
WHERE items_fts MATCH ('"' || replace(CAST(X'${queryHex}' AS TEXT), '"', '""') || '"')
ORDER BY f.rowid DESC
LIMIT 200;
`;

  const matchingPins = pinnedItems.filter(
    (item) =>
      item.text
        ?.toLocaleLowerCase()
        .includes(normalizedQuery.toLocaleLowerCase()) ?? false,
  );
  const matches = parseClipboardRows(await queryJson(databasePath, sql)).filter(
    (item) => item.pinnedAt === null,
  );
  return orderClipboardItems([...matchingPins, ...matches]);
}

async function validateSchema(databasePath: string): Promise<void> {
  const columns = await queryJson(databasePath, "PRAGMA table_info(items);");
  if (!Array.isArray(columns))
    throw new IncompatibleDatabaseError("Invalid items table metadata.");
  const names = new Set(
    columns.flatMap((column) =>
      isRecord(column) && typeof column.name === "string" ? [column.name] : [],
    ),
  );
  const missing = REQUIRED_COLUMNS.filter((column) => !names.has(column));

  const ftsRows = await queryJson(
    databasePath,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'items_fts' LIMIT 1;",
  );
  if (missing.length > 0 || !Array.isArray(ftsRows) || ftsRows.length !== 1) {
    throw new IncompatibleDatabaseError(
      "The Tinycast clipboard database schema is incompatible with this extension.",
    );
  }
}

async function queryJson(databasePath: string, sql: string): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { stdout } = await execFileAsync(
        SQLITE,
        ["-readonly", "-json", "-cmd", ".timeout 250", databasePath, sql],
        { encoding: "utf8", timeout: 2_000, maxBuffer: 5 * 1024 * 1024 },
      );
      const trimmed = stdout.trim();
      return trimmed ? JSON.parse(trimmed) : [];
    } catch (error) {
      lastError = error;
      if (!isBusyError(error) || attempt === 2) break;
      await delay(50 * (attempt + 1));
    }
  }

  if (lastError instanceof SyntaxError) {
    throw new IncompatibleDatabaseError(
      "Tinycast returned malformed SQLite JSON.",
    );
  }
  throw new IncompatibleDatabaseError(
    "Unable to read the Tinycast clipboard database in read-only mode.",
  );
}

function isBusyError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const stderr = typeof error.stderr === "string" ? error.stderr : "";
  const message = typeof error.message === "string" ? error.message : "";
  return /database is locked|database is busy|SQLITE_BUSY/i.test(
    `${stderr}\n${message}`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
