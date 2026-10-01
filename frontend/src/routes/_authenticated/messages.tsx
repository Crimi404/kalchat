import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { useAuth } from "@/lib/auth";
import { useOnline } from "@/lib/presence";
import { fetchConversations } from "@/lib/chat";
import { fetchRequests, respondRequest, timeAgo } from "@/lib/social";

export const Route = createFileRoute("/_authenticated/messages")({
  head: () => ({
    meta: [
      { title: "Messages — Kalchat" },
      { name: "description", content: "Tes conversations privées sur Kalchat." },
      { property: "og:title", content: "Messages — Kalchat" },
      { property: "og:description", content: "Tes conversations privées sur Kalchat." },
    ],
  }),
  component: MessagesLayout,
});

function MessagesLayout() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (path !== "/messages") return <Outlet />;
  return <MessagesPage />;
}

function RequestsPanel() {
  const qc = useQueryClient();
  const reqs = useQuery({ queryKey: ["followRequests"], queryFn: fetchRequests });
  const answer = useMutation({
    mutationFn: (v: { id: string; accept: boolean }) => respondRequest(v.id, v.accept),
    onSuccess: (_d, v) => {
      toast.success(v.accept ? "Demande acceptée" : "Demande refusée");
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!reqs.data?.length) return null;
  return (
    <section className="border-b border-border bg-card/40 px-4 py-3">
      <p className="mb-2 text-xs font-semibold text-muted-foreground">Demandes d'abonnement ({reqs.data.length})</p>
      <div className="space-y-2">
        {reqs.data.map((r) => (
          <div key={r.userId} className="flex items-center gap-3">
            <Link to="/u/$username" params={{ username: r.username }} className="flex min-w-0 flex-1 items-center gap-3">
              {r.avatar_url ? (
                <img src={r.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" />
              ) : (
                <span className="brand-gradient flex h-10 w-10 items-center justify-center rounded-full font-bold text-primary-foreground">{r.username.slice(0, 1).toUpperCase()}</span>
              )}
              <span className="truncate text-sm font-semibold text-foreground">@{r.username}</span>
            </Link>
            <button disabled={answer.isPending} onClick={() => answer.mutate({ id: r.userId, accept: true })} className="brand-gradient rounded-full px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-60">Accepter</button>
            <button disabled={answer.isPending} onClick={() => answer.mutate({ id: r.userId, accept: false })} className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground disabled:opacity-60">Refuser</button>
          </div>
        ))}
      </div>
    </section>
  );
}

function MessagesPage() {
  const { user } = useAuth();
  const online = useOnline();
  const q = useQuery({ queryKey: ["conversations", user?.id], queryFn: () => fetchConversations(), enabled: !!user });

  return (
    <div className="app-shell">
      <TopBar title="Messages" subtitle="Conversations privées" />
      <main className="pb-28">
        <RequestsPanel />
        {q.isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : !q.data?.length ? (
          <div className="px-6 py-16 text-center">
            <p className="font-semibold text-foreground">Aucune conversation</p>
            <p className="mt-1 text-sm text-muted-foreground">Abonne-toi à un membre : dès qu'il accepte ta demande, vous pouvez vous écrire.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {q.data.map((c) => c.other && (
              <Link key={c.id} to="/messages/$id" params={{ id: c.id }} className="flex w-full items-center gap-3 px-4 py-3.5 transition-colors hover:bg-secondary/50">
                <span className="relative shrink-0">
                  {c.other.avatar_url ? (
                    <img src={c.other.avatar_url} alt={c.other.display_name} className="h-[52px] w-[52px] rounded-full object-cover" />
                  ) : (
                    <span className="brand-gradient flex h-[52px] w-[52px] items-center justify-center rounded-full text-lg font-bold text-primary-foreground">{c.other.display_name.slice(0, 1).toUpperCase()}</span>
                  )}
                  {online.has(c.other.id) && <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-primary ring-2 ring-background" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-bold text-foreground">{c.other.display_name}</span>
                    <span className={`shrink-0 text-[11px] ${c.unread ? "font-semibold text-primary" : "text-muted-foreground"}`}>{c.last_message_at ? timeAgo(c.last_message_at) : ""}</span>
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2">
                    <span className={`truncate text-xs ${c.unread ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{c.lastMessage ?? "Nouvelle conversation"}</span>
                    {c.unread > 0 && <span className="brand-gradient flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-bold text-primary-foreground">{c.unread}</span>}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </main>
      <BottomNav />
    </div>
  );
}
