import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FastForward, Maximize2, Minimize2, Pause, Play, Rewind, Volume2, VolumeX } from "lucide-react";
import { downloadMedia } from "@/lib/download";
import { useBackHandler } from "@/lib/back";

interface VideoPlayerProps {
  src: string;
  autoPlay?: boolean;
  /** Affiche un bouton de téléchargement dans la barre de contrôle. */
  downloadable?: boolean;
  className?: string;
  videoClassName?: string;
}

const SPEEDS = [0.5, 1, 1.25, 1.5, 2];
const SKIP_SECONDS = 10;
const DOUBLE_TAP_MS = 260;

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

type OrientationLock = { lock?: (o: string) => Promise<void>; unlock?: () => void };
type WakeLockSentinelLike = { release: () => Promise<void> };

/** Lecteur vidéo Kalchat : lecture/pause, progression, volume, vitesse, double-tap ±10 s, plein écran (avec rotation et écran allumé), téléchargement. */
export function VideoPlayer({ src, autoPlay = false, downloadable = false, className = "", videoClassName = "" }: VideoPlayerProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const tapTimer = useRef<number | undefined>(undefined);
  const lastTap = useRef<{ time: number; side: "left" | "right" | "center" }>({ time: 0, side: "center" });
  const skipTimer = useRef<number | undefined>(undefined);
  const wakeLock = useRef<WakeLockSentinelLike | null>(null);

  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [nativeFs, setNativeFs] = useState(false);
  const [pseudoFs, setPseudoFs] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showVolume, setShowVolume] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [skipFlash, setSkipFlash] = useState<{ side: "left" | "right"; n: number } | null>(null);

  const fullscreen = nativeFs || pseudoFs;

  const revealControls = useCallback(() => {
    setShowControls(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setShowControls(false);
        setShowVolume(false);
      }
    }, 2800);
  }, []);

  // ---------- Écran maintenu allumé pendant la lecture ----------
  const acquireWakeLock = useCallback(async () => {
    try {
      const nav = navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinelLike> } };
      if (!nav.wakeLock || wakeLock.current) return;
      wakeLock.current = await nav.wakeLock.request("screen");
    } catch {
      /* non supporté ou refusé : sans conséquence */
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    const lock = wakeLock.current;
    wakeLock.current = null;
    void lock?.release().catch(() => undefined);
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && videoRef.current && !videoRef.current.paused) void acquireWakeLock();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      releaseWakeLock();
    };
  }, [acquireWakeLock, releaseWakeLock]);

  useEffect(() => () => {
    window.clearTimeout(hideTimer.current);
    window.clearTimeout(tapTimer.current);
    window.clearTimeout(skipTimer.current);
  }, []);

  // ---------- Plein écran ----------
  useEffect(() => {
    const onFs = () => setNativeFs(document.fullscreenElement === wrapRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const lockLandscapeIfWide = useCallback(async () => {
    const v = videoRef.current;
    if (!v || !(v.videoWidth >= v.videoHeight)) return; // une vidéo verticale reste en portrait
    try {
      await (screen.orientation as unknown as OrientationLock)?.lock?.("landscape");
    } catch {
      /* rotation non autorisée dans ce contexte */
    }
  }, []);

  const unlockOrientation = useCallback(() => {
    try {
      (screen.orientation as unknown as OrientationLock)?.unlock?.();
    } catch {
      /* rien à faire */
    }
  }, []);

  const enterFullscreen = useCallback(async () => {
    const el = wrapRef.current;
    if (!el) return;
    let ok = false;
    try {
      if (el.requestFullscreen) {
        await el.requestFullscreen();
        ok = true;
      }
    } catch {
      /* on bascule sur le plein écran « maison » ci-dessous */
    }
    if (!ok) setPseudoFs(true);
    void lockLandscapeIfWide();
  }, [lockLandscapeIfWide]);

  const exitFullscreen = useCallback(async () => {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    setPseudoFs(false);
    unlockOrientation();
  }, [unlockOrientation]);

  // Quitter le plein écran en quittant la page / le lecteur
  useEffect(() => () => {
    if (document.fullscreenElement === wrapRef.current) void document.exitFullscreen().catch(() => undefined);
    unlockOrientation();
  }, [unlockOrientation]);

  // Bouton retour d'Android : sort du plein écran avant de quitter la page
  useBackHandler(() => void exitFullscreen(), fullscreen);

  const toggleFullscreen = () => {
    if (fullscreen) void exitFullscreen();
    else void enterFullscreen();
    revealControls();
  };

  // ---------- Commandes ----------
  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
    revealControls();
  };

  const seek = (value: number) => {
    const v = videoRef.current;
    if (!v || !duration) return;
    v.currentTime = value;
    setCurrent(value);
    revealControls();
  };

  const skip = (side: "left" | "right") => {
    const v = videoRef.current;
    if (!v || !duration) return;
    const delta = side === "right" ? SKIP_SECONDS : -SKIP_SECONDS;
    const next = Math.min(duration, Math.max(0, v.currentTime + delta));
    v.currentTime = next;
    setCurrent(next);
    setSkipFlash((prev) => ({ side, n: prev && prev.side === side ? prev.n + SKIP_SECONDS : SKIP_SECONDS }));
    window.clearTimeout(skipTimer.current);
    skipTimer.current = window.setTimeout(() => setSkipFlash(null), 700);
    revealControls();
  };

  /** Un toucher = lecture/pause ; deux touchers rapides à gauche / à droite = -10 s / +10 s. */
  const onSurfaceTap = (e: React.MouseEvent<HTMLVideoElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / (rect.width || 1);
    const side = x < 0.35 ? "left" : x > 0.65 ? "right" : "center";
    const now = Date.now();
    const prev = lastTap.current;
    if (side !== "center" && prev.side === side && now - prev.time < DOUBLE_TAP_MS) {
      window.clearTimeout(tapTimer.current);
      lastTap.current = { time: now, side }; // permet d'enchaîner plusieurs doubles touchers
      skip(side);
      return;
    }
    lastTap.current = { time: now, side };
    window.clearTimeout(tapTimer.current);
    tapTimer.current = window.setTimeout(togglePlay, side === "center" ? 0 : DOUBLE_TAP_MS);
  };

  const cycleSpeed = () => {
    const v = videoRef.current;
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    if (v) v.playbackRate = next;
    setSpeed(next);
    revealControls();
  };

  const changeVolume = (value: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = value;
    v.muted = value === 0;
    setVolume(value);
    setMuted(value === 0);
    revealControls();
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    if (!v.muted && v.volume === 0) {
      v.volume = 0.6;
      setVolume(0.6);
    }
    revealControls();
  };

  const progress = duration > 0 ? (current / duration) * 100 : 0;
  const controlsVisible = showControls || !playing;

  return (
    <div
      ref={wrapRef}
      onClick={(e) => e.stopPropagation()}
      onMouseMove={revealControls}
      className={`@container group relative overflow-hidden bg-black ${pseudoFs ? "fixed inset-0 z-[400] flex items-center justify-center" : fullscreen ? "flex items-center justify-center" : ""} ${className}`}
    >
      <video
        ref={videoRef}
        src={src}
        autoPlay={autoPlay}
        playsInline
        preload="metadata"
        onClick={onSurfaceTap}
        onPlay={() => { setPlaying(true); revealControls(); void acquireWakeLock(); }}
        onPause={() => { setPlaying(false); setShowControls(true); releaseWakeLock(); }}
        onEnded={() => { setPlaying(false); setShowControls(true); releaseWakeLock(); }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onCanPlay={() => setBuffering(false)}
        className={`block w-full cursor-pointer object-contain ${fullscreen ? "h-full max-h-full" : "max-h-full"} ${fullscreen ? "" : videoClassName}`}
      />

      {/* Gros bouton lecture au centre quand la vidéo est en pause */}
      {!playing && !buffering && (
        <button
          type="button"
          aria-label="Lecture"
          onClick={togglePlay}
          className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary/90 text-primary-foreground shadow-[0_0_30px_var(--glow)] transition active:scale-95"
        >
          <Play className="ml-1 h-7 w-7 fill-current" />
        </button>
      )}

      {buffering && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 animate-spin rounded-full border-4 border-white/25 border-t-primary" />
      )}

      {/* Retour visuel du double-tap : -10 s / +10 s */}
      {skipFlash && (
        <div
          className={`pointer-events-none absolute top-1/2 flex -translate-y-1/2 flex-col items-center gap-1 rounded-full bg-black/55 px-5 py-4 text-white ${skipFlash.side === "left" ? "left-[12%]" : "right-[12%]"}`}
        >
          {skipFlash.side === "left" ? <Rewind className="h-6 w-6 fill-current" /> : <FastForward className="h-6 w-6 fill-current" />}
          <span className="text-xs font-semibold tabular-nums">{skipFlash.side === "left" ? "−" : "+"}{skipFlash.n} s</span>
        </div>
      )}

      {/* Barre de contrôle */}
      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 pb-2 pt-8 transition-opacity duration-200 ${pseudoFs || nativeFs ? "pb-[max(0.5rem,env(safe-area-inset-bottom))]" : ""} ${controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        <input
          type="range"
          aria-label="Progression"
          min={0}
          max={duration || 0}
          step={0.1}
          value={current}
          onChange={(e) => seek(Number(e.target.value))}
          className="kal-range mb-1.5 block h-1 w-full cursor-pointer appearance-none rounded-full"
          style={{ background: `linear-gradient(to right, var(--primary) ${progress}%, rgba(255,255,255,0.28) ${progress}%)` }}
        />
        <div className="flex items-center gap-2 text-white">
          <button type="button" aria-label={playing ? "Pause" : "Lecture"} onClick={togglePlay} className="rounded-full p-1.5 hover:bg-white/15">
            {playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
          </button>
          <span className="text-xs tabular-nums text-white/90">{formatTime(current)} / {formatTime(duration)}</span>
          <div className="flex-1" />
          {/* La vitesse n'apparaît que si le lecteur est assez large (pas dans les petites bulles de message) */}
          <button
            type="button"
            aria-label="Vitesse de lecture"
            onClick={cycleSpeed}
            className="hidden min-w-[2.5rem] rounded-full px-2 py-1 text-xs font-semibold tabular-nums hover:bg-white/15 @xs:block"
          >
            {speed}×
          </button>
          <div className="flex items-center">
            {showVolume && (
              <input
                type="range"
                aria-label="Volume"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => changeVolume(Number(e.target.value))}
                className="kal-range mr-1 h-1 w-16 cursor-pointer appearance-none rounded-full"
                style={{ background: `linear-gradient(to right, var(--primary) ${(muted ? 0 : volume) * 100}%, rgba(255,255,255,0.28) ${(muted ? 0 : volume) * 100}%)` }}
              />
            )}
            <button
              type="button"
              aria-label={muted ? "Activer le son" : "Couper le son"}
              onClick={() => { if (!showVolume) { setShowVolume(true); revealControls(); } else toggleMute(); }}
              className="rounded-full p-1.5 hover:bg-white/15"
            >
              {muted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </button>
          </div>
          {downloadable && (
            <button type="button" aria-label="Télécharger" onClick={() => void downloadMedia(src, "video")} className="rounded-full p-1.5 hover:bg-white/15">
              <Download className="h-5 w-5" />
            </button>
          )}
          <button type="button" aria-label={fullscreen ? "Quitter le plein écran" : "Plein écran"} onClick={toggleFullscreen} className="rounded-full p-1.5 hover:bg-white/15">
            {fullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
