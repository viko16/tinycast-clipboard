import { Action, ActionPanel, environment, Icon, List } from "@raycast/api";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { useEffect, useMemo, useState } from "react";
import {
  imageDetailMarkdown,
  MAX_INLINE_IMAGE_BYTES,
  MAX_TOTAL_INLINE_IMAGE_BYTES,
  textDetailMarkdown,
} from "./clipboard-detail";
import {
  ClipboardItem,
  deriveTinycastHost,
  filterWindow,
  summarizeText,
  TinycastHost,
} from "./clipboard-model";
import {
  DatabaseNotFoundError,
  loadClipboardWindow,
  searchClipboard,
} from "./sqlite";

interface ViewError {
  title: string;
  description: string;
}

interface InitialWindow {
  items: ClipboardItem[];
  error: ViewError | null;
}

type ImagePreview =
  { status: "ready"; markdown: string } | { status: "error"; message: string };

export default function ClipboardHistory() {
  const host = useMemo(() => getHost(), []);
  const [initialWindow] = useState(() => loadInitialWindow(host));
  const windowItems = initialWindow.items;
  const [items, setItems] = useState<ClipboardItem[]>(initialWindow.items);
  const [searchText, setSearchText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ViewError | null>(initialWindow.error);
  const [imagePreviews, setImagePreviews] = useState<
    Record<string, ImagePreview>
  >({});

  useEffect(() => {
    if (host instanceof Error || windowItems.length === 0) return;
    const query = searchText.trim();
    if (query.length < 3) {
      setItems(filterWindow(windowItems, query));
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    const timer = setTimeout(() => {
      const pins = windowItems.filter((item) => item.pinnedAt !== null);
      void searchClipboard(host.databasePath, query, pins)
        .then((matches) => {
          if (!cancelled) {
            setItems(matches);
            setError(null);
          }
        })
        .catch((cause: unknown) => {
          if (!cancelled) setError(databaseToViewError(cause, host));
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [host, searchText, windowItems]);

  useEffect(() => {
    let cancelled = false;
    let loadedBytes = 0;

    void (async () => {
      for (const item of windowItems) {
        if (cancelled) return;
        if (
          item.kind !== "image" ||
          !item.imagePath ||
          !existsSync(item.imagePath)
        ) {
          continue;
        }

        const preview = await loadImagePreview(item.imagePath, loadedBytes);
        if (cancelled) return;
        if (preview.status === "ready") {
          loadedBytes += preview.bytes;
          setImagePreviews((current) => ({
            ...current,
            [item.id]: { status: "ready", markdown: preview.markdown },
          }));
        } else {
          setImagePreviews((current) => ({
            ...current,
            [item.id]: { status: "error", message: preview.message },
          }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [windowItems]);

  return (
    <List
      filtering={false}
      isShowingDetail
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search Tinycast Clipboard History"
      throttle
    >
      {error ? (
        <List.EmptyView
          icon={Icon.Warning}
          title={error.title}
          description={error.description}
        />
      ) : items.length === 0 && !isLoading ? (
        <List.EmptyView
          icon={Icon.Clipboard}
          title={
            searchText.trim()
              ? "No Matching Clipboard Items"
              : "Clipboard History Is Empty"
          }
          description={
            searchText.trim()
              ? "Try a different search."
              : "Copy something, then reopen this command."
          }
        />
      ) : (
        items.map((item) => (
          <ClipboardListItem
            key={item.id}
            item={item}
            imagePreview={imagePreviews[item.id]}
          />
        ))
      )}
    </List>
  );
}

function ClipboardListItem({
  item,
  imagePreview,
}: {
  item: ClipboardItem;
  imagePreview: ImagePreview | undefined;
}) {
  const imageExists =
    item.kind === "image" && !!item.imagePath && existsSync(item.imagePath);
  const content =
    item.kind === "text" && item.text !== null
      ? item.text
      : imageExists
        ? { file: item.imagePath! }
        : null;
  const title =
    item.kind === "text" && item.text !== null
      ? summarizeText(item.text)
      : imageExists
        ? "Image"
        : "Image File Missing";
  const subtitle =
    item.sourceApp ?? (item.imagePath ? basename(item.imagePath) : undefined);
  const accessories: List.Item.Accessory[] = [
    ...(item.pinnedAt !== null ? [{ icon: Icon.Pin, tooltip: "Pinned" }] : []),
    { text: formatRelativeTime(item.createdAt) },
  ];

  return (
    <List.Item
      id={item.id}
      title={title}
      subtitle={subtitle}
      icon={
        imageExists
          ? item.imagePath!
          : item.kind === "image"
            ? Icon.Image
            : Icon.Text
      }
      detail={<ClipboardItemDetail item={item} imagePreview={imagePreview} />}
      accessories={accessories}
      actions={
        content !== null ? (
          <ActionPanel>
            <Action.CopyToClipboard content={content} />
            <Action.Paste
              content={content}
              shortcut={{ modifiers: ["cmd"], key: "enter" }}
            />
          </ActionPanel>
        ) : undefined
      }
    />
  );
}

function ClipboardItemDetail({
  item,
  imagePreview,
}: {
  item: ClipboardItem;
  imagePreview: ImagePreview | undefined;
}) {
  const imageExists =
    item.kind === "image" && !!item.imagePath && existsSync(item.imagePath);
  let markdown: string | undefined;
  let isLoading = false;

  if (item.kind === "text") {
    markdown = textDetailMarkdown(item.text ?? "");
  } else if (!imageExists) {
    markdown = "Image file is missing.";
  } else if (imagePreview) {
    if (imagePreview.status === "ready") {
      markdown = imagePreview.markdown;
    } else {
      markdown = imagePreview.message;
    }
  } else {
    isLoading = true;
  }

  return (
    <List.Item.Detail
      isLoading={isLoading}
      markdown={markdown}
      metadata={
        <List.Item.Detail.Metadata>
          {item.sourceApp ? (
            <List.Item.Detail.Metadata.Label
              title="Source"
              text={item.sourceApp}
            />
          ) : null}
          <List.Item.Detail.Metadata.Label
            title="Type"
            text={item.kind === "image" ? "Image" : "Text"}
          />
          <List.Item.Detail.Metadata.Label
            title="Copied"
            text={formatCopiedAt(item.createdAt)}
          />
          {item.pinnedAt !== null ? (
            <List.Item.Detail.Metadata.Label title="Pinned" text="Yes" />
          ) : null}
        </List.Item.Detail.Metadata>
      }
    />
  );
}

type LoadedImagePreview =
  | { status: "ready"; markdown: string; bytes: number }
  | { status: "error"; message: string };

async function loadImagePreview(
  imagePath: string,
  loadedBytes: number,
): Promise<LoadedImagePreview> {
  try {
    const metadata = await stat(imagePath);
    if (metadata.size > MAX_INLINE_IMAGE_BYTES) {
      return {
        status: "error",
        message: "This image is too large to preview. Press Return to copy it.",
      };
    }
    if (loadedBytes + metadata.size > MAX_TOTAL_INLINE_IMAGE_BYTES) {
      return {
        status: "error",
        message:
          "This preview was skipped to keep the extension responsive. Press Return to copy it.",
      };
    }
    return {
      status: "ready",
      markdown: imageDetailMarkdown(imagePath, await readFile(imagePath)),
      bytes: metadata.size,
    };
  } catch {
    return {
      status: "error",
      message: "This image could not be previewed. Press Return to copy it.",
    };
  }
}

function getHost(): TinycastHost | Error {
  try {
    return deriveTinycastHost(environment.supportPath);
  } catch (error) {
    return error instanceof Error
      ? error
      : new Error("This extension is designed for Tinycast.");
  }
}

function loadInitialWindow(host: TinycastHost | Error): InitialWindow {
  if (host instanceof Error) {
    return { items: [], error: hostToViewError(host) };
  }

  try {
    return { items: loadClipboardWindow(host.databasePath), error: null };
  } catch (cause: unknown) {
    return { items: [], error: databaseToViewError(cause, host) };
  }
}

function hostToViewError(error: Error): ViewError {
  return { title: "Tinycast Host Not Detected", description: error.message };
}

function databaseToViewError(cause: unknown, host: TinycastHost): ViewError {
  if (cause instanceof DatabaseNotFoundError) {
    return {
      title: "Clipboard Database Not Found",
      description: cause.message,
    };
  }
  return {
    title: "Incompatible Tinycast Clipboard Database",
    description: `This extension may be incompatible with the installed Tinycast version.\n${host.databasePath}`,
  };
}

function formatRelativeTime(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp * 1_000);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d`;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(timestamp * 1_000));
}

function formatCopiedAt(timestamp: number): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(timestamp * 1_000));
}
