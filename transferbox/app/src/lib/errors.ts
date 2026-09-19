/**
 * Error handling.
 *
 * Users see a sentence they can act on; the raw cause is kept for the console
 * in development only, so a Firebase error string never reaches the interface.
 */

export type ErrorCode =
  | 'upload-failed'
  | 'download-failed'
  | 'save-failed'
  | 'delete-failed'
  | 'file-too-large'
  | 'unsafe-type'
  | 'text-too-large'
  | 'empty'
  | 'workspace-expired'
  | 'workspace-invalid'
  | 'cloud-unavailable'
  | 'cloud-not-configured'
  | 'clipboard-denied'
  | 'camera-denied'
  | 'unsupported'
  | 'qr-incomplete'
  | 'qr-mismatch'
  | 'qr-corrupt'
  | 'peer-failed'
  | 'integrity-failed'
  | 'unknown';

const MESSAGES: Record<ErrorCode, string> = {
  'upload-failed': 'Upload failed. Check your connection and try again.',
  'download-failed': 'That item could not be downloaded. It may have expired.',
  'save-failed': 'Could not save to this workspace. Your item is queued and will retry.',
  'delete-failed': 'Could not delete that item. Try again in a moment.',
  'file-too-large': 'That file is larger than this workspace allows.',
  'unsafe-type':
    'Web pages, SVG images and scripts are not accepted, because anything stored here could otherwise be opened as a live page. Zip it first and it will upload fine.',
  'text-too-large': 'That text is larger than this workspace allows.',
  empty: 'There is nothing to send yet.',
  'workspace-expired': 'This workspace link is no longer valid.',
  'workspace-invalid': 'That workspace link could not be read.',
  'cloud-unavailable': 'Cloud sync is unreachable right now. Items stay on this device until it returns.',
  'cloud-not-configured': 'Cloud sync is not configured for this build. QR and direct transfer still work.',
  'clipboard-denied': 'Your browser did not allow clipboard access. Select the text and copy it manually.',
  'camera-denied': 'Camera access was denied, so QR codes cannot be scanned on this device.',
  unsupported: 'Your browser does not support this feature.',
  'qr-incomplete': 'Some QR frames are still missing. Keep scanning the ones listed below.',
  'qr-mismatch': 'Those frames belong to a different transfer. Start the scan again.',
  'qr-corrupt': 'The scanned transfer did not pass its integrity check. Ask the sender to replay it.',
  'peer-failed': 'The direct connection could not be established. Try Save & Sync instead.',
  'integrity-failed': 'Transfer completed but integrity verification failed. Do not trust this copy.',
  unknown: 'Something went wrong. Please try again.',
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly cause?: unknown;

  constructor(code: ErrorCode, cause?: unknown) {
    super(MESSAGES[code]);
    this.name = 'AppError';
    this.code = code;
    this.cause = cause;
  }
}

/** Map anything thrown into a user-facing AppError, logging the cause in dev. */
export function toAppError(error: unknown, fallback: ErrorCode = 'unknown'): AppError {
  if (error instanceof AppError) return error;
  if (import.meta.env.DEV) console.error('[transferbox]', error);
  return new AppError(fallback, error);
}

export function messageFor(error: unknown): string {
  return error instanceof AppError ? error.message : MESSAGES.unknown;
}
