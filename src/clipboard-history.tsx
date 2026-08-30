import { Action, ActionPanel, environment, Icon, List } from "@raycast/api";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { useEffect, useMemo, useState } from "react";
import {
  imageDetailMarkdown,
  MAX_INLINE_IMAGE_BYTES,
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
  | { itemId: string; status: "loading" }
  | { itemId: string; status: "ready"; markdown: string }
  | { itemId: string; status: "error"; message: string };

export default function ClipboardHistory() {
  const host = useMemo(() => getHost(), []);
  const [initialWindow] = useState(() => loadInitialWindow(host));
  const windowItems = initialWindow.items;
  const [items, setItems] = useState<ClipboardItem[]>(initialWindow.items);
  const [searchText, setSearchText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ViewError | null>(initialWindow.error);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(
    initialWindow.items[0]?.id ?? null,
  );
  const [imagePreview, setImagePreview] = useState<ImagePreview | null>(null);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) ?? null,
    [items, selectedItemId],
  );

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
    if (selectedItem !== null || items.length === 0) {
      if (items.length === 0 && selectedItemId !== null) {
        setSelectedItemId(null);
      }
      return;
    }
    setSelectedItemId(items[0].id);
  }, [items, selectedItem, selectedItemId]);

  useEffect(() => {
    if (
      selectedItem?.kind !== "image" ||
      !selectedItem.imagePath ||
      !existsSync(selectedItem.imagePath)
    ) {
      setImagePreview(null);
      return;
    }

    let cancelled = false;
    const itemId = selectedItem.id;
    const imagePath = selectedItem.imagePath;
    setImagePreview({ itemId, status: "loading" });

    void loadImagePreview(imagePath)
      .then((markdown) => {
        if (!cancelled) {
          setImagePreview({ itemId, status: "ready", markdown });
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setImagePreview({
            itemId,
            status: "error",
            message:
              cause instanceof ImagePreviewTooLargeError
                ? "This image is too large to preview. Press Return to copy it."
                : "This image could not be previewed. Press Return to copy it.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedItem]);

  return (
    <List
      filtering={false}
      isShowingDetail
      isLoading={isLoading}
      onSelectionChange={(itemId) => {
        if (itemId !== null) setSelectedItemId(itemId);
      }}
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
            imagePreview={imagePreview}
            isSelected={item.id === selectedItemId}
          />
        ))
      )}
    </List>
  );
}

function ClipboardListItem({
  item,
  imagePreview,
  isSelected,
}: {
  item: ClipboardItem;
  imagePreview: ImagePreview | null;
  isSelected: boolean;
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
      detail={
        isSelected ? (
          <ClipboardItemDetail item={item} imagePreview={imagePreview} />
        ) : undefined
      }
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
  imagePreview: ImagePreview | null;
}) {
  const imageExists =
    item.kind === "image" && !!item.imagePath && existsSync(item.imagePath);
  let markdown: string | undefined;
  let isLoading = false;

  if (item.kind === "text") {
    markdown = textDetailMarkdown(item.text ?? "");
  } else if (!imageExists) {
    markdown = "Image file is missing.";
  } else if (imagePreview?.itemId === item.id) {
    if (imagePreview.status === "loading") {
      isLoading = true;
    } else if (imagePreview.status === "ready") {
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

class ImagePreviewTooLargeError extends Error {}

async function loadImagePreview(imagePath: string): Promise<string> {
  const metadata = await stat(imagePath);
  if (metadata.size > MAX_INLINE_IMAGE_BYTES) {
    throw new ImagePreviewTooLargeError();
  }
  return imageDetailMarkdown(imagePath, await readFile(imagePath));
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
