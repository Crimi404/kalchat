import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Download, X } from "lucide-react";
import { useBackHandler } from "@/lib/back";
import { downloadMedia } from "@/lib/download";

export interface ViewerMedia {
  url: string;
  type: "image" | "video";
}

/** Affichage plein écran d'une photo ou d'une vidéo, avec bouton de téléchargement. */
export function MediaViewer({ media, onClose }: { media: ViewerMedia; onClose: () => void }) {
  useBackHandler(onClose, true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex flex-col bg-black/95"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="flex items-center justify-between px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]" onClick={(e) => e.stopPropagation()}>
        <button type="button" aria-label="Fermer" onClick={onClose} className="rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20">
          <X className="h-5 w-5" />
        </button>
        <button type="button" aria-label="Télécharger" onClick={() => void downloadMedia(media.url, media.type)} className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/20">
          <Download className="h-4 w-4" /> Télécharger
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {media.type === "video" ? (
          <video src={media.url} controls autoPlay playsInline onClick={(e) => e.stopPropagation()} className="max-h-full max-w-full rounded-lg" />
        ) : (
          <img src={media.url} alt="" draggable={false} onClick={(e) => e.stopPropagation()} className="max-h-full max-w-full rounded-lg object-contain" />
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Petit utilitaire : `const mv = useMediaViewer();` puis `mv.open(url, "image")` et `{mv.viewer}` dans le rendu. */
export function useMediaViewer(): { open: (url: string, type?: "image" | "video") => void; viewer: ReactNode } {
  const [media, setMedia] = useState<ViewerMedia | null>(null);
  return {
    open: (url, type = "image") => setMedia({ url, type }),
    viewer: media ? <MediaViewer media={media} onClose={() => setMedia(null)} /> : null,
  };
}
