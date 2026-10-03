import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SettingsShell } from "@/components/SettingsShell";
import { categoryOf, fetchMutedCategories, unmuteCategory } from "@/lib/categories";

export const Route = createFileRoute("/_authenticated/parametres/sujets")({
  head: () => ({ meta: [{ title: "Sujets masqués — Kalchat" }] }),
  component: MutedTopicsPage,
});

function MutedTopicsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["mutedCategories"], queryFn: fetchMutedCategories });
  const unmute = useMutation({
    mutationFn: (key: string) => unmuteCategory(key),
    onSuccess: () => {
      toast.success("Sujet de nouveau visible dans ton fil");
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <SettingsShell title="Sujets masqués">
      <p className="px-1 text-xs leading-snug text-muted-foreground">
        Les publications de ces catégories n'apparaissent plus dans ton fil. Tu peux toujours les retrouver dans Explorer, ou en rouvrir un sujet ici.
      </p>
      {q.isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : !q.data?.length ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Tu n'as masqué aucun sujet.</p>
      ) : (
        <section className="rounded-2xl border border-border bg-card p-2">
          {q.data.map((key) => {
            const c = categoryOf(key);
            return (
              <div key={key} className="flex items-center gap-3 rounded-2xl px-2 py-2.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-lg">{c.emoji}</span>
                <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">{c.label}</span>
                <button disabled={unmute.isPending} onClick={() => unmute.mutate(key)} className="shrink-0 rounded-full border border-border px-4 py-1.5 text-xs font-bold text-foreground hover:bg-secondary disabled:opacity-60">
                  Afficher à nouveau
                </button>
              </div>
            );
          })}
        </section>
      )}
    </SettingsShell>
  );
}
