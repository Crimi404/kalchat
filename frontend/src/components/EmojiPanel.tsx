import { useState } from "react";
import { Delete } from "lucide-react";
import { addRecentEmoji, EMOJI_CATEGORIES, getRecentEmojis } from "@/lib/emojis";

/** Onglet « Emoji » du sélecteur : touche un emoji pour l'ajouter à ton message (le sélecteur reste ouvert). */
export function EmojiPanel({ onEmoji, onBackspace }: { onEmoji: (emoji: string) => void; onBackspace: () => void }) {
  const [recents, setRecents] = useState<string[]>(() => getRecentEmojis());
  const [cat, setCat] = useState<string>(() => (getRecentEmojis().length ? "recent" : EMOJI_CATEGORIES[0].id));

  const list = cat === "recent" ? recents : EMOJI_CATEGORIES.find((c) => c.id === cat)?.emojis ?? [];
  const title = cat === "recent" ? "Récents" : EMOJI_CATEGORIES.find((c) => c.id === cat)?.label ?? "";

  function pick(e: string) {
    addRecentEmoji(e);
    setRecents(getRecentEmojis());
    onEmoji(e);
  }

  return (
    <>
      <div className="flex items-center gap-1 px-3 py-2">
        <div className="flex flex-1 gap-1 overflow-x-auto [scrollbar-width:none]">
          {[{ id: "recent", icon: "🕘" }, ...EMOJI_CATEGORIES.map((c) => ({ id: c.id, icon: c.icon }))].map((c) => (
            <button
              key={c.id}
              type="button"
              aria-label={c.id === "recent" ? "Récents" : EMOJI_CATEGORIES.find((x) => x.id === c.id)?.label}
              onClick={() => setCat(c.id)}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg transition-colors ${cat === c.id ? "bg-primary/20 ring-1 ring-primary" : "opacity-70"}`}
            >
              {c.icon}
            </button>
          ))}
        </div>
        <button type="button" onClick={onBackspace} aria-label="Effacer le dernier caractère" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary active:scale-95">
          <Delete className="h-5 w-5" />
        </button>
      </div>
      <p className="px-4 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {list.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-muted-foreground">Tes derniers emojis apparaîtront ici.</p>
        ) : (
          <div className="grid grid-cols-8 gap-0.5">
            {list.map((e) => (
              <button key={e} type="button" onClick={() => pick(e)} className="flex h-11 items-center justify-center rounded-lg text-[26px] leading-none active:scale-90 active:bg-secondary">
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
