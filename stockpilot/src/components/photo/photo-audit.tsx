"use client";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, CalendarClock, FileText, ImageUp, LayoutGrid, RotateCcw, Sparkles, X } from "lucide-react";
import { ProposalList } from "@/components/review/proposal-list";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Alert, Skeleton } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";
import { enqueue } from "@/lib/offline/queue";
import type { PhotoMode } from "@/lib/ai/schemas";
import type { MemberRole } from "@/lib/domain/types";
import type { ExtractionOutcome } from "@/lib/review-types";
import { cn, newClientId } from "@/lib/utils";
import { prepareImage } from "./image-prep";

const MODES: { value: PhotoMode; label: string; hint: string; icon: typeof Camera }[] = [
  { value: "shelf", label: "Shelf", hint: "Count visible items", icon: LayoutGrid },
  { value: "packing_slip", label: "Packing slip", hint: "Log a delivery", icon: FileText },
  { value: "damage", label: "Damage", hint: "Report damaged goods", icon: AlertTriangle },
  { value: "expiry_label", label: "Expiry label", hint: "Read a date", icon: CalendarClock },
];

type Result = ExtractionOutcome & { imageUrl: string | null; duplicate?: boolean };

export function PhotoAudit({ role, businessId, visionAvailable }: { role: MemberRole; businessId: string; visionAvailable: boolean }) {
  const toast = useToast();
  const [mode, setMode] = useState<PhotoMode>("shelf");
  const [image, setImage] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [liveOpen, setLiveOpen] = useState(false);
  const cameraInput = useRef<HTMLInputElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), []);

  async function accept(file: Blob | null | undefined) {
    if (!file) return;
    setError(null);
    setResult(null);
    try {
      const prepared = await prepareImage(file);
      setImage(prepared);
      setPreview(URL.createObjectURL(prepared));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that image.");
    }
  }

  async function openLiveCamera() {
    setError(null);
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } }, audio: false });
      setLiveOpen(true);
      requestAnimationFrame(() => {
        if (video.current) {
          video.current.srcObject = stream.current;
          void video.current.play();
        }
      });
    } catch {
      // Fall back to the system camera picker (works everywhere, including iOS).
      cameraInput.current?.click();
    }
  }

  function closeLiveCamera() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setLiveOpen(false);
  }

  function snap() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")?.drawImage(v, 0, 0);
    canvas.toBlob((b) => void accept(b), "image/jpeg", 0.92);
    closeLiveCamera();
  }

  async function analyze() {
    if (!image) return;
    const clientDraftId = newClientId("photo");
    if (!navigator.onLine) {
      await enqueue({ id: clientDraftId, kind: "photo_draft", businessId, label: `Photo: ${MODES.find((m) => m.value === mode)?.label}`, payload: { mode } }, image);
      toast({ tone: "info", title: "Photo saved on this device", description: "It will be analyzed when you're back online. Nothing has changed yet." });
      clear();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("image", image, "photo.jpg");
      form.set("mode", mode);
      form.set("clientDraftId", clientDraftId);
      const res = await fetch("/api/photo/analyze", { method: "POST", body: form });
      const body = (await res.json()) as Result & { error?: { message: string } };
      if (!res.ok) throw new Error(body.error?.message ?? "Couldn't analyze the photo.");
      setResult(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't analyze the photo.");
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    setImage(null);
    setPreview(null);
    setResult(null);
    setError(null);
  }

  if (!visionAvailable) {
    return (
      <Alert tone="warning" title="Photo recognition isn't set up">
        Photo audits need a vision AI provider. The owner can add a Gemini API key (see the setup guide), then this page will start working. Voice audits work without it.
      </Alert>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">What are you photographing?</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {MODES.map((m) => (
            <label
              key={m.value}
              className={cn(
                "flex cursor-pointer flex-col gap-1 rounded-xl border bg-surface p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                mode === m.value ? "border-primary bg-primary-soft" : "border-border hover:border-border-strong",
              )}
            >
              <input type="radio" name="mode" value={m.value} checked={mode === m.value} onChange={() => setMode(m.value)} className="sr-only" />
              <m.icon className={cn("size-5", mode === m.value ? "text-primary" : "text-muted")} aria-hidden />
              <span className="text-sm font-semibold">{m.label}</span>
              <span className="text-xs text-muted">{m.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {mode === "shelf" && (
        <Alert tone="info">Shelf photos only show the front of the shelf. StockPilot counts what&apos;s visible and never assumes stock hidden behind it.</Alert>
      )}
      {error && <Alert tone="critical">{error}</Alert>}

      <input ref={cameraInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={(e) => { void accept(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={uploadInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { void accept(e.target.files?.[0]); e.target.value = ""; }} />

      {liveOpen ? (
        <Card className="overflow-hidden">
          <div className="relative bg-black">
            <video ref={video} playsInline muted className="max-h-[60dvh] w-full object-contain" aria-label="Camera preview" />
            <button onClick={closeLiveCamera} className="absolute right-3 top-3 rounded-full bg-black/60 p-2 text-white" aria-label="Close camera"><X className="size-5" /></button>
          </div>
          <CardBody className="flex justify-center">
            <button onClick={snap} className="flex size-16 items-center justify-center rounded-full border-4 border-primary bg-surface" aria-label="Take photo">
              <span className="size-11 rounded-full bg-primary" />
            </button>
          </CardBody>
        </Card>
      ) : !preview ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-4 py-10 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-primary-soft text-primary"><Camera className="size-8" /></div>
            <p className="max-w-sm text-sm text-muted">Hold the phone steady, fill the frame and make sure labels are readable.</p>
            <div className="flex w-full max-w-sm flex-col gap-2 sm:flex-row">
              <Button size="lg" className="flex-1" onClick={openLiveCamera}><Camera /> Take photo</Button>
              <Button size="lg" variant="outline" className="flex-1" onClick={() => uploadInput.current?.click()}><ImageUp /> Upload</Button>
            </div>
          </CardBody>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
          <img src={preview} alt="Photo to analyze" className="max-h-[50dvh] w-full bg-surface-muted object-contain" />
          <CardBody className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button variant="ghost" onClick={clear} disabled={busy}><RotateCcw /> Retake</Button>
            {!result && <Button size="lg" onClick={analyze} loading={busy}><Sparkles /> Analyze photo</Button>}
          </CardBody>
        </Card>
      )}

      {busy && (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      )}

      {result && (
        <div className="space-y-3">
          {result.notes.map((n) => <Alert key={n} tone="info">{n}</Alert>)}
          {!result.valid ? (
            <Alert tone="critical" title="Couldn't read this photo">{result.error}</Alert>
          ) : result.items.length === 0 ? (
            <Alert tone="warning" title="No products recognized">Try a closer, brighter photo with labels facing the camera.</Alert>
          ) : (
            <ProposalList initialItems={result.items} role={role} businessId={businessId} allowClarify={false} />
          )}
        </div>
      )}
    </div>
  );
}
