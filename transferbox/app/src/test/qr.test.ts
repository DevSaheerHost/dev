import { describe, expect, it } from 'vitest';

import {
  QrReceiver,
  createTextTransfer,
  createTransfer,
  encodeFrame,
  parseFrame,
} from '@/qr/protocol';
import { AppError } from '@/lib/errors';

const bytes = (length: number, seed = 7): Uint8Array => {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) out[i] = (i * seed + 13) % 256;
  return out;
};

describe('QR chunk creation', () => {
  it('splits a payload into the expected number of frames', async () => {
    const transfer = await createTransfer(bytes(1000), 480);
    expect(transfer.total).toBe(3);
    expect(transfer.frames).toHaveLength(3);
    expect(transfer.byteLength).toBe(1000);
  });

  it('produces a single frame for a payload that fits', async () => {
    const transfer = await createTransfer(bytes(100), 480);
    expect(transfer.total).toBe(1);
  });

  it('carries the same transfer id and checksum on every frame', async () => {
    const transfer = await createTransfer(bytes(2000), 300);
    const parsed = transfer.frames.map((frame) => parseFrame(frame)!);
    expect(new Set(parsed.map((frame) => frame.transferId)).size).toBe(1);
    expect(new Set(parsed.map((frame) => frame.checksum)).size).toBe(1);
    expect(parsed.map((frame) => frame.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('refuses an empty payload', async () => {
    await expect(createTransfer(new Uint8Array(0))).rejects.toBeInstanceOf(AppError);
  });
});

describe('frame parsing', () => {
  it('round-trips a frame', () => {
    const frame = {
      transferId: 'abc12345',
      index: 2,
      total: 9,
      checksum: 'a'.repeat(64),
      data: bytes(32),
    };
    const parsed = parseFrame(encodeFrame(frame));
    expect(parsed).not.toBeNull();
    expect(parsed!.index).toBe(2);
    expect(Array.from(parsed!.data)).toEqual(Array.from(frame.data));
  });

  it('ignores anything that is not a TBX1 frame', () => {
    expect(parseFrame('https://example.com')).toBeNull();
    expect(parseFrame('')).toBeNull();
    expect(parseFrame('TBX1|only|three|parts')).toBeNull();
  });

  it('rejects out-of-range and malformed indexes', () => {
    const checksum = 'b'.repeat(64);
    expect(parseFrame(`TBX1|abc12345|5|5|${checksum}|AAAA`)).toBeNull();
    expect(parseFrame(`TBX1|abc12345|-1|5|${checksum}|AAAA`)).toBeNull();
    expect(parseFrame(`TBX1|abc12345|x|5|${checksum}|AAAA`)).toBeNull();
    expect(parseFrame(`TBX1|abc12345|0|0|${checksum}|AAAA`)).toBeNull();
  });

  it('rejects a malformed checksum', () => {
    expect(parseFrame('TBX1|abc12345|0|1|short|AAAA')).toBeNull();
  });
});

describe('QR reconstruction', () => {
  it('reassembles frames received out of order', async () => {
    const original = 'The quick brown fox '.repeat(200);
    const transfer = await createTextTransfer(original, 200);
    const receiver = new QrReceiver();

    for (const frame of [...transfer.frames].reverse()) receiver.accept(frame);

    expect(receiver.state().complete).toBe(true);
    await expect(receiver.finishText()).resolves.toBe(original);
  });

  it('counts duplicates once', async () => {
    const transfer = await createTextTransfer('hello world '.repeat(100), 120);
    const receiver = new QrReceiver();

    const first = receiver.accept(transfer.frames[0]!);
    const second = receiver.accept(transfer.frames[0]!);

    expect(first.status).toBe('accepted');
    expect(second.status).toBe('duplicate');
    expect(receiver.state().received).toBe(1);
  });

  it('reports which frames are still missing', async () => {
    const transfer = await createTextTransfer('x'.repeat(1000), 200);
    const receiver = new QrReceiver();

    transfer.frames.forEach((frame, index) => {
      if (index !== 2) receiver.accept(frame);
    });

    const state = receiver.state();
    expect(state.complete).toBe(false);
    expect(state.missing).toEqual([2]);
    await expect(receiver.finish()).rejects.toMatchObject({ code: 'qr-incomplete' });
  });

  it('refuses frames from a different transfer', async () => {
    const a = await createTextTransfer('alpha'.repeat(50), 100);
    const b = await createTextTransfer('beta'.repeat(50), 100);
    const receiver = new QrReceiver();

    receiver.accept(a.frames[0]!);
    expect(receiver.accept(b.frames[0]!).status).toBe('mismatch');
    expect(receiver.state().received).toBe(1);
  });

  it('detects a corrupted payload through the checksum', async () => {
    const transfer = await createTextTransfer('integrity matters '.repeat(40), 150);
    const receiver = new QrReceiver();

    transfer.frames.forEach((frame, index) => {
      if (index === 1) {
        const parts = frame.split('|');
        // Flip the payload of one frame while keeping the header intact.
        parts[5] = 'QUJDREVG';
        receiver.accept(parts.join('|'));
        return;
      }
      receiver.accept(frame);
    });

    expect(receiver.state().complete).toBe(true);
    await expect(receiver.finish()).rejects.toMatchObject({ code: 'qr-corrupt' });
  });

  it('starts over cleanly after a reset', async () => {
    const transfer = await createTextTransfer('reset me '.repeat(30), 100);
    const receiver = new QrReceiver();
    receiver.accept(transfer.frames[0]!);
    receiver.reset();
    expect(receiver.state().received).toBe(0);

    for (const frame of transfer.frames) receiver.accept(frame);
    await expect(receiver.finishText()).resolves.toContain('reset me');
  });

  it('survives multi-byte characters split across frames', async () => {
    const original = '日本語テキストと絵文字🚀'.repeat(40);
    const transfer = await createTextTransfer(original, 64);
    const receiver = new QrReceiver();
    for (const frame of transfer.frames) receiver.accept(frame);
    await expect(receiver.finishText()).resolves.toBe(original);
  });
});
