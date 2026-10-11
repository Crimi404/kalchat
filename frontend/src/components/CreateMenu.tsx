import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Image, CircleDot, Type, Video, X } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useBackHandler } from "@/lib/back";
import { fetchShortsStatus, type ShortItem } from "@/lib/shorts";
import { ShortUploadSheet } from "@/components/ShortUploadSheet";

type Kind = "photo" | "text" | "video" | "story";

const options: { kind: Kind; icon: typeof Image; label: string; sub: string }[] = [
  { kind: "photo", icon: Image, label: "Photo", sub: "Publier" },
  { kind: "text", icon: Type, label: "Texte", sub: "Écrire un post" },
  { kind: "video", icon: Video, label: "Vidéo", sub: "K-Short" },
  { kind: "story", icon: CircleDot, label: "Story", sub: "24 h" },
];

export function CreateMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  useBackHandler(onClose, open);
  const navigate = useNavigate();
  const [videoOpen, setVideoOpen] = useState(false);
  // L'option Vidéo n'apparaît que si K-Short est activé sur le serveur
  const status = useQuery({ queryKey: ["shortsStatus"], queryFn: fetchShortsStatus, staleTime: 5 * 60_000, retry: false });
  const shortsOn = status.data?.enabled === true;
  const visible = options.filter((o) => o.kind !== "video" || shortsOn);

  function choose(kind: Kind) {
    onClose();
    if (kind === "video") setVideoOpen(true);
    else if (kind === "story") navigate({ to: "/story" });
    else navigate({ to: "/nouveau" });
  }

  // Après la publication, on ouvre l'onglet K-Short sur la vidéo qu'on vient de publier
  function onPublished(s: ShortItem) {
    try { sessionStorage.setItem("kalchat:feedTab", "shorts"); } catch { /* stockage indisponible : on ignore */ }
    window.dispatchEvent(new CustomEvent("kalchat:open-short", { detail: s.id }));
    navigate({ to: "/" });
  }

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div className="animate-fade-in absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <div className="animate-sheet-up relative w-full max-w-md rounded-t-3xl border-t border-border bg-card p-6 pb-10">
            <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-muted" />
            <div className={`grid gap-2 ${visible.length === 4 ? "grid-cols-4" : "grid-cols-3"}`}>
              {visible.map((opt) => (
                <button
                  key={opt.kind}
                  onClick={() => choose(opt.kind)}
                  className="flex flex-col items-center gap-2 rounded-2xl bg-secondary/60 px-1 py-4 transition-transform active:scale-95 hover:bg-secondary"
                >
                  <span className="brand-gradient flex h-11 w-11 items-center justify-center rounded-full text-primary-foreground">
                    <opt.icon className="h-5 w-5" />
                  </span>
                  <span className="text-xs font-semibold text-foreground">{opt.label}</span>
                  <span className="text-[10px] text-muted-foreground">{opt.sub}</span>
                </button>
              ))}
            </div>
            <button
              onClick={onClose}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-secondary py-3 text-sm font-semibold text-secondary-foreground transition-colors hover:bg-accent"
            >
              <X className="h-4 w-4" /> Annuler
            </button>
          </div>
        </div>
      )}
      <ShortUploadSheet open={videoOpen} onClose={() => setVideoOpen(false)} onPublished={onPublished} />
    </>
  );
}
