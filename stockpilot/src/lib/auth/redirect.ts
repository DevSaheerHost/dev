/** Only allow same-site relative paths as post-login destinations (no open redirects). */
export function safeNextPath(value: unknown, fallback = "/dashboard"): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\") || value.includes("://")) return fallback;
  if (value.length > 300) return fallback;
  return value;
}
