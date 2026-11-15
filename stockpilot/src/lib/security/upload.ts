/**
 * Upload validation. File type is decided from magic bytes, never from the
 * client-supplied name or Content-Type.
 */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export type ImageMime = "image/jpeg" | "image/png" | "image/webp";
export type AudioMime = "audio/webm" | "audio/ogg" | "audio/mp4" | "audio/mpeg" | "audio/wav";

const ascii = (b: Uint8Array, start: number, end: number) => String.fromCharCode(...b.subarray(start, end));

export function sniffImage(bytes: Uint8Array): ImageMime | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && ascii(bytes, 1, 4) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a) return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  return null;
}

export function sniffAudio(bytes: Uint8Array): AudioMime | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "audio/webm";
  if (ascii(bytes, 0, 4) === "OggS") return "audio/ogg";
  if (ascii(bytes, 4, 8) === "ftyp") return "audio/mp4";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WAVE") return "audio/wav";
  if (ascii(bytes, 0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  return null;
}

export const EXTENSION: Record<ImageMime | AudioMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};

export type UploadCheck<T> = { ok: true; mime: T; bytes: Uint8Array } | { ok: false; error: string; status: number };

export async function readValidatedUpload<T extends ImageMime | AudioMime>(
  file: File | null,
  kind: "image" | "audio",
): Promise<UploadCheck<T>> {
  if (!file) return { ok: false, error: "No file was uploaded.", status: 400 };
  const max = kind === "image" ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES;
  if (file.size === 0) return { ok: false, error: "The file is empty.", status: 400 };
  if (file.size > max) return { ok: false, error: `File is too large (max ${Math.round(max / 1024 / 1024)} MB).`, status: 413 };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = kind === "image" ? sniffImage(bytes) : sniffAudio(bytes);
  if (!mime) {
    return {
      ok: false,
      error: kind === "image" ? "Unsupported image. Use JPEG, PNG or WebP." : "Unsupported audio format.",
      status: 415,
    };
  }
  return { ok: true, mime: mime as T, bytes };
}
