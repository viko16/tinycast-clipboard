import { extname } from "node:path";

export const MAX_INLINE_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_TOTAL_INLINE_IMAGE_BYTES = 48 * 1024 * 1024;

export function textDetailMarkdown(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\\`*_{}\[\]<>()#+\-.!|>~]/g, "\\$&"))
    .join("\u2028");
}

export function imageDetailMarkdown(
  imagePath: string,
  contents: Buffer,
): string {
  const mimeType = imageMimeType(imagePath);
  return `![Clipboard image](data:${mimeType};base64,${contents.toString("base64")})`;
}

function imageMimeType(imagePath: string): string {
  switch (extname(imagePath).toLocaleLowerCase()) {
    case ".gif":
      return "image/gif";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".svg":
      return "image/svg+xml";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    case ".webp":
      return "image/webp";
    default:
      return "image/png";
  }
}
