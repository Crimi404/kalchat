import { useCallback, useEffect, useRef, useState } from "react";

/** Durée maximale d'un message vocal (secondes). */
export const MAX_VOICE_SECONDS = 120;

/** Choisit un format d'enregistrement supporté (Chrome/Android : webm, Safari/iPhone : mp4). */
function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? "";
}

function extFor(mime: string): string {
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Enregistre un message vocal avec le micro.
 * - start() demande l'accès au micro puis enregistre (2 min max, arrêt automatique)
 * - stop() termine et appelle onFinish(fichier, durée)
 * - cancel() abandonne sans rien envoyer
 */
export function useVoiceRecorder(onFinish: (file: File, durationSeconds: number) => void) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const cancelledRef = useRef(false);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const stop = useCallback(() => {
    const r = recorderRef.current;
    if (r && r.state !== "inactive") r.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    stop();
  }, [stop]);

  const start = useCallback(async () => {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("L'enregistrement vocal n'est pas disponible sur cet appareil");
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      throw new Error("Accès au micro refusé. Autorise le micro pour envoyer un message vocal.");
    }

    const mime = pickMime();
    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    chunksRef.current = [];
    cancelledRef.current = false;
    streamRef.current = stream;
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      clearTimer();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setRecording(false);
      setSeconds(0);

      const duration = Math.min(MAX_VOICE_SECONDS, Math.round((Date.now() - startedAtRef.current) / 1000));
      const baseMime = (recorder.mimeType || mime || "audio/webm").split(";")[0];
      const blob = new Blob(chunksRef.current, { type: baseMime });
      chunksRef.current = [];
      recorderRef.current = null;
      if (cancelledRef.current || duration < 1 || blob.size === 0) return;
      onFinishRef.current(new File([blob], `vocal-${Date.now()}.${extFor(baseMime)}`, { type: baseMime }), duration);
    };

    startedAtRef.current = Date.now();
    recorder.start(250);
    setRecording(true);
    setSeconds(0);
    timerRef.current = window.setInterval(() => {
      const elapsed = (Date.now() - startedAtRef.current) / 1000;
      setSeconds(Math.floor(elapsed));
      if (elapsed >= MAX_VOICE_SECONDS) stop();
    }, 250);
  }, [stop]);

  // Si on quitte la page en plein enregistrement, on coupe le micro proprement
  useEffect(() => () => {
    cancelledRef.current = true;
    clearTimer();
    const r = recorderRef.current;
    if (r && r.state !== "inactive") r.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  return { recording, seconds, start, stop, cancel };
}
