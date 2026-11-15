"use client";
import Link from "next/link";
import { useState } from "react";
import { Keyboard, Lightbulb, Mic, RotateCcw, Sparkles, Square } from "lucide-react";
import { ProposalList } from "@/components/review/proposal-list";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Alert, Skeleton } from "@/components/ui/feedback";
import { Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { enqueue } from "@/lib/offline/queue";
import type { MemberRole } from "@/lib/domain/types";
import type { ExtractionOutcome } from "@/lib/review-types";
import { cn, newClientId } from "@/lib/utils";
import { useRecorder, type RecorderError } from "./use-recorder";

type Stage = "idle" | "recording" | "transcribing" | "editing" | "interpreting" | "results";
type Source = "browser" | "gemini" | "manual";

const ERRORS: Record<RecorderError, string> = {
  permission: "Microphone access was blocked. Allow the microphone for this site in your browser settings, or type the update instead.",
  unsupported: "This browser can't record audio. Type the update instead.",
  no_device: "No microphone was found on this device.",
  failed: "The microphone couldn't start. Try again or type the update.",
};

const EXAMPLES = [
  "We have three boxes of children's cough syrup left",
  "Four cases of AA batteries arrived today",
  "Two gallons of milk expired yesterday",
  "Sold six bottles of shampoo, one is leaking",
];

function clock(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function VoiceAudit({ role, businessId, serverTranscription, aiProvider }: { role: MemberRole; businessId: string; serverTranscription: boolean; aiProvider: string }) {
  const rec = useRecorder();
  const toast = useToast();
  const [stage, setStage] = useState<Stage>("idle");
  const [transcript, setTranscript] = useState("");
  const [source, setSource] = useState<Source>("manual");
  const [duration, setDuration] = useState<number | null>(null);
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [result, setResult] = useState<(ExtractionOutcome & { transcript: string }) | null>(null);
  const [observedAt, setObservedAt] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  async function startRecording() {
    setError(null);
    setResult(null);
    await rec.start();
    setStage("recording");
  }

  async function stopRecording() {
    const durationMs = rec.elapsed;
    const blob = await rec.stop();
    setDuration(durationMs);
    setObservedAt(new Date().toISOString());
    const live = `${rec.liveText} ${rec.interim}`.trim();
    if (live) {
      setTranscript(live);
      setSource("browser");
      setStage("editing");
      return;
    }
    if (blob && serverTranscription && navigator.onLine) {
      setStage("transcribing");
      try {
        const form = new FormData();
        form.set("audio", blob, "clip");
        const res = await fetch("/api/voice/transcribe", { method: "POST", body: form });
        const body = (await res.json()) as { transcript?: string; audioPath?: string | null; error?: { message: string } };
        if (!res.ok || !body.transcript) throw new Error(body.error?.message ?? "Couldn't transcribe the recording.");
        setTranscript(body.transcript);
        setAudioPath(body.audioPath ?? null);
        setSource("gemini");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't transcribe the recording.");
        setSource("manual");
      }
      setStage("editing");
      return;
    }
    setError(
      serverTranscription
        ? "You're offline, so the recording couldn't be transcribed. Type what you said and it will be saved."
        : "Live transcription isn't available in this browser. Type what you said below.",
    );
    setSource("manual");
    setStage("editing");
  }

  async function interpret() {
    const text = transcript.trim();
    if (text.length < 2) return;
    const clientDraftId = newClientId("voice");
    const payload = { transcript: text, transcriptSource: source, audioPath, durationMs: duration };
    setError(null);

    if (!navigator.onLine) {
      await enqueue({ id: clientDraftId, kind: "voice_draft", businessId, label: `Voice: “${text.slice(0, 60)}${text.length > 60 ? "…" : ""}”`, payload });
      toast({ tone: "info", title: "Saved on this device", description: "You're offline. It will be interpreted when you reconnect, then appear in AI Review. Nothing has changed yet." });
      reset();
      return;
    }

    setStage("interpreting");
    try {
      const res = await fetch("/api/voice/extract", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, clientDraftId }) });
      const body = (await res.json()) as ExtractionOutcome & { transcript: string; duplicate?: boolean; error?: { message: string } };
      if (!res.ok) throw new Error(body.error?.message ?? "Couldn't interpret that.");
      if (body.duplicate) {
        toast({ tone: "info", title: "Already processed", description: "Find it in AI Review." });
        reset();
        return;
      }
      setResult(body);
      setStage("results");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't interpret that.");
      setStage("editing");
    }
  }

  function reset() {
    setStage("idle");
    setTranscript("");
    setResult(null);
    setAudioPath(null);
    setDuration(null);
    setSource("manual");
  }

  const recording = stage === "recording";

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {aiProvider === "local" && stage === "idle" && (
        <Alert tone="info" title="Using built-in language rules">
          Clear commands work best: product, quantity and what happened. The owner can connect Gemini for smarter understanding.
        </Alert>
      )}
      {(rec.error || error) && <Alert tone={rec.error ? "critical" : "warning"}>{rec.error ? ERRORS[rec.error] : error}</Alert>}

      {(stage === "idle" || stage === "recording" || stage === "transcribing") && (
        <Card>
          <CardBody className="flex flex-col items-center gap-6 py-10">
            <div className="flex items-center gap-2 text-sm font-medium" aria-live="polite">
              {recording ? (
                <>
                  <span className="size-2.5 rounded-full bg-critical" aria-hidden />
                  <span className="text-critical">Recording</span>
                  <span className="tabular text-muted">{clock(rec.elapsed)} / {clock(rec.maxMs)}</span>
                </>
              ) : stage === "transcribing" ? (
                <span className="text-muted">Transcribing…</span>
              ) : (
                <span className="text-muted">Tap the microphone and speak naturally</span>
              )}
            </div>

            <button
              type="button"
              onClick={recording ? stopRecording : startRecording}
              disabled={stage === "transcribing"}
              aria-label={recording ? "Stop recording" : "Start recording"}
              aria-pressed={recording}
              className={cn(
                "flex size-32 items-center justify-center rounded-full text-white shadow-pop transition-transform active:scale-95 disabled:opacity-60 sm:size-36",
                recording ? "sp-recording bg-critical" : "bg-primary hover:bg-primary-hover",
              )}
            >
              {recording ? <Square className="size-10 fill-current" /> : <Mic className="size-12" />}
            </button>

            <div className="flex h-12 items-end gap-[3px]" aria-hidden>
              {rec.levels.map((l, i) => (
                <span key={i} className={cn("w-1.5 rounded-full", recording ? "bg-primary" : "bg-border")} style={{ height: `${Math.max(8, l * 100)}%` }} />
              ))}
            </div>

            {recording && (
              <div className="min-h-12 w-full max-w-xl rounded-lg bg-surface-muted px-4 py-3 text-center text-sm" aria-live="polite">
                {rec.liveSupported ? (
                  rec.liveText || rec.interim ? (
                    <>
                      <span>{rec.liveText}</span> <span className="text-muted">{rec.interim}</span>
                    </>
                  ) : (
                    <span className="text-muted">Listening…</span>
                  )
                ) : (
                  <span className="text-muted">Live preview isn&apos;t available in this browser. {serverTranscription ? "We'll transcribe when you stop." : "You'll type it after stopping."}</span>
                )}
              </div>
            )}

            {stage === "idle" && (
              <Button variant="ghost" onClick={() => { setSource("manual"); setStage("editing"); }}>
                <Keyboard /> Type instead
              </Button>
            )}
          </CardBody>
        </Card>
      )}

      {stage === "idle" && (
        <Card>
          <CardBody>
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold"><Lightbulb className="size-4 text-warning" /> Things you can say</p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {EXAMPLES.map((e) => (
                <li key={e} className="rounded-lg border border-border px-3 py-2 text-sm text-muted">“{e}”</li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">Say several products in one go. Say “left” or “on hand” for counts and “arrived” for deliveries, so they&apos;re never confused.</p>
          </CardBody>
        </Card>
      )}

      {(stage === "editing" || stage === "interpreting") && (
        <Card>
          <CardBody className="space-y-4">
            <div>
              <label htmlFor="transcript" className="text-sm font-semibold">What you said</label>
              <p className="text-xs text-muted">Fix any words that were misheard before interpreting.</p>
            </div>
            <Textarea
              id="transcript"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              maxLength={5000}
              className="min-h-32 text-base"
              placeholder="e.g. We have three boxes of children's cough syrup left, and four cases of AA batteries arrived."
              autoFocus={source === "manual"}
            />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button variant="ghost" onClick={reset} disabled={stage === "interpreting"}><RotateCcw /> Start over</Button>
              <Button size="lg" onClick={interpret} loading={stage === "interpreting"} disabled={transcript.trim().length < 2}>
                <Sparkles /> Interpret
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {stage === "interpreting" && (
        <div className="space-y-3" aria-label="Interpreting">
          <Skeleton className="h-36 w-full rounded-xl" />
          <Skeleton className="h-36 w-full rounded-xl" />
        </div>
      )}

      {stage === "results" && result && (
        <div className="space-y-4">
          <Card>
            <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Transcript</p>
                <p className="mt-1 text-sm">“{result.transcript}”</p>
              </div>
              <Button variant="outline" onClick={reset} className="shrink-0"><Mic /> New recording</Button>
            </CardBody>
          </Card>
          {!result.valid ? (
            <Alert tone="critical" title="Couldn't interpret that">{result.error}</Alert>
          ) : result.items.length === 0 ? (
            <Alert tone="warning" title="No inventory changes found">{result.questions[0] ?? "Try naming the product, how many and what happened."}</Alert>
          ) : (
            <>
              <Alert tone="info">Review each change below. Uncheck anything that&apos;s wrong, then apply. Changes that need a manager are kept in <Link href="/review">AI Review</Link>.</Alert>
              <ProposalList initialItems={result.items} role={role} businessId={businessId} observedAt={observedAt} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
