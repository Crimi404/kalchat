/**
 * Compression et mise en format vertical des vidéos K-Short, directement sur le téléphone avant l'envoi.
 *
 * Principe : la vidéo est lue (en silence) dans un élément <video>, chaque image est dessinée dans un <canvas>
 * à la taille voulue, puis le canvas et le son sont réenregistrés par MediaRecorder avec un débit réduit.
 * La durée du traitement est donc égale à la durée de la vidéo (60 s max).
 *
 * Si quoi que ce soit échoue (navigateur trop ancien, lecture bloquée, vidéo qui se fige…), on renvoie
 * la vidéo d'origine : la publication n'est jamais bloquée par le compresseur.
 */

/** Comment mettre la vidéo en vertical (9:16). */
export type VerticalMode = "off" | "crop" | "fit";

export interface CompressOptions {
  /** « crop » recadre pour remplir l'écran, « fit » garde toute l'image avec des bandes noires, « off » garde le format d'origine. */
  vertical: VerticalMode;
  /** Appelé avec 0–100 pendant le traitement. */
  onProgress?: (pct: number) => void;
  /** Permet d'annuler (ex. fermeture de la fenêtre). */
  signal?: AbortSignal;
}

export interface CompressResult {
  file: File;
  /** Vrai si la vidéo a été réencodée ; faux si on renvoie l'originale. */
  processed: boolean;
  /** Raison lisible quand on renvoie l'originale alors qu'un traitement était demandé. */
  reason?: string;
}

// Taille de sortie : 720 × 1280 en vertical ; en « off », le grand côté est limité à 1280 px.
const VERTICAL_W = 720;
const VERTICAL_H = 1280;
const MAX_LONG_SIDE = 1280;
const FPS = 30;
const VIDEO_BPS = 2_500_000; // ~2,5 Mbit/s : bonne qualité pour un téléphone, ~19 Mo pour 60 s
const AUDIO_BPS = 128_000;
const STALL_MS = 15_000; // aucune image traitée pendant 15 s : on abandonne

const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

function pickMime(): string | null {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return null;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

/** Le téléphone sait-il compresser une vidéo ? (MediaRecorder + canvas.captureStream) */
export function canCompressVideo(): boolean {
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas") as HTMLCanvasElement & { captureStream?: unknown };
  return typeof canvas.captureStream === "function" && pickMime() !== null;
}

/** Le serveur compare le type reçu au type annoncé : il doit être exactement « video/mp4 » ou « video/webm ». */
function cleanType(mime: string): "video/mp4" | "video/webm" {
  return mime.startsWith("video/mp4") ? "video/mp4" : "video/webm";
}

function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

function outputSize(srcW: number, srcH: number, vertical: VerticalMode): { w: number; h: number } {
  if (vertical !== "off") return { w: VERTICAL_W, h: VERTICAL_H };
  const ratio = Math.min(1, MAX_LONG_SIDE / Math.max(srcW, srcH));
  return { w: even(srcW * ratio), h: even(srcH * ratio) };
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "auto";
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    v.crossOrigin = "anonymous";
    v.onloadedmetadata = () => resolve(v);
    v.onerror = () => reject(new Error("Impossible de lire cette vidéo"));
    v.src = url;
  });
}

/**
 * Réencode la vidéo (plus légère, et en vertical si demandé).
 * Ne lève jamais d'erreur : en cas de problème, renvoie l'original avec `processed: false`.
 */
