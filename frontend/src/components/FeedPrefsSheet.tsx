import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { CATEGORIES, DEFAULT_CATEGORY, fetchMutedCategories, muteCategory, unmuteCategory } from "@/lib/categories";

/** Personnaliser « Pour vous » : choisir les sujets qu'on veut voir dans son fil. */
export function FeedPrefsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const muted = useQuery({ queryKey: ["mutedCategories"], queryFn: fetchMutedCategories, enabled: open });
  const toggle = useMutation({
    mutationFn: async ({ key, mute }: { key: string; mute: boolean }) => (mute ? muteCategory(key) : unmuteCategory(key)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["mutedCategories"] });
      void qc.invalidateQueries({ queryKey: ["feed"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!open) return null;
  const hidden = new Set(muted.data ?? []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onClose}>
      <div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-border bg-card p-4 pb-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-base font-bold text-foreground">Personnaliser « Pour vous »</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Choisis les sujets que tu veux voir. Les sujets décochés disparaissent de ton fil (tu les retrouves toujours dans Explorer).</p>
          </div>
          <button onClick={onClose} aria-label="Fermer" className="rounded-full p-1.5 hover:bg-secondary"><X className="h-5 w-5" /></button>
        </div>
        {muted.isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            {CATEGORIES.filter((c) => c.value !== DEFAULT_CATEGORY).map((c) => {
              const shown = !hidden.has(c.value);
              return (
                <button
                  key={c.value}
                  disabled={toggle.isPending}
                  aria-pressed={shown}
                  onClick={() => toggle.mutate({ key: c.value, mute: shown })}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${shown ? "border-primary bg-primary/15 text-foreground" : "border-border bg-secondary/40 text-muted-foreground line-through"}`}
                >
                  <span>{c.emoji}</span> {c.label} {shown && <Check className="h-3.5 w-3.5 text-primary" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
