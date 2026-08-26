# tinycast-clipboard

A Tinycast-specific Clipboard History extension whose primary action is copying instead of pasting:

| Shortcut           | Action              |
| ------------------ | ------------------- |
| `Return`           | Copy to Clipboard   |
| `Command + Return` | Paste to Active App |

It reads the clipboard history maintained by the Tinycast instance that launched it. It does not maintain another history database and never writes to Tinycast's SQLite database.

## Why

Tinycast intentionally keeps its built-in Clipboard History shortcuts fixed. This extension provides a different workflow without changing or forking Tinycast. See [Tinycast issue #341](https://github.com/abue-ammar/tinycast/issues/341) for the design discussion.

## Requirements

- macOS
- Tinycast with Extensions enabled
- Tinycast Clipboard History enabled and used at least once
- `/usr/bin/sqlite3` (included with macOS)
- Node.js 22.22.2 or newer for building

All clipboard data stays local. The extension makes no network requests and contains no analytics or telemetry.

## Installation

```bash
npm install
npm run build
```

In Tinycast, open **Settings → Extensions → Add Folder…** and select the generated `dist` directory.

Tinycast isolates extension installs by its bundle ID. If you use Stable and Beta, install the same `dist` directory once in each channel. The extension derives the active host from `environment.supportPath`; it never chooses whichever clipboard database happens to exist.

## Shortcut setup

1. Clear or disable the global shortcut for Tinycast's built-in Clipboard History.
2. Assign that shortcut to **Clipboard History** under the **Tinycast Clipboard** extension.

## How it works

- Reads `~/Library/Caches/<current Tinycast bundle ID>/clipboard.sqlite3` through `/usr/bin/sqlite3 -readonly`.
- Loads roughly the latest 1,000 normal entries plus all pinned entries.
- Keeps pinned entries first in their original pin order.
- Uses Tinycast's FTS5 trigram index for searches of three or more characters; shorter searches filter the in-memory window.
- Uses Tinycast's supported `Action.CopyToClipboard` and `Action.Paste` APIs for text and images.

## Known limitations

- `Option + Return` / Paste and Keep Window Open is unsupported because Tinycast's Extension API does not expose an equivalent action.
- Copying or pasting an image may create a duplicate image entry in Tinycast Clipboard History. The system clipboard still contains one image; only the history/cache may gain a duplicate.
- Some target apps may interpret an image as a file attachment because Tinycast writes both file URL and image representations.
- The extension does not promote, pin, unpin, delete, clear, or otherwise mutate Tinycast history.
- It depends on Tinycast's internal SQLite schema and may require an update if that schema changes.
