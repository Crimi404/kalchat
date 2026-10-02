import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatDuration } from "@/lib/voice";

/** Lecteur de message vocal : bouton lecture / pause, barre de progression, durée. */
export function VoiceBubble({ src, duration, mine }: { src: string; duration: number | null; mine: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(duration ?? 0);

  useEffect(() => {
    if (duration) setTotal(duration);
  }, [duration]);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (playing) a.pause();
    else void a.play().catch(() => setPlaying(false));
  }

  const pct = total > 0 ? Math.min(100, (current / total) * 100) : 0;
  const track = mine ? "bg-primary-foreground/30" : "bg-foreground/15";
  const fill = mine ? "bg-primary-foreground" : "bg-primary";

  return (
    <div className="mb-1 flex min-w-[11rem] items-center gap-2.5">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrent(0); }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (!duration && Number.isFinite(d)) setTotal(d);
        }}
        hidden
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause" : "Écouter le message vocal"}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${mine ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary text-primary-foreground"}`}
      >
        {playing ? <Pause className="h-4 w-4" fill="currentColor" /> : <Play className="h-4 w-4" fill="currentColor" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className={`h-1.5 w-full overflow-hidden rounded-full ${track}`}>
          <div className={`h-full rounded-full transition-[width] duration-200 ${fill}`} style={{ width: `${pct}%` }} />
        </div>
        <span className={`mt-1 block text-[10px] ${mine ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
          {formatDuration(playing || current > 0 ? current : total)}
        </span>
      </div>
    </div>
  );
}
