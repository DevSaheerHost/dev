/**
 * QR transfer protocol (TBX1).
 *
 * A payload never goes into a single QR code. It is split into fixed-size byte
 * chunks, each encoded as its own frame with enough header to be reassembled
 * out of order, with duplicates, and across interrupted scans.
 *
 * Frame layout — one line, pipe separated, chosen over a JSON envelope so the
 * header costs ~90 bytes instead of ~200 and more payload fits per frame:
 *
 *   TBX1|<transferId>|<index>|<total>|<sha256-hex>|<base64url chunk>
 *    │        │          │       │          │            └ this chunk only
 *    │        │          │       │          └ SHA-256 of the WHOLE payload
 *    │        │          │       └ total number of frames
 *    │        │          └ zero-based frame index
 *    │        └ 8-character transfer id, so frames from two transfers
 *    │          can never be mixed
 *    └ protocol version
 *
 * The receiver verifies the reassembled bytes against the SHA-256 carried by
 * every frame, so a corrupted or partial scan is reported, never silently
 * accepted.
 */

import { QR_CHUNK_BYTES } from '@/lib/constants';
import { AppError } from '@/lib/errors';
import { fromBase64Url, randomCode, sha256Hex, toBase64Url } from '@/crypto/workspace';

export const QR_PROTOCOL = 'TBX1';
const ID_ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789';
const ID_LENGTH = 8;

export interface QrFrame {
  transferId: string;
  index: number;
  total: number;
  checksum: string;
  data: Uint8Array;
}

export interface QrTransfer {
  transferId: string;
  checksum: string;
  total: number;
  /** Encoded frames, ready to be rendered as QR codes. */
  frames: string[];
  byteLength: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Split arbitrary bytes into encoded QR frames. */
export async function createTransfer(
  payload: Uint8Array,
  chunkBytes: number = QR_CHUNK_BYTES,
): Promise<QrTransfer> {
  if (payload.byteLength === 0) throw new AppError('empty');
  const size = Math.max(64, Math.floor(chunkBytes));
  const checksum = await sha256Hex(payload as BufferSource);
  const transferId = randomCode(ID_LENGTH, ID_ALPHABET);
  const total = Math.ceil(payload.byteLength / size);

  const frames: string[] = [];
  for (let index = 0; index < total; index += 1) {
    const chunk = payload.subarray(index * size, Math.min((index + 1) * size, payload.byteLength));
    frames.push(encodeFrame({ transferId, index, total, checksum, data: chunk }));
  }
  return { transferId, checksum, total, frames, byteLength: payload.byteLength };
}

/** Convenience wrapper: UTF-8 text in, frames out. */
export async function createTextTransfer(text: string, chunkBytes?: number): Promise<QrTransfer> {
  return createTransfer(encoder.encode(text), chunkBytes);
}

export function encodeFrame(frame: QrFrame): string {
  return [
    QR_PROTOCOL,
    frame.transferId,
    String(frame.index),
    String(frame.total),
    frame.checksum,
    toBase64Url(frame.data),
  ].join('|');
}

/**
 * Parse one scanned frame. Returns null for anything that is not a TBX1 frame,
 * so an unrelated QR code in the camera's view is ignored rather than fatal.
 */
export function parseFrame(raw: string): QrFrame | null {
  if (typeof raw !== 'string' || !raw.startsWith(`${QR_PROTOCOL}|`)) return null;
  const parts = raw.split('|');
  if (parts.length !== 6) return null;
  const [, transferId, indexText, totalText, checksum, data] = parts as [
    string, string, string, string, string, string,
  ];

  const index = Number(indexText);
  const total = Number(totalText);
  if (!/^[a-z0-9]{4,16}$/.test(transferId)) return null;
  if (!/^[0-9a-f]{64}$/.test(checksum)) return null;
  if (!Number.isInteger(index) || !Number.isInteger(total)) return null;
  if (total < 1 || total > 10_000) return null;
  if (index < 0 || index >= total) return null;

  try {
    return { transferId, index, total, checksum, data: fromBase64Url(data) };
  } catch {
    return null;
  }
}

export interface ReceiverState {
  transferId: string;
  total: number;
  checksum: string;
  received: number;
  missing: number[];
  complete: boolean;
}

export type ReceiveOutcome =
  | { status: 'ignored' }
  | { status: 'mismatch' }
  | { status: 'duplicate'; state: ReceiverState }
  | { status: 'accepted'; state: ReceiverState };

/**
 * Collects frames for exactly one transfer. Frames from a different transfer
 * are reported rather than merged, duplicates are counted once, and the result
 * is only produced when every index is present and the checksum matches.
 */
export class QrReceiver {
  private transferId: string | null = null;
  private total = 0;
  private checksum = '';
  private readonly chunks = new Map<number, Uint8Array>();

  accept(raw: string): ReceiveOutcome {
    const frame = parseFrame(raw);
    if (!frame) return { status: 'ignored' };

    if (this.transferId === null) {
      this.transferId = frame.transferId;
      this.total = frame.total;
      this.checksum = frame.checksum;
    } else if (
      frame.transferId !== this.transferId ||
      frame.total !== this.total ||
      frame.checksum !== this.checksum
    ) {
      return { status: 'mismatch' };
    }

    const known = this.chunks.has(frame.index);
    if (!known) this.chunks.set(frame.index, frame.data);
    return { status: known ? 'duplicate' : 'accepted', state: this.state() };
  }

  state(): ReceiverState {
    const missing: number[] = [];
    for (let i = 0; i < this.total; i += 1) if (!this.chunks.has(i)) missing.push(i);
    return {
      transferId: this.transferId ?? '',
      total: this.total,
      checksum: this.checksum,
      received: this.chunks.size,
      missing,
      complete: this.total > 0 && missing.length === 0,
    };
  }

  reset(): void {
    this.transferId = null;
    this.total = 0;
    this.checksum = '';
    this.chunks.clear();
  }

  /** Reassemble and verify. Throws when incomplete or corrupted. */
  async finish(): Promise<Uint8Array> {
    const state = this.state();
    if (!state.complete) throw new AppError('qr-incomplete');

    let length = 0;
    for (let i = 0; i < this.total; i += 1) length += this.chunks.get(i)!.byteLength;

    const payload = new Uint8Array(length);
    let offset = 0;
    for (let i = 0; i < this.total; i += 1) {
      const chunk = this.chunks.get(i)!;
      payload.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const digest = await sha256Hex(payload as BufferSource);
    if (digest !== this.checksum) throw new AppError('qr-corrupt');
    return payload;
  }

  async finishText(): Promise<string> {
    return decoder.decode(await this.finish());
  }
}

/** "27 QR frames · 12.6 KB" — shown before a sequence starts. */
export function describeTransfer(transfer: QrTransfer): string {
  return `${transfer.total} QR frame${transfer.total === 1 ? '' : 's'}`;
}
