/**
 * Direct browser-to-browser transfer.
 *
 * The Realtime Database is used only to exchange the session description and
 * ICE candidates for a short-lived pairing code. Once the data channel opens,
 * payload bytes travel directly between the two browsers and never touch
 * Firebase. Each transfer carries a SHA-256 of the original bytes, which the
 * receiver recomputes before it hands the Blob over.
 *
 * Without a TURN server some symmetric-NAT pairs cannot connect; the caller
 * gets `peer-failed` and the interface suggests Save & Sync instead.
 */

import { onDisconnect, onValue, push, ref, remove, set, get } from 'firebase/database';

import { getDb } from '@/firebase/client';
import { signalPath } from '@/firebase/paths';
import {
  ICE_SERVERS,
  PAIR_CODE_ALPHABET,
  PAIR_CODE_LENGTH,
  RTC_BUFFER_HIGH,
  RTC_BUFFER_LOW,
  RTC_CHUNK_BYTES,
  SIGNAL_TTL_MS,
} from '@/lib/constants';
import { AppError, toAppError } from '@/lib/errors';
import { randomCode, sha256Hex } from '@/crypto/workspace';
import type { Progress } from '@/types';

export type PeerRole = 'sender' | 'receiver';

export type PeerPhase =
  | 'idle'
  | 'waiting'
  | 'connecting'
  | 'connected'
  | 'transferring'
  | 'done'
  | 'failed';

export interface TransferMeta {
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  kind: 'file' | 'text';
}

export interface PeerEvents {
  onPhase: (phase: PeerPhase, detail?: string) => void;
  onProgress: (progress: Progress) => void;
  onReceived: (blob: Blob, meta: TransferMeta, verified: boolean) => void;
  onError: (error: AppError) => void;
}

export function isWebRtcSupported(): boolean {
  return typeof RTCPeerConnection !== 'undefined';
}

export function newPairCode(): string {
  return randomCode(PAIR_CODE_LENGTH, PAIR_CODE_ALPHABET);
}

interface SignalRecord {
  createdAt: number;
  expiresAt: number;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
}

const META_PREFIX = 'META:';
const DONE_MESSAGE = 'DONE';

/**
 * One pairing session. Create it, call `host()` or `join()`, then `send()`.
 * `close()` tears down both the connection and its signaling record.
 */
export class PeerSession {
  private connection: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private unsubscribers: Array<() => void> = [];
  private incoming: { meta: TransferMeta; parts: BlobPart[]; received: number } | null = null;
  private closed = false;

  constructor(
    readonly code: string,
    private readonly events: PeerEvents,
  ) {}

  private db() {
    const db = getDb();
    if (!db) throw new AppError('cloud-not-configured');
    return db;
  }

  private createConnection(): RTCPeerConnection {
    if (!isWebRtcSupported()) throw new AppError('unsupported');
    const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    connection.onconnectionstatechange = () => {
      const state = connection.connectionState;
      if (state === 'failed' || state === 'disconnected') {
        if (!this.closed) this.events.onError(new AppError('peer-failed'));
        this.events.onPhase('failed');
      }
    };

    this.connection = connection;
    return connection;
  }

  private bindChannel(channel: RTCDataChannel): void {
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = RTC_BUFFER_LOW;

    channel.onopen = () => this.events.onPhase('connected');
    channel.onclose = () => {
      if (!this.closed) this.events.onPhase('idle');
    };
    channel.onerror = () => this.events.onError(new AppError('peer-failed'));
    channel.onmessage = (event) => void this.handleMessage(event.data);

    this.channel = channel;
  }

  private async handleMessage(data: unknown): Promise<void> {
    if (typeof data === 'string') {
      if (data.startsWith(META_PREFIX)) {
        try {
          const meta = JSON.parse(data.slice(META_PREFIX.length)) as TransferMeta;
          this.incoming = { meta, parts: [], received: 0 };
          this.events.onPhase('transferring', meta.name);
          this.events.onProgress({ loaded: 0, total: meta.size });
        } catch {
          this.events.onError(new AppError('peer-failed'));
        }
        return;
      }
      if (data === DONE_MESSAGE) await this.completeIncoming();
      return;
    }

    if (!this.incoming) return;
    const chunk = data as ArrayBuffer;
    this.incoming.parts.push(chunk);
    this.incoming.received += chunk.byteLength;
    this.events.onProgress({ loaded: this.incoming.received, total: this.incoming.meta.size });
  }

  private async completeIncoming(): Promise<void> {
    const incoming = this.incoming;
    this.incoming = null;
    if (!incoming) return;

    const blob = new Blob(incoming.parts, {
      type: incoming.meta.mimeType || 'application/octet-stream',
    });
    let verified = false;
    try {
      const digest = await sha256Hex(await blob.arrayBuffer());
      verified = digest === incoming.meta.sha256;
    } catch {
      verified = false;
    }

    this.events.onPhase('done', incoming.meta.name);
    this.events.onReceived(blob, incoming.meta, verified);
    if (!verified) this.events.onError(new AppError('integrity-failed'));
  }

