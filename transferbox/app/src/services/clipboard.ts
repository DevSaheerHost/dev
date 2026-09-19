import { AppError } from '@/lib/errors';

/** Copy text, falling back to a hidden textarea where the API is unavailable. */
export async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Permission denied or insecure context — try the legacy path below.
  }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', 'true');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    if (!ok) throw new Error('execCommand refused');
  } catch (error) {
    throw new AppError('clipboard-denied', error);
  }
}

/** Read text from the clipboard. Requires a user gesture in most browsers. */
export async function pasteText(): Promise<string> {
  if (!navigator.clipboard?.readText) throw new AppError('clipboard-denied');
  try {
    return await navigator.clipboard.readText();
  } catch (error) {
    throw new AppError('clipboard-denied', error);
  }
}

export function canPaste(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.readText);
}
