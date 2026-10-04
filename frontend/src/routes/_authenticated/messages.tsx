import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ChevronRight, Loader2, MailQuestion, MessageSquarePlus, Search, Star } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { useAuth } from "@/lib/auth";
import { useOnline } from "@/lib/presence";
import { BadgeList } from "@/components/KalBadge";
import { MiniAvatar } from "@/components/MiniAvatar";
import { NewChatSheet } from "@/components/NewChatSheet";
import { fetchConversations, previewText } from "@/lib/chat";
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
              <span className="flex min-w-0 items-center gap-1 text-sm font-semibold text-foreground"><span className="truncate">{r.display_name}</span><BadgeList badges={r.badges} size={14} /></span>
            </Link>
            <button disabled={answer.isPending} onClick={() => answer.mutate({ id: r.userId, accept: true })} className="brand-gradient rounded-full px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-60">Accepter</button>
            <button disabled={answer.isPending} onClick={() => answer.mutate({ id: r.userId, accept: false })} className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground disabled:opacity-60">Refuser</button>
          </div>
        ))}
      </div>
    </section>
  );
}

type Filter = "all" | "unread" | "favorites" | "groups";

function MessagesPage() {
  const { user } = useAuth();
  const online = useOnline();
  const [filter, setFilter] = useState<Filter>("all");
  const [term, setTerm] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [showRequests, setShowRequests] = useState(false);
  const q = useQuery({ queryKey: ["conversations", user?.id], queryFn: () => fetchConversations(), enabled: !!user });

  // Les demandes de message reçues sont séparées des conversations
  const incoming = useMemo(() => (q.data ?? []).filter((c) => c.request === "incoming"), [q.data]);
  const all = useMemo(() => (q.data ?? []).filter((c) => c.request !== "incoming"), [q.data]);
  const incomingUnread = incoming.filter((c) => c.unread > 0).length;
  const counts = useMemo(
    () => ({
      unread: all.filter((c) => c.unread > 0).length,
      groups: all.filter((c) => c.isGroup).length,
      favorites: all.filter((c) => c.isFavorite).length,
    }),
    [all],
  );

  const shown = useMemo(() => {
    const t = term.trim().toLowerCase();
    return (showRequests ? incoming : all).filter((c) => {
      if (showRequests) return !t || c.name.toLowerCase().includes(t) || (c.other?.username ?? "").toLowerCase().includes(t);
      if (filter === "unread" && c.unread === 0) return false;
      if (filter === "favorites" && !c.isFavorite) return false;
      if (filter === "groups" && !c.isGroup) return false;
      if (!t) return true;
      return c.name.toLowerCase().includes(t) || (c.other?.username ?? "").toLowerCase().includes(t);
    });
  }, [all, incoming, showRequests, filter, term]);

  const chips: { id: Filter; label: string; count?: number }[] = [
    { id: "all", label: "Toutes" },
    { id: "unread", label: "Non lues", count: counts.unread },
    { id: "favorites", label: "Favoris" },
    { id: "groups", label: "Groupes", count: counts.groups },
  ];

  const emptyText: Record<Filter, string> = {
    all: "Aucune conversation",
    unread: "Aucune conversation non lue",
    favorites: "Aucun favori pour l'instant. Ouvre une conversation puis choisis « Ajouter aux favoris ».",
    groups: "Tu n'es dans aucun groupe. Touche le bouton + pour en créer un.",
  };

  return (
    <div className="app-shell">
      <TopBar title="Messages" subtitle="Conversations" />
      <main className="pb-28">
        {!showRequests && <RequestsPanel />}
        {showRequests ? (
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <button aria-label="Retour" onClick={() => setShowRequests(false)} className="rounded-full p-2 hover:bg-secondary"><ArrowLeft className="h-5 w-5" /></button>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-foreground">Demandes de message</h2>
              <p className="text-xs text-muted-foreground">Ces personnes ne sont pas dans tes abonnés. Elles ne voient pas que tu as lu leur message tant que tu n'as pas accepté.</p>
            </div>
          </div>
        ) : (
          !!incoming.length && (
            <button onClick={() => setShowRequests(true)} className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left hover:bg-secondary/50">
              <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground">
                <MailQuestion className="h-5 w-5" />
                {incomingUnread > 0 && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-primary ring-2 ring-background" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-foreground">Demandes de message ({incoming.length})</span>
                <span className="block truncate text-xs text-muted-foreground">{incomingUnread > 0 ? `${incomingUnread} nouvelle${incomingUnread > 1 ? "s" : ""} demande${incomingUnread > 1 ? "s" : ""}` : "Des personnes que tu ne suis pas t'ont écrit"}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          )
        )}

        <div className="px-4 pt-3">
          <div className="flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-3 py-2 focus-within:border-primary">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Rechercher une conversation…"
              className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>

        {!showRequests && <div className="flex gap-2 overflow-x-auto px-4 py-3">
          {chips.map((c) => {
            const active = filter === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setFilter(c.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${active ? "border-primary/60 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:bg-secondary"}`}
              >
                {c.label}
                {!!c.count && <span className={active ? "text-primary" : "text-muted-foreground"}>{c.count}</span>}
              </button>
            );
          })}
        </div>}

        {q.isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : !shown.length ? (
          <div className="px-6 py-14 text-center">
            <p className="font-semibold text-foreground">{term.trim() ? "Aucun résultat" : showRequests ? "Aucune demande de message" : emptyText[filter].split(".")[0]}</p>
            {!term.trim() && !showRequests && filter === "all" && (
              <p className="mt-1 text-sm text-muted-foreground">Ouvre le profil d'un membre pour lui écrire : s'il ne te suit pas encore, ton message arrive comme une demande. Tu peux aussi créer un groupe avec le bouton +.</p>
            )}
            {!term.trim() && !showRequests && filter !== "all" && emptyText[filter].includes(".") && (
              <p className="mt-1 text-sm text-muted-foreground">{emptyText[filter].split(". ").slice(1).join(". ")}</p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {shown.map((c) => (
              <Link key={c.id} to="/messages/$id" params={{ id: c.id }} className="flex w-full items-center gap-3 px-4 py-3.5 transition-colors hover:bg-secondary/50">
                <span className="relative shrink-0">
                  <MiniAvatar url={c.avatar_url} name={c.name} size={52} group={c.isGroup} />
                  {!c.isGroup && c.other && online.has(c.other.id) && <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-primary ring-2 ring-background" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1 text-sm font-bold text-foreground">
                      <span className="truncate">{c.name}</span>
                      {c.other && <BadgeList badges={c.other.badges} size={14} />}
                      {c.isFavorite && <Star className="h-3.5 w-3.5 shrink-0 fill-current text-primary" aria-label="Favori" />}
                    </span>
                    <span className={`shrink-0 text-[11px] ${c.unread ? "font-semibold text-primary" : "text-muted-foreground"}`}>{c.last_message_at ? timeAgo(c.last_message_at) : ""}</span>
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2">
                    <span className={`truncate text-xs ${c.unread ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{previewText(c, user?.id)}</span>
                    {c.unread > 0 && <span className="brand-gradient flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-bold text-primary-foreground">{c.unread}</span>}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </main>

      {/* Bouton « + » : nouvelle discussion, nouveau groupe… */}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-30 mx-auto flex max-w-md justify-end px-4">
        <button
          aria-label="Nouvelle discussion ou nouveau groupe"
          onClick={() => setNewOpen(true)}
          className="brand-gradient pointer-events-auto flex h-14 w-14 items-center justify-center rounded-2xl text-primary-foreground shadow-lg transition-transform active:scale-95"
        >
          <MessageSquarePlus className="h-6 w-6" />
        </button>
      </div>
      {newOpen && <NewChatSheet onClose={() => setNewOpen(false)} />}

      <BottomNav />
    </div>
  );
}
