"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ScanBarcode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/feedback";
import { Input } from "@/components/ui/form";

interface Detector {
  detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
}

/** Barcode lookup via the native BarcodeDetector where available, with manual entry as fallback. */
export function BarcodeScanButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState("");
  const [supported, setSupported] = useState<boolean | null>(null);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!open) return;
    const Ctor = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    if (!Ctor || !navigator.mediaDevices?.getUserMedia) {
      setSupported(false);
      return;
    }
    setSupported(true);
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const detector = new Ctor({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"] });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" } } })
      .then(async (s) => {
        stream = s;
        if (!video.current || stopped) return;
        video.current.srcObject = s;
        await video.current.play();
        const loop = async () => {
          if (stopped || !video.current) return;
          try {
            const codes = await detector.detect(video.current);
            const code = codes[0]?.rawValue?.trim();
            if (code && /^[0-9A-Za-z-]{4,64}$/.test(code)) {
              setOpen(false);
              router.push(`/inventory?q=${encodeURIComponent(code)}`);
              return;
            }
          } catch {}
          raf = requestAnimationFrame(() => void loop());
        };
        void loop();
      })
      .catch(() => setSupported(false));
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, router]);

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}><ScanBarcode /> Scan</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Scan a barcode" description="Point the camera at the product barcode.">
          {supported === false ? (
            <Alert tone="info">This browser can&apos;t scan barcodes with the camera. Type the number printed under the barcode instead.</Alert>
          ) : (
            <video ref={video} playsInline muted className="aspect-video w-full rounded-lg bg-black object-cover" aria-label="Camera preview" />
          )}
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const code = manual.trim();
              if (!/^[0-9A-Za-z-]{4,64}$/.test(code)) return;
              setOpen(false);
              router.push(`/inventory?q=${encodeURIComponent(code)}`);
            }}
          >
            <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Barcode number" inputMode="numeric" aria-label="Barcode number" />
            <Button type="submit" variant="secondary">Find</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
