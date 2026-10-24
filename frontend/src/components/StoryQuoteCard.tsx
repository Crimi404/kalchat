import { useEffect, useState } from "react";
import { Image as ImageIcon, Play } from "lucide-react";
import type { StoryRef } from "@/lib/chat";
import { resolveFont, resolveTheme } from "@/lib/themes";
import { openStoryById } from "@/lib/stories";

/**
 * Carte « Réponse à une story » (comme sur WhatsApp) : nom de l'auteur, aperçu de la story et mini-image.
 * Quand la story expire, la mini-image (et le texte d'une story texte) devient floue.
 */
export function StoryQuoteCard({ story, mine, meId }: { story: StoryRef; mine: boolean; meId: string }) {
  const expiry = new Date(story.expires_at).getTime();
  const [expired, setExpired] = useState(() => Date.now() >= expiry);
  useEffect(() => {
    if (expired) return;
    const ms = expiry - Date.now();
    if (ms > 2_000_000_000) return; // au-delà de ~23 jours : on laisse la prochaine ouverture recalculer
    const t = setTimeout(() => setExpired(true), ms + 500);
    return () => clearTimeout(t);
  }, [expired, expiry]);

  const fromMe = story.author_id === meId;
  const title = `${fromMe ? "Vous" : story.author_name || "Story"} • Story`;
  const theme = resolveTheme(story.theme) ?? resolveTheme("kalchat");
  const blur = expired ? "blur-[5px] scale-110" : "";

  let thumb: React.ReactNode;
  if (story.thumb) {
    thumb = <img src={story.thumb} alt="" draggable={false} className={`h-full w-full object-cover transition-all duration-500 ${blur}`} />;
  } else if (story.kind === "text") {
    thumb = (
      <span
        className={`flex h-full w-full items-center justify-center p-1 text-center text-[9px] font-semibold leading-tight transition-all duration-500 ${blur}`}
        style={{ background: theme?.background, color: theme?.color, fontFamily: resolveFont(story.font) }}
      >
        <span className="line-clamp-4 break-words">{story.text}</span>
      </span>
    );
  } else {
    thumb = (
      <span className={`flex h-full w-full items-center justify-center bg-black/25 text-white/80 transition-all duration-500 ${blur}`}>
        {story.kind === "video" ? <Play className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
      </span>
    );
  }

  const line =
    story.kind === "text" ? story.text || "Story" : `${story.kind === "video" ? "🎥 Vidéo" : "📷 Photo"}${story.text ? ` · ${story.text}` : ""}`;

  // Story encore disponible : un appui l'ouvre. Expirée : la carte reste en souvenir mais n'est plus cliquable.
  return (
    <button
      type="button"
      disabled={expired}
      aria-label={expired ? "Story expirée" : "Ouvrir la story"}
      onClick={() => openStoryById(story.id)}
      className={`mb-1.5 flex w-full min-w-[13rem] max-w-full overflow-hidden rounded-lg border-l-4 text-left text-xs ${expired ? "cursor-default" : "transition-opacity active:opacity-70"} ${mine ? "border-primary-foreground/70 bg-primary-foreground/15" : "border-primary bg-background/50"}`}
    >
      <div className="min-w-0 flex-1 px-2 py-1.5">
        <span className="block truncate font-semibold">{title}</span>
        <span className={`block truncate opacity-90 transition-all duration-500 ${expired && story.kind === "text" ? "select-none blur-[4px]" : ""}`}>{line}</span>
      </div>
      <div className="h-14 w-14 shrink-0 overflow-hidden">{thumb}</div>
    </button>
  );
}
