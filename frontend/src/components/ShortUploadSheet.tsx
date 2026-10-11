import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Film, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useBackHandler } from "@/lib/back";
import { fetchShortsStatus, publishShort, readVideoDuration, type ShortItem } from "@/lib/shorts";

const QUICK_DAYS = [1, 7, 30, 60];

/** Publier une vidéo K-Short : fichier, légende, durée de disponibilité (60 jours maximum) et option « aussi dans le fil ». */
export function ShortUploadSheet({ open, onClose, onPublished }: { open: boolean; onClose: () => void; onPublished: (s: ShortItem) => void }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const status = useQuery({ queryKey: ["shortsStatus"], queryFn: fetchShortsStatus, staleTime: 5 * 60_000, retry: false });
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [days, setDays] = useState(30);
  const [inFeed, setInFeed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const maxDays = status.data?.max_days ?? 60;
  const maxMb = status.data?.max_mb ?? 50;
  const maxSeconds = status.data?.max_seconds ?? 60;

  useBackHandler(() => {
    if (!busy) close();
  }, open);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function reset() {
    setFile(null);
    setDuration(null);
    setCaption("");
    setDays(status.data?.default_days ?? 30);
    setInFeed(false);
    setProgress(0);
  }

  function close() {
    if (busy) return;
    reset();
    onClose();
  }

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const formats = status.data?.formats ?? ["video/mp4", "video/webm", "video/quicktime"];
    if (!formats.includes(f.type)) {
      toast.error("Format non accepté (MP4, WebM ou MOV)");
      return;
    }
    if (f.size > maxMb * 1024 * 1024) {
      toast.error(`Vidéo trop lourde (max ${maxMb} Mo)`);
      return;
    }
    try {
      const d = await readVideoDuration(f);
      if (d > maxSeconds + 0.5) {
        toast.error(`Vidéo trop longue (max ${maxSeconds} secondes)`);
        return;
      }
      setDuration(d || null);
    } catch {
      toast.error("Impossible de lire cette vidéo");
      return;
    }
    setFile(f);
  }

  async function submit() {
    if (!file || busy) return;
    setBusy(true);
    setProgress(0);
    try {
      const s = await publishShort({ file, caption: caption.trim(), days, inFeed, duration, onProgress: setProgress });
      toast.success("Vidéo publiée !");
      void qc.invalidateQueries({ queryKey: ["shorts"] });
      onPublished(s);
      reset();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open || typeof document === "undefined") return null;
  const endDate = new Date(Date.now() + days * 86_400_000).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });

  // Affichée dans <body> : sinon le bouton Publier passait sous la barre du bas de l'application
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      <div className="animate-fade-in absolute inset-0 bg-black/60" onClick={close} />
      <div className="animate-sheet-up relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl border-t border-border bg-card p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-base font-bold text-foreground">Publier une vidéo K-Short</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Verticale, {maxSeconds} secondes maximum, {maxMb} Mo maximum.</p>
          </div>
          <button onClick={close} disabled={busy} aria-label="Fermer" className="rounded-full p-1.5 hover:bg-secondary disabled:opacity-50"><X className="h-5 w-5" /></button>
        </div>

        <input ref={inputRef} type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" onChange={pick} />

        {file && preview ? (
          <div className="mt-4 flex items-center gap-3 rounded-2xl border border-border p-2">
            <video src={preview} muted playsInline preload="metadata" className="h-24 w-16 rounded-xl bg-black object-cover" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {(file.size / 1024 / 1024).toFixed(1)} Mo{duration ? ` · ${Math.round(duration)} s` : ""}
              </p>
              <button onClick={() => inputRef.current?.click()} disabled={busy} className="mt-1 text-xs font-semibold text-primary disabled:opacity-50">Changer de vidéo</button>
            </div>
          </div>
        ) : (
          <button onClick={() => inputRef.current?.click()} className="mt-4 flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-8 text-muted-foreground hover:bg-secondary/50">
            <Film className="h-8 w-8" />
            <span className="text-sm font-semibold text-foreground">Choisir une vidéo</span>
          </button>
        )}

        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder="Écris une légende…"
          className="mt-3 w-full resize-none rounded-2xl border border-border bg-background px-4 py-2.5 text-sm text-foreground outline-none focus:border-primary"
        />

        <div className="mt-3 rounded-2xl border border-border p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">Disponible pendant</p>
            <p className="text-sm font-bold text-primary">{days} {days > 1 ? "jours" : "jour"}</p>
          </div>
          <input type="range" min={1} max={maxDays} step={1} value={days} onChange={(e) => setDays(Number(e.target.value))} className="mt-2 w-full accent-primary" aria-label="Durée de disponibilité en jours" />
          <div className="mt-1 flex gap-2">
            {QUICK_DAYS.filter((d) => d <= maxDays).map((d) => (
              <button key={d} onClick={() => setDays(d)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${days === d ? "border-primary bg-primary/15 text-foreground" : "border-border text-muted-foreground"}`}>
                {d} j
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">La vidéo disparaîtra le {endDate}, après quoi elle sera supprimée définitivement. Maximum {maxDays} jours.</p>
        </div>

        <button onClick={() => setInFeed(!inFeed)} aria-pressed={inFeed} className="mt-3 flex w-full items-center gap-3 rounded-2xl border border-border p-3 text-left">
          <span className={`flex h-5 w-5 items-center justify-center rounded-md border ${inFeed ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>{inFeed && <Check className="h-3.5 w-3.5" />}</span>
          <span>
            <span className="block text-sm font-semibold text-foreground">Publier aussi dans le fil « Pour vous »</span>
            <span className="block text-xs text-muted-foreground">C'est la même vidéo : les j'aime et commentaires sont partagés.</span>
          </span>
        </button>

        {busy && (
          <div className="mt-3">
            <div className="h-2 overflow-hidden rounded-full bg-secondary"><div className="brand-gradient h-full transition-all" style={{ width: `${progress}%` }} /></div>
            <p className="mt-1 text-center text-xs text-muted-foreground">{progress < 100 ? `Envoi en cours… ${progress} %` : "Vérification…"}</p>
          </div>
        )}

        <button onClick={() => void submit()} disabled={!file || busy} className="brand-gradient glow-primary mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-primary-foreground disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Publier
        </button>
      </div>
    </div>,
    document.body,
  );
}