export async function compressVideo(file: File, opts: CompressOptions): Promise<CompressResult> {
  const original = (reason: string): CompressResult => ({ file, processed: false, reason });

  const mime = pickMime();
  if (!canCompressVideo() || !mime) return original("Ton téléphone ne sait pas compresser les vidéos");

  const url = URL.createObjectURL(file);
  let video: HTMLVideoElement | null = null;
  let audioCtx: AudioContext | null = null;
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let aborted = false;
  const onAbort = () => {
    aborted = true;
  };
  opts.signal?.addEventListener("abort", onAbort);

  try {
    video = await loadVideo(url);
    const srcW = video.videoWidth;
    const srcH = video.videoHeight;
    if (!srcW || !srcH) return original("Dimensions de la vidéo illisibles");
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;

    const { w, h } = outputSize(srcW, srcH, opts.vertical);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return original("Canvas indisponible");

    // Zone de la vidéo source dessinée dans le canvas
    const draw = () => {
      if (!video) return;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
      if (opts.vertical === "crop") {
        // « cover » : on remplit tout le cadre, en coupant ce qui dépasse (centré)
        const scale = Math.max(w / srcW, h / srcH);
        const sw = w / scale;
        const sh = h / scale;
        ctx.drawImage(video, (srcW - sw) / 2, (srcH - sh) / 2, sw, sh, 0, 0, w, h);
      } else {
        // « contain » : toute l'image visible, bandes noires si besoin (en « off », le cadre a déjà le bon format)
        const scale = Math.min(w / srcW, h / srcH);
        const dw = srcW * scale;
        const dh = srcH * scale;
        ctx.drawImage(video, 0, 0, srcW, srcH, (w - dw) / 2, (h - dh) / 2, dw, dh);
      }
    };

    // Flux : images du canvas + son de la vidéo (sans le faire sortir par le haut-parleur)
    const canvasStream = (canvas as HTMLCanvasElement & { captureStream: (fps?: number) => MediaStream }).captureStream(FPS);
    stream = canvasStream;
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) {
        audioCtx = new AC();
        await audioCtx.resume().catch(() => undefined);
        const src = audioCtx.createMediaElementSource(video);
        const dest = audioCtx.createMediaStreamDestination();
        src.connect(dest); // volontairement PAS relié à audioCtx.destination : silence pendant le traitement
        dest.stream.getAudioTracks().forEach((t) => canvasStream.addTrack(t));
      }
    } catch {
      // Pas de son récupérable : on continue sans (vidéo muette) plutôt que d'échouer
      if (audioCtx) {
        void audioCtx.close().catch(() => undefined);
        audioCtx = null;
      }
    }

    const chunks: Blob[] = [];
    recorder = new MediaRecorder(canvasStream, { mimeType: mime, videoBitsPerSecond: VIDEO_BPS, audioBitsPerSecond: AUDIO_BPS });
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    const stopped = new Promise<void>((resolve, reject) => {
      recorder!.onstop = () => resolve();
      recorder!.onerror = () => reject(new Error("Erreur d'enregistrement"));
    });

    // Dessin image par image, tant que la vidéo joue
    let lastProgressAt = Date.now();
    let finished = false;
    let stalled = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (recorder && recorder.state !== "inactive") recorder.stop();
    };
    const tick = () => {
      if (finished || !video) return;
      if (aborted) return finish();
      draw();
      lastProgressAt = Date.now();
      if (duration > 0) opts.onProgress?.(Math.min(99, Math.round((video.currentTime / duration) * 100)));
      schedule();
    };
    const vfc = (video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback;
    const schedule = () => {
      if (vfc) vfc.call(video, tick);
      else requestAnimationFrame(tick);
    };
    const watchdog = window.setInterval(() => {
      if (finished) return;
      if (aborted || Date.now() - lastProgressAt > STALL_MS) {
        stalled = !aborted;
        finish();
      }
    }, 1000);

    video.onended = finish;
    video.onerror = finish;
    recorder.start(1000);
    draw(); // première image tout de suite
    try {
      await video.play();
    } catch {
      window.clearInterval(watchdog);
      finish();
      await stopped.catch(() => undefined);
      return original("La lecture automatique est bloquée sur ce téléphone");
    }
    schedule();

    await stopped;
    window.clearInterval(watchdog);

    if (aborted) return original("Compression annulée");
    if (stalled) return original("La compression s'est figée");
    if (chunks.length === 0) return original("Aucune donnée produite");

    const type = cleanType(recorder.mimeType || mime);
    const blob = new Blob(chunks, { type });
    if (blob.size < 1024) return original("Fichier produit trop petit");

    // Sans changement de format, on garde l'original s'il est déjà plus léger
    if (opts.vertical === "off" && blob.size >= file.size) {
      opts.onProgress?.(100);
      return original("La vidéo était déjà légère");
    }

    opts.onProgress?.(100);
    const base = file.name.replace(/\.[^.]+$/, "") || "video";
    const ext = type === "video/mp4" ? "mp4" : "webm";
    return { file: new File([blob], `${base}.${ext}`, { type, lastModified: Date.now() }), processed: true };
  } catch (e) {
    return original(e instanceof Error ? e.message : "Compression impossible");
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
    try {
      if (recorder && recorder.state !== "inactive") recorder.stop();
    } catch {
      /* déjà arrêté */
    }
    stream?.getTracks().forEach((t) => t.stop());
    if (video) {
      video.onended = null;
      video.onerror = null;
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    if (audioCtx) void audioCtx.close().catch(() => undefined);
    URL.revokeObjectURL(url);
  }
}