  /** Publish an offer and wait for the other browser to answer. */
  async host(): Promise<void> {
    try {
      const db = this.db();
      const connection = this.createConnection();
      this.bindChannel(connection.createDataChannel('transferbox', { ordered: true }));

      const room = ref(db, signalPath(this.code));
      const now = Date.now();

      connection.onicecandidate = (event) => {
        if (event.candidate) void push(ref(db, `${signalPath(this.code)}/callerCandidates`), event.candidate.toJSON());
      };

      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);

      const record: SignalRecord = {
        createdAt: now,
        expiresAt: now + SIGNAL_TTL_MS,
        offer: { type: offer.type, sdp: offer.sdp ?? '' },
      };
      await set(room, record);
      void onDisconnect(room).remove();

      this.events.onPhase('waiting', this.code);

      this.unsubscribers.push(
        onValue(ref(db, `${signalPath(this.code)}/answer`), (snapshot) => {
          const answer = snapshot.val() as RTCSessionDescriptionInit | null;
          if (!answer || connection.currentRemoteDescription) return;
          this.events.onPhase('connecting');
          void connection.setRemoteDescription(new RTCSessionDescription(answer));
        }),
      );

      this.unsubscribers.push(
        onValue(ref(db, `${signalPath(this.code)}/calleeCandidates`), (snapshot) => {
          snapshot.forEach((child) => {
            const candidate = child.val() as RTCIceCandidateInit | null;
            if (candidate) void connection.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);
          });
        }),
      );
    } catch (error) {
      this.events.onPhase('failed');
      throw toAppError(error, 'peer-failed');
    }
  }

  /** Answer an offer published under `code`. */
  async join(): Promise<void> {
    try {
      const db = this.db();
      const snapshot = await get(ref(db, signalPath(this.code)));
      const record = snapshot.val() as SignalRecord | null;
      if (!record?.offer) throw new AppError('peer-failed');
      if (record.expiresAt < Date.now()) throw new AppError('workspace-expired');

      const connection = this.createConnection();
      connection.ondatachannel = (event) => this.bindChannel(event.channel);

      connection.onicecandidate = (event) => {
        if (event.candidate) void push(ref(db, `${signalPath(this.code)}/calleeCandidates`), event.candidate.toJSON());
      };

      this.events.onPhase('connecting');
      await connection.setRemoteDescription(new RTCSessionDescription(record.offer));
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      await set(ref(db, `${signalPath(this.code)}/answer`), {
        type: answer.type,
        sdp: answer.sdp ?? '',
      });

      this.unsubscribers.push(
        onValue(ref(db, `${signalPath(this.code)}/callerCandidates`), (candidates) => {
          candidates.forEach((child) => {
            const candidate = child.val() as RTCIceCandidateInit | null;
            if (candidate) void connection.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);
          });
        }),
      );
    } catch (error) {
      this.events.onPhase('failed');
      throw toAppError(error, 'peer-failed');
    }
  }

  get ready(): boolean {
    return this.channel?.readyState === 'open';
  }

  /** Send a Blob over the open channel, pausing when the buffer fills. */
  async send(blob: Blob, meta: Omit<TransferMeta, 'sha256'>): Promise<void> {
    const channel = this.channel;
    if (!channel || channel.readyState !== 'open') throw new AppError('peer-failed');

    const buffer = await blob.arrayBuffer();
    const sha256 = await sha256Hex(buffer);
    channel.send(`${META_PREFIX}${JSON.stringify({ ...meta, sha256 })}`);

    this.events.onPhase('transferring', meta.name);
    const bytes = new Uint8Array(buffer);
    let offset = 0;

    while (offset < bytes.byteLength) {
      if (channel.bufferedAmount > RTC_BUFFER_HIGH) {
        await new Promise<void>((resolve) => {
          const onLow = () => {
            channel.removeEventListener('bufferedamountlow', onLow);
            resolve();
          };
          channel.addEventListener('bufferedamountlow', onLow);
        });
      }
      const end = Math.min(offset + RTC_CHUNK_BYTES, bytes.byteLength);
      channel.send(bytes.slice(offset, end) as unknown as ArrayBuffer);
      offset = end;
      this.events.onProgress({ loaded: offset, total: bytes.byteLength });
    }

    channel.send(DONE_MESSAGE);
    this.events.onPhase('done', meta.name);
  }

  close(): void {
    this.closed = true;
    for (const stop of this.unsubscribers) stop();
    this.unsubscribers = [];
    this.channel?.close();
    this.connection?.close();
    this.channel = null;
    this.connection = null;

    const db = getDb();
    if (db) void remove(ref(db, signalPath(this.code))).catch(() => undefined);
  }
}
