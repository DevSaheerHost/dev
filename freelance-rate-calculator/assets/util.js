/**
 * Shared helpers. Every value that reaches the DOM, a downloaded file or
 * localStorage passes through one of these first.
 */

/** Coerce anything to a finite number, falling back when it is not one. */
export function toNumber(value, fallback = 0) {
  const n = typeof value === 'number'
    ? value
    : parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

/** Keep a number inside a range. Non-finite input collapses to `min`. */
export function clamp(value, min, max) {
  const n = toNumber(value, min);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/** Trim free text and cap its length so no field can grow without bound. */
export function cleanText(value, maxLength = 2000) {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim().slice(0, maxLength);
}

/** Split a textarea into non-empty lines, capped in both count and length. */
export function toLines(value, maxLines = 30, maxLength = 200) {
  return cleanText(value, maxLines * (maxLength + 1))
    .split('\n')
    .map((line) => line.replace(/^[\s*+\-]+/, '').trim().slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxLines);
}

/** Escape text destined for an exported HTML file. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Build a safe download filename from user-supplied text. */
export function safeFilename(value, fallback = 'quotation') {
  const base = cleanText(value, 60)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || fallback;
}

/**
 * Money formatting. Falls back to a plain symbol prefix when a runtime does
 * not know the currency code, so a figure never renders as "NaN".
 */
export function formatMoney(amount, currency, decimals = 0) {
  const value = toNumber(amount, 0);
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.code,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(value);
  } catch {
    return `${currency.symbol}${value.toFixed(decimals)}`;
  }
}

/** Plain number with grouping, for hours and percentages. */
export function formatNumber(value, decimals = 0) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(toNumber(value, 0));
}

/** ISO date (YYYY-MM-DD), optionally offset by whole days. */
export function isoDate(date = new Date(), addDays = 0) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + addDays);
  return d.toISOString().slice(0, 10);
}

/** Long-form date for the quotation sheet. */
export function longDate(isoString) {
  const d = new Date(`${isoString}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoString;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Replace an element's content with a plain text node. */
export function setText(node, text) {
  if (node) node.textContent = String(text ?? '');
}

/** Create an element with optional class, text and attributes. */
export function el(tag, { className, text, attrs } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  }
  return node;
}

/** Remove every child of a node. */
export function empty(node) {
  while (node && node.firstChild) node.removeChild(node.firstChild);
}
