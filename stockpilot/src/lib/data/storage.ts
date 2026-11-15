import "server-only";
import { bucket } from "@/lib/firebase/admin";

/** Uploads to the private bucket. Paths are always namespaced by business id. */
export async function uploadPrivate(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{8,64}\/[A-Za-z0-9/_.-]{1,200}$/.test(path)) throw new Error("Invalid storage path");
  await bucket().file(path).save(Buffer.from(bytes), { contentType, resumable: false, metadata: { cacheControl: "private, max-age=0" } });
}

/** Short-lived read URL for one object of the caller's business. */
export async function signedUrl(businessId: string, path: string, seconds = 900): Promise<string | null> {
  if (!path.startsWith(`${businessId}/`)) return null;
  try {
    if (process.env.FIREBASE_STORAGE_EMULATOR_HOST) return null;
    const [url] = await bucket().file(path).getSignedUrl({ action: "read", expires: Date.now() + seconds * 1000, version: "v4" });
    return url;
  } catch {
    return null;
  }
}
