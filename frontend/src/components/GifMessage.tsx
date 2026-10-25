import { useState } from "react";
import type { GifKind } from "@/lib/gifs";

export const STICKER_LIFETIME_DAYS = 90;

/** GIF ou sticker dans une bulle. Sticker : masqué après 90 jours. Si le fournisseur ne l'a plus : « indisponible ». */
export function GifMessage({ url, kind, createdAt }: { url: string; kind: GifKind; createdAt: string }) {
  const [failed, setFailed] = useState(false);
  const label = kind === "sticker" ? "✨ Sticker" : "🎞️ GIF";
  const tooOld = kind === "sticker" && Date.now() - new Date(createdAt).getTime() > STICKER_LIFETIME_DAYS * 24 * 60 * 60 * 1000;
  if (tooOld) return <p className="mb-1 text-xs italic opacity-80">✨ Sticker expiré (masqué après {STICKER_LIFETIME_DAYS} jours)</p>;
  if (failed) return <p className="mb-1 text-xs italic opacity-80">{label} indisponible</p>;
  return (
    <img
      src={url}
      alt={kind === "sticker" ? "Sticker" : "GIF"}
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
      className={kind === "sticker" ? "h-36 w-36 object-contain" : "mb-1 max-h-60 w-60 max-w-full rounded-xl object-cover"}
    />
  );
}
