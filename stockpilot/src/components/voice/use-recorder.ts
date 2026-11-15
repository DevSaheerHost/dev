"use client";
import { useCallback, useEffect, useRef, useState } from "react";

const MAX_MS = 120_000;
const MIME_PREFERENCES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type RecorderError = "permission" | "unsupported" | "no_device" | "failed";

/** Microphone recording with a live level meter and (where available) live transcription. */
export function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [liveText, setLiveText] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<RecorderError | null>(null);
  const [levels, setLevels] = useState<number[]>(() => new Array(32).fill(0));
  const liveSupported = getSpeechRecognition() !== null;

  const media = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const raf = useRef<number | null>(null);
  const started = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const resolveStop = useRef<((b: Blob | null) => void) | null>(null);
  const finalText = useRef("");

  const cleanup = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    if (timer.current) clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    void audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
    stream.current = null;
    setLevels(new Array(32).fill(0));
  }, []);

  useEffect(() => () => {
    recognition.current?.stop();
    if (media.current?.state === "recording") media.current.stop();
    cleanup();
  }, [cleanup]);

  const stop = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      recognition.current?.stop();
      recognition.current = null;
      if (!media.current || media.current.state !== "recording") {
        cleanup();
        setRecording(false);
        resolve(null);
        return;
      }
      resolveStop.current = resolve;
      media.current.stop();
    });
  }, [cleanup]);

  const start = useCallback(async () => {
    setError(null);
    setLiveText("");
    setInterim("");
    finalText.current = "";
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("unsupported");
      return;
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      const name = (e as DOMException).name;
      setError(name === "NotAllowedError" || name === "SecurityError" ? "permission" : name === "NotFoundError" ? "no_device" : "failed");
      return;
    }

    const mimeType = MIME_PREFERENCES.find((m) => MediaRecorder.isTypeSupported(m));
    const recorder = new MediaRecorder(stream.current, mimeType ? { mimeType, audioBitsPerSecond: 32_000 } : undefined);
    chunks.current = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    recorder.onstop = () => {
      const blob = chunks.current.length ? new Blob(chunks.current, { type: recorder.mimeType || "audio/webm" }) : null;
      cleanup();
      setRecording(false);
      resolveStop.current?.(blob);
      resolveStop.current = null;
    };
    media.current = recorder;
    recorder.start(1000);

    // Level meter
    const ctx = new AudioContext();
    audioCtx.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    ctx.createMediaStreamSource(stream.current).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      setLevels(Array.from(data.slice(0, 32), (v) => v / 255));
      raf.current = requestAnimationFrame(tick);
    };
    tick();

    // Live transcription (Chrome/Edge/Safari). Audio still records either way.
    const SR = getSpeechRecognition();
    if (SR) {
      const rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = navigator.language || "en-US";
      rec.onresult = (e) => {
        let interimText = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText.current = `${finalText.current} ${r[0].transcript}`.trim();
          else interimText += r[0].transcript;
        }
        setLiveText(finalText.current);
        setInterim(interimText);
      };
      rec.onerror = () => {};
      rec.onend = () => {
        // Some browsers end recognition after silence; restart while still recording.
        if (media.current?.state === "recording" && recognition.current === rec) {
          try { rec.start(); } catch {}
        }
      };
      recognition.current = rec;
      try { rec.start(); } catch {}
    }

    started.current = Date.now();
    setElapsed(0);
    timer.current = setInterval(() => {
      const ms = Date.now() - started.current;
      setElapsed(ms);
      if (ms >= MAX_MS) void stop();
    }, 250);
    setRecording(true);
  }, [cleanup, stop]);

  return { start, stop, recording, elapsed, liveText, interim, levels, error, liveSupported, maxMs: MAX_MS };
}
