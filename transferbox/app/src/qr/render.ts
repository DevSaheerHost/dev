import QRCode from 'qrcode';
import { AppError } from '@/lib/errors';

/**
 * Error correction level M with a moderate frame payload: enough redundancy to
 * survive a phone camera at an angle, without inflating the frame count.
 */
const OPTIONS: QRCode.QRCodeToDataURLOptions = {
  errorCorrectionLevel: 'M',
  margin: 2,
  scale: 8,
  color: { dark: '#0b1220ff', light: '#ffffffff' },
};

/** Render one frame to a data URL for an <img>. */
export async function renderQr(text: string): Promise<string> {
  try {
    return await QRCode.toDataURL(text, OPTIONS);
  } catch (error) {
    throw new AppError('unsupported', error);
  }
}

/** Render directly onto a canvas, used where frames change quickly. */
export async function renderQrToCanvas(canvas: HTMLCanvasElement, text: string): Promise<void> {
  try {
    await QRCode.toCanvas(canvas, text, { ...OPTIONS, scale: undefined, width: canvas.width });
  } catch (error) {
    throw new AppError('unsupported', error);
  }
}
