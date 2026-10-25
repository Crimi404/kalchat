import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Clock, Loader2, Search, Smile, Sparkles, X } from "lucide-react";
import { useBackHandler } from "@/lib/back";
import { addRecent, fetchGifs, getRecents, GIF_CATEGORIES, type GifItem, type GifKind } from "@/lib/gifs";
import { EmojiPanel } from "@/components/EmojiPanel";
import { MyStickersPanel } from "@/components/MyStickersPanel";

export type PickerTab = "emoji" | GifKind;

/**
 * Sélecteur Emoji / GIF / Stickers (GIFs et stickers : fournisseur KLIPY).
 * Emoji : s'ajoute au message. GIF ou sticker : un appui l'envoie.
 */
export function GifPicker({ initialKind, onPick, onEmoji, onBackspace, onClose }: { initialKind: PickerTab; onPick: (item: GifItem, kind: GifKind) => void; onEmoji: (emoji: string) => void; onBackspace: () => void; onClose: () => void }) {
  useBackHandler(onClose);
  const [tab, setTab] = useState<PickerTab>(initialKind);
  const kind: GifKind = tab === "gif" ? "gif" : "sticker";
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("trending"); // "trending" | "recent" | "mine" (stickers) | libellé de catégorie
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Recherche : on attend la fin de la frappe
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 400);
    return () => clearTimeout(t);
  }, [search]);

  const catQuery = GIF_CATEGORIES.find((c) => c.label === cat)?.q ?? "";
  const effectiveQ = q || catQuery;
  const showRecent = cat === "recent" && !q;
  const showMine = tab === "sticker" && cat === "mine" && !q;
  const onlineOff = tab === "emoji" || showMine;

  const query = useInfiniteQuery({
    queryKey: ["gifs", kind, effectiveQ],
    enabled: !onlineOff && !showRecent,
    queryFn: ({ pageParam }) => fetchGifs(kind, effectiveQ, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => last.next ?? undefined,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const recents = useMemo(() => (showRecent ? getRecents(kind) : []), [showRecent, kind]);
  const items: GifItem[] = showRecent ? recents : query.data?.pages.flatMap((p) => p.items) ?? [];
  const notConfigured = !showRecent && query.data?.pages[0]?.configured === false;

  // Chargement automatique de la suite quand on arrive en bas
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || showRecent || onlineOff) return;
    const obs = new IntersectionObserver((e) => {
      if (e[0].isIntersecting && query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    }, { root: scrollRef.current, rootMargin: "200px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [query, showRecent, onlineOff]);

  function pick(item: GifItem) {
    addRecent(kind, item);
    onPick(item, kind);
  }

  // GIF : 2 colonnes (chaque image va dans la colonne la moins haute) — Sticker : grille de 3
  const columns = useMemo(() => {
    const n = kind === "gif" ? 2 : 3;
    const cols: GifItem[][] = Array.from({ length: n }, () => []);
    const heights = Array(n).fill(0);
    for (const it of items) {
      const ratio = kind === "gif" && it.width && it.height ? it.height / it.width : 1;
      const i = heights.indexOf(Math.min(...heights));
      cols[i].push(it);
      heights[i] += ratio;
    }
    return cols;
  }, [items, kind]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button type="button" aria-label="Fermer" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div className="animate-fade-in relative flex h-[68vh] w-full max-w-md flex-col rounded-t-3xl border-t border-border bg-card shadow-2xl">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border" />

        <div className="flex items-center gap-2 px-3 pb-2 pt-2.5">
          <div className="flex flex-1 rounded-full bg-secondary p-1" role="tablist">
            {(["emoji", "gif", "sticker"] as const).map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                aria-label={k === "emoji" ? "Emoji" : undefined}
                onClick={() => { setTab(k); setCat("trending"); setSearch(""); setQ(""); scrollRef.current?.scrollTo({ top: 0 }); }}
                className={`flex flex-1 items-center justify-center rounded-full py-1.5 text-sm font-bold transition-colors ${tab === k ? "brand-gradient text-primary-foreground shadow" : "text-muted-foreground"}`}
              >
                {k === "emoji" ? <Smile className="h-5 w-5" /> : k === "gif" ? "GIF" : "Stickers"}
              </button>
            ))}
          </div>
          <button type="button" aria-label="Fermer" onClick={onClose} className="rounded-full p-2 text-muted-foreground hover:bg-secondary"><X className="h-5 w-5" /></button>
        </div>

        {tab === "emoji" ? (
          <EmojiPanel onEmoji={onEmoji} onBackspace={onBackspace} />
        ) : (
          <>
        <div className="px-3">
          <label className="flex items-center gap-2 rounded-full border border-border bg-background px-3.5 focus-within:border-primary">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              maxLength={60}
              placeholder="Search KLIPY"
              className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-foreground outline-none"
            />
            {search && <button type="button" aria-label="Effacer" onClick={() => setSearch("")} className="text-muted-foreground"><X className="h-4 w-4" /></button>}
          </label>
        </div>

        <div className="flex gap-2 overflow-x-auto px-3 py-2.5 [scrollbar-width:none]">
          {[{ id: "trending", label: "Tendance", icon: <Sparkles className="h-3.5 w-3.5" /> }, { id: "recent", label: "Récents", icon: <Clock className="h-3.5 w-3.5" /> }, ...(tab === "sticker" ? [{ id: "mine", label: "Mes stickers", icon: <Sparkles className="h-3.5 w-3.5" /> }] : []), ...GIF_CATEGORIES.map((c) => ({ id: c.label, label: c.label, icon: null }))].map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => { setCat(c.id); setSearch(""); setQ(""); scrollRef.current?.scrollTo({ top: 0 }); }}
              className={`flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold ${cat === c.id && !q ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}
            >
              {c.icon}{c.label}
            </button>
          ))}
        </div>

            {showMine ? (
              <MyStickersPanel onPick={(item) => pick(item)} />
            ) : (
              <>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {notConfigured ? (
            <p className="px-6 py-12 text-center text-sm text-muted-foreground">Les GIFs et les stickers arrivent bientôt sur Kalchat ✨</p>
          ) : query.isLoading && !showRecent ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : query.isError && !showRecent ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              <p>Impossible de charger pour le moment.</p>
              <button type="button" onClick={() => void query.refetch()} className="mt-3 rounded-full border border-border px-4 py-1.5 font-semibold text-foreground">Réessayer</button>
            </div>
          ) : items.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-muted-foreground">{showRecent ? "Tes derniers choix apparaîtront ici." : "Aucun résultat."}</p>
          ) : (
            <div className="flex gap-1.5">
              {columns.map((col, ci) => (
                <div key={ci} className="flex min-w-0 flex-1 flex-col gap-1.5">
                  {col.map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => pick(it)}
                      aria-label={it.title || (kind === "gif" ? "GIF" : "Sticker")}
                      className={`overflow-hidden rounded-xl bg-secondary/50 transition-transform active:scale-95 ${kind === "sticker" ? "aspect-square p-1" : ""}`}
                      style={kind === "gif" && it.width && it.height ? { aspectRatio: `${it.width} / ${it.height}` } : undefined}
                    >
                      <img src={it.preview} alt="" loading="lazy" draggable={false} className={`h-full w-full ${kind === "sticker" ? "object-contain" : "object-cover"}`} />
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
          {!showRecent && <div ref={sentinelRef} className="h-6" />}
          {query.isFetchingNextPage && <div className="flex justify-center py-2"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>}
        </div>

              </>
            )}
          </>
        )}

        {tab !== "emoji" && !showMine && (
        <p className="border-t border-border py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] text-center text-[10px] font-semibold tracking-wide text-muted-foreground">Powered by KLIPY</p>
        )}
      </div>
    </div>
  );
}
