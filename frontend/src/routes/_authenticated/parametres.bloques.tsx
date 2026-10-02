import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { BadgeList } from "@/components/KalBadge";
import { MiniAvatar } from "@/components/MiniAvatar";
import { SettingsShell } from "@/components/SettingsShell";
import { fetchBlocked, unblockUser } from "@/lib/settings";

export const Route = createFileRoute("/_authenticated/parametres/bloques")({
  head: () => ({ meta: [{ title: "Comptes bloqués — Kalchat" }] }),
  component: BlockedPage,
});

function BlockedPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["blocked"], queryFn: fetchBlocked });
  const unblock = useMutation({
    mutationFn: (username: string) => unblockUser(username),
    onSuccess: () => {
      toast.success("Compte débloqué");
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <SettingsShell title="Comptes bloqués">
      <p className="px-1 text-xs leading-snug text-muted-foreground">
        Un compte bloqué ne peut plus te suivre, t'écrire ni te notifier, et vous ne voyez plus vos publications respectives. Vos abonnements sont supprimés au moment du blocage.
      </p>
      {q.isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : !q.data?.length ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Tu n'as bloqué aucun compte.</p>
      ) : (
        <section className="rounded-2xl border border-border bg-card p-2">
          {q.data.map((u) => (
            <div key={u.id} className="flex items-center gap-3 rounded-2xl px-2 py-2.5">
              <Link to="/u/$username" params={{ username: u.username }} className="flex min-w-0 flex-1 items-center gap-3">
                <MiniAvatar url={u.avatar_url} name={u.display_name} size={44} />
                <span className="min-w-0">
                  <span className="flex items-center gap-1 text-sm font-semibold text-foreground"><span className="truncate">{u.display_name}</span><BadgeList badges={u.badges} size={14} /></span>
                  <span className="block truncate text-xs text-muted-foreground">@{u.username}</span>
                </span>
              </Link>
              <button disabled={unblock.isPending} onClick={() => unblock.mutate(u.username)} className="shrink-0 rounded-full border border-border px-4 py-1.5 text-xs font-bold text-foreground hover:bg-secondary disabled:opacity-60">
                Débloquer
              </button>
            </div>
          ))}
        </section>
      )}
    </SettingsShell>
  );
}
