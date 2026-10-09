import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Maximize2, Minimize2, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { downloadMedia } from "@/lib/download";

interface VideoPlayerProps {
  src: string;
  autoPlay?: boolean;
  /** Affiche un bouton de téléchargement dans la barre de contrôle. */
  downloadable?: boolean;
  /** Si fourni, le bouton « plein écran » appelle cette fonction (ex. ouvrir le MediaViewer) au lieu du plein écran natif. */
  onExpand?: () => void;
  className?: string;
  videoClassName?: string;
}

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/** Lecteur vidéo Kalchat : lecture/pause, progression, volume, plein écran, téléchargement. */
export function VideoPlayer({ src, autoPlay = false, downloadable = false, onExpand, className = "", videoClassName = "" }: VideoPlayerProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);

  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showVolume, setShowVolume] = useState(false);
  const [buffering, setBuffering] = useState(false);

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

  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

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

  const toggleFullscreen = () => {
    if (onExpand) {
      onExpand();
      return;
    }
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void el.requestFullscreen?.().catch(() => undefined);
    revealControls();
  };

  const progress = duration > 0 ? (current / duration) * 100 : 0;
  const controlsVisible = showControls || !playing;

  return (
    <div
      ref={wrapRef}
      onClick={(e) => e.stopPropagation()}
      onMouseMove={revealControls}
      className={`group relative overflow-hidden bg-black ${fullscreen ? "flex items-center justify-center" : ""} ${className}`}
    >
      <video
        ref={videoRef}
        src={src}
        autoPlay={autoPlay}
        playsInline
        preload="metadata"
        onClick={togglePlay}
        onPlay={() => { setPlaying(true); revealControls(); }}
        onPause={() => { setPlaying(false); setShowControls(true); }}
        onEnded={() => { setPlaying(false); setShowControls(true); }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onCanPlay={() => setBuffering(false)}
        className={`block max-h-full w-full cursor-pointer object-contain ${videoClassName}`}
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

      {/* Barre de contrôle */}
      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 pb-2 pt-8 transition-opacity duration-200 ${controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"}`}
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
