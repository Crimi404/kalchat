import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { MiniAvatar } from "@/components/MiniAvatar";
import { TopBar } from "@/components/TopBar";
import { fetchInvitePreview, joinGroupByInvite } from "@/lib/chat";

export const Route = createFileRoute("/_authenticated/groupe/$token")({
  head: () => ({ meta: [{ title: "Invitation à un groupe — Kalchat" }] }),
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const preview = useQuery({ queryKey: ["invite", token], queryFn: () => fetchInvitePreview(token), retry: false });

  const join = useMutation({
    mutationFn: () => joinGroupByInvite(token),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      toast.success("Tu as rejoint le groupe");
      void navigate({ to: "/messages/$id", params: { id: r.conversation_id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="app-shell">
      <TopBar title="Invitation" />
      <main className="flex flex-col items-center gap-4 px-6 py-12 text-center">
        {preview.isLoading ? (
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        ) : preview.isError ? (
          <>
            <p className="text-base font-bold text-foreground">Lien invalide ou expiré</p>
            <p className="text-sm text-muted-foreground">{(preview.error as Error).message}</p>
            <Link to="/messages" className="rounded-full border border-border px-5 py-2 text-sm font-semibold hover:bg-secondary">Mes messages</Link>
          </>
        ) : (
          <>
            <MiniAvatar url={preview.data.avatar_url} name={preview.data.name} size={96} group />
            <div>
              <h1 className="text-xl font-bold text-foreground">{preview.data.name}</h1>
              <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
                <Users className="h-4 w-4" /> {preview.data.member_count} membre{preview.data.member_count > 1 ? "s" : ""}
              </p>
            </div>
            {preview.data.is_member ? (
              <Link to="/messages/$id" params={{ id: preview.data.id }} className="brand-gradient glow-primary w-full max-w-xs rounded-xl py-3 text-sm font-bold text-primary-foreground">
                Ouvrir le groupe
              </Link>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Tu as été invité(e) à rejoindre ce groupe.</p>
                <button disabled={join.isPending} onClick={() => join.mutate()} className="brand-gradient glow-primary flex w-full max-w-xs items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-primary-foreground disabled:opacity-60">
                  {join.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Rejoindre le groupe
                </button>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
