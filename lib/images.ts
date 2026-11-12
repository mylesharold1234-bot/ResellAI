export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGES = 3;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export function validateImageMeta(type: string, size: number) {
  if (!(IMAGE_TYPES as readonly string[]).includes(type))
    throw new Error(
      "Choose JPG, PNG, or WebP images. Convert HEIC photos first.",
    );
  if (!Number.isFinite(size) || size <= 0)
    throw new Error("This image is empty. Choose another photo.");
  if (size > MAX_IMAGE_BYTES)
    throw new Error("Each photo must be 10 MB or smaller.");
}
export function validateImageBytes(type: string, bytes: Uint8Array) {
  validateImageMeta(type, bytes.length);
  const matches =
    type === "image/jpeg"
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : type === "image/png"
        ? [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
        : bytes.length >= 16 &&
          String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
          String.fromCharCode(...bytes.slice(8, 12)) === "WEBP" &&
          ["VP8 ", "VP8L", "VP8X"].includes(
            String.fromCharCode(...bytes.slice(12, 16)),
          );
  if (!matches)
    throw new Error(
      "Image contents do not match the file type. Choose a valid JPG, PNG, or WebP.",
    );
}
export function validateImageBatch(files: { type: string; size: number }[]) {
  if (!files.length || files.length > MAX_IMAGES)
    throw new Error("Choose between 1 and 3 product photos.");
  files.forEach((f) => validateImageMeta(f.type, f.size));
  if (files.reduce((sum, f) => sum + f.size, 0) > MAX_IMAGE_BYTES)
    throw new Error("Keep all selected photos under 10 MB combined.");
}
