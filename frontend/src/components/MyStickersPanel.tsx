import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { StickerCreator } from "@/components/StickerCreator";
import { deleteMySticker, fetchMyStickers } from "@/lib/stickers";
import type { GifItem } from "@/lib/gifs";

/** « Mes stickers » : ceux que tu as créés, avec le bouton pour en créer un nouveau. */
export function MyStickersPanel({ onPick }: { onPick: (item: GifItem) => void }) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: ["myStickers"], queryFn: fetchMyStickers, staleTime: 60 * 1000 });

  const remove = useMutation({
    mutationFn: (id: string) => deleteMySticker(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["myStickers"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const list = q.data?.stickers ?? [];
  const full = list.length >= (q.data?.max ?? 40);

  return (
    <>
      <div className="flex items-center justify-between px-4 pb-1 pt-0.5">
        <p className="text-xs text-muted-foreground">{list.length} / {q.data?.max ?? 40} stickers</p>
        {list.length > 0 && (
          <button type="button" onClick={() => setEditing((v) => !v)} className="text-xs font-bold text-primary">{editing ? "Terminé" : "Modifier"}</button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {q.isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              disabled={full}
              onClick={() => setCreating(true)}
              className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 text-primary disabled:opacity-40"
            >
              <Plus className="h-7 w-7" />
              <span className="text-[11px] font-bold">Créer</span>
            </button>
            {list.map((s) => (
              <div key={s.id} className="relative aspect-square">
                <button
                  type="button"
                  onClick={() => (editing ? undefined : onPick({ id: s.id, title: "", url: s.url, preview: s.url, width: 512, height: 512 }))}
                  className="h-full w-full overflow-hidden rounded-xl bg-secondary/50 p-1 transition-transform active:scale-95"
                  aria-label="Envoyer ce sticker"
                >
                  <img src={s.url} alt="" loading="lazy" draggable={false} className="h-full w-full object-contain" />
                </button>
                {editing && (
                  <button type="button" aria-label="Supprimer ce sticker" disabled={remove.isPending} onClick={() => remove.mutate(s.id)} className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white shadow">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {!q.isLoading && list.length === 0 && <p className="px-6 pt-6 text-center text-sm text-muted-foreground">Crée ton premier sticker à partir d'une photo de ton téléphone.</p>}
        {full && <p className="px-6 pt-3 text-center text-xs text-muted-foreground">Limite atteinte : supprime un sticker pour en créer un nouveau.</p>}
      </div>
      {creating && <StickerCreator onClose={() => setCreating(false)} onCreated={() => { setCreating(false); void qc.invalidateQueries({ queryKey: ["myStickers"] }); }} />}
    </>
  );
}
