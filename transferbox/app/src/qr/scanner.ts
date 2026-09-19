import jsQR from 'jsqr';
import { AppError } from '@/lib/errors';

/**
 * Camera scanning.
 *
 * Uses the browser's native BarcodeDetector when it exists (faster, hardware
 * accelerated) and falls back to jsQR over a canvas everywhere else. Either way
 * the caller receives decoded strings and never touches the camera directly.
 */

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
}

type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike;

function nativeDetector(): BarcodeDetectorLike | null {
  const ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!ctor) return null;
  try {
    return new ctor({ formats: ['qr_code'] });
  } catch {
    return null;
  }
}

export function isCameraSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

export interface ScannerHandle {
  stop: () => void;
}

/** Start scanning into `video`, calling `onResult` for every decoded frame. */
export async function startScanner(
  video: HTMLVideoElement,
  onResult: (value: string) => void,
  onError: (error: AppError) => void,
): Promise<ScannerHandle> {
  if (!isCameraSupported()) throw new AppError('unsupported');

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
  } catch (error) {
    throw new AppError('camera-denied', error);
  }

  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  await video.play().catch(() => undefined);

  const detector = nativeDetector();
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  let running = true;
  let frame = 0;

  const tick = async () => {
    if (!running) return;
    frame += 1;

    try {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        if (detector) {
          const found = await detector.detect(video);
          for (const code of found) onResult(code.rawValue);
        } else if (context && frame % 2 === 0) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const image = context.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(image.data, image.width, image.height, {
            inversionAttempts: 'dontInvert',
          });
          if (code?.data) onResult(code.data);
        }
      }
    } catch (error) {
      onError(new AppError('unknown', error));
    }

    requestAnimationFrame(() => void tick());
  };

  void tick();

  return {
    stop: () => {
      running = false;
      for (const track of stream.getTracks()) track.stop();
      video.srcObject = null;
    },
  };
}
