import { Action, ActionPanel, environment, Icon, List } from "@raycast/api";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { useEffect, useMemo, useState } from "react";
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

export default function ClipboardHistory() {
  const host = useMemo(() => getHost(), []);
  const [windowItems, setWindowItems] = useState<ClipboardItem[]>([]);
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [searchText, setSearchText] = useState("");
  const [isLoading, setIsLoading] = useState(
    host instanceof Error ? false : true,
  );
  const [error, setError] = useState<ViewError | null>(
    host instanceof Error ? hostToViewError(host) : null,
  );

  useEffect(() => {
    if (host instanceof Error) return;
    let cancelled = false;

    void loadClipboardWindow(host.databasePath)
      .then((loaded) => {
        if (cancelled) return;
        setWindowItems(loaded);
        setItems(filterWindow(loaded, searchText));
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(databaseToViewError(cause, host));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [host]);

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

  return (
    <List
      filtering={false}
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
        items.map((item) => <ClipboardListItem key={item.id} item={item} />)
      )}
    </List>
  );
}

function ClipboardListItem({ item }: { item: ClipboardItem }) {
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

function getHost(): TinycastHost | Error {
  try {
    return deriveTinycastHost(environment.supportPath);
  } catch (error) {
    return error instanceof Error
      ? error
      : new Error("This extension is designed for Tinycast.");
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
