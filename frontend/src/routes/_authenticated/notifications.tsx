import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, Loader2, MoreVertical, ShieldAlert, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { MiniAvatar } from "@/components/MiniAvatar";
import { api, toBadges } from "@/lib/api";
import { BadgeList } from "@/components/KalBadge";
import { useAuth } from "@/lib/auth";
import { respondRequest, timeAgo } from "@/lib/social";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — Kalchat" },
      { name: "description", content: "Tes notifications Kalchat : abonnés, mentions, likes, messages et avis de modération." },
      { property: "og:title", content: "Notifications — Kalchat" },
      { property: "og:description", content: "Tes notifications Kalchat." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NotificationsPage,
});

interface RawNotif {
  id: string;
  type: string;
  body: string | null;
  conversation_id: string | null;
  post_id: string | null;
  is_read: number | boolean;
  created_at: string;
  actor_id: string;
  actor_username: string;
  actor_avatar_url: string | null;
  actor_badge: string | null;
  actor_role: string | null;
  follow_status: "pending" | "accepted" | null;
}

type Tab = "all" | "requests" | "mentions" | "likes" | "comments";

const TABS: { id: Tab; label: string; types: string[] }[] = [
  { id: "all", label: "Tout", types: [] },
  { id: "requests", label: "Demandes", types: ["follow_request"] },
  { id: "mentions", label: "Mentions", types: ["mention"] },
  { id: "likes", label: "J'aime", types: ["like", "comment_like"] },
  { id: "comments", label: "Commentaires", types: ["comment", "reply"] },
];

const EMPTY: Record<Tab, string> = {
  all: "Aucune notification.",
  requests: "Aucune demande d'abonnement.",
  mentions: "Personne ne t'a mentionné pour l'instant. Quand quelqu'un écrit @ton_pseudo, ça apparaît ici.",
  likes: "Aucun like pour l'instant.",
  comments: "Aucun commentaire pour l'instant.",
};

function textFor(n: RawNotif): string {
  switch (n.type) {
    case "like": return "a aimé ta publication";
    case "comment": return "a commenté ta publication";
    case "reply": return "a répondu à ton commentaire";
    case "comment_like": return "a aimé ton commentaire";
    case "share": return "a repartagé ta publication";
    case "mention": return n.body === "comment" ? "t'a mentionné dans un commentaire" : "t'a mentionné dans une publication";
    case "follow_request": return "t'a envoyé une demande d'abonnement";
    case "follow_accept": return "a accepté ta demande d'abonnement";
    case "message": return "t'a envoyé un message";
    case "group_add": return "t'a ajouté à un groupe";
    default: return "";
  }
}

function NotificationsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("all");
  const [menuOpen, setMenuOpen] = useState(false);

  const q = useQuery({
    queryKey: ["notifications", user?.id],
    enabled: !!user,
    queryFn: () => api<RawNotif[]>("/notifications"),
  });

  function refreshAll() {
    void qc.invalidateQueries({ queryKey: ["notifications"] });
    void qc.invalidateQueries({ queryKey: ["notifUnread"] });
    void qc.invalidateQueries({ queryKey: ["followRequests"] });
  }

  // À l'ouverture de la page, tout est marqué comme lu (les lignes non lues restent surlignées jusqu'au prochain rafraîchissement)
  useEffect(() => {
    if (!user || !q.data?.some((n) => !n.is_read)) return;
    void api("/notifications/read-all", { method: "POST" }).then(() => qc.invalidateQueries({ queryKey: ["notifUnread"] }));
  }, [q.data, user, qc]);

  const markAllRead = useMutation({
    mutationFn: () => api("/notifications/read-all", { method: "POST" }),
    onSuccess: () => { toast.success("Tout est marqué comme lu"); refreshAll(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const removeOne = useMutation({
    mutationFn: (id: string) => api(`/notifications/${id}`, { method: "DELETE" }),
    onSuccess: refreshAll,
    onError: (e: Error) => toast.error(e.message),
  });
  const removeMany = useMutation({
    mutationFn: (onlyRead: boolean) => api(`/notifications${onlyRead ? "?read=1" : ""}`, { method: "DELETE" }),
    onSuccess: (_d, onlyRead) => { toast.success(onlyRead ? "Notifications lues supprimées" : "Notifications supprimées"); refreshAll(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const respond = useMutation({
    mutationFn: ({ actorId, accept }: { actorId: string; accept: boolean }) => respondRequest(actorId, accept),
    onSuccess: (_d, v) => { toast.success(v.accept ? "Demande acceptée" : "Demande refusée"); refreshAll(); void qc.invalidateQueries({ queryKey: ["conversations"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const all = q.data ?? [];
  const counts = useMemo(() => {
    const out: Record<Tab, number> = { all: 0, requests: 0, mentions: 0, likes: 0, comments: 0 };
    for (const n of all) {
      if (!n.is_read) out.all++;
      for (const t of TABS) if (t.types.includes(n.type) && (t.id === "requests" ? n.follow_status === "pending" : !n.is_read)) out[t.id]++;
    }
    return out;
  }, [all]);

  const shown = useMemo(() => {
    const types = TABS.find((t) => t.id === tab)!.types;
    return types.length ? all.filter((n) => types.includes(n.type)) : all;
  }, [all, tab]);

  const hasDeletable = all.some((n) => n.type !== "moderation");
  const hasRead = all.some((n) => n.type !== "moderation" && n.is_read);

  return (
    <div className="app-shell">
      <TopBar title="Notifications" />
      <div className="relative flex items-center gap-2 border-b border-border">
        <div className="flex flex-1 gap-2 overflow-x-auto px-4 py-3">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${active ? "border-primary/60 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:bg-secondary"}`}
              >
                {t.label}
                {counts[t.id] > 0 && <span className="brand-gradient rounded-full px-1.5 text-[10px] font-bold leading-4 text-primary-foreground">{counts[t.id]}</span>}
              </button>
            );
          })}
        </div>
        <button aria-label="Options des notifications" onClick={() => setMenuOpen((v) => !v)} className="mr-2 shrink-0 rounded-full p-2 hover:bg-secondary"><MoreVertical className="h-5 w-5" /></button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="animate-fade-in absolute right-3 top-full z-50 mt-1 w-64 overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
              <button disabled={!all.some((n) => !n.is_read)} onClick={() => { setMenuOpen(false); markAllRead.mutate(); }} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-foreground hover:bg-secondary disabled:opacity-40">
                <CheckCheck className="h-4 w-4" /> Tout marquer comme lu
              </button>
              <button disabled={!hasRead} onClick={() => { setMenuOpen(false); removeMany.mutate(true); }} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-foreground hover:bg-secondary disabled:opacity-40">
                <Trash2 className="h-4 w-4" /> Supprimer les notifications lues
              </button>
              <button
                disabled={!hasDeletable}
                onClick={() => { setMenuOpen(false); if (window.confirm("Supprimer toutes tes notifications ? (Les avertissements de la modération sont conservés.)")) removeMany.mutate(false); }}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-destructive hover:bg-destructive/10 disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" /> Tout supprimer
              </button>
            </div>
          </>
        )}
      </div>

      <main className="pb-28">
        {q.isLoading && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
        {!q.isLoading && shown.length === 0 && <p className="mx-auto max-w-xs py-20 text-center text-sm text-muted-foreground">{EMPTY[tab]}</p>}
        {shown.map((n) =>
          n.type === "moderation" ? (
            <div key={n.id} className="m-3 rounded-2xl border border-destructive/50 bg-destructive/10 p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-destructive"><ShieldAlert className="h-4 w-4" /> Avertissement officiel de la modération</p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{n.body ?? ""}</p>
              <p className="mt-2 text-[11px] text-muted-foreground">Équipe Kalchat · {timeAgo(n.created_at)} · Message à sens unique, aucune réponse possible.</p>
            </div>
          ) : (
            <div key={n.id} className={`flex items-start gap-3 border-b border-border px-4 py-3 ${n.is_read ? "" : "bg-primary/5"}`}>
              <Link to="/u/$username" params={{ username: n.actor_username }} className="shrink-0">
                <MiniAvatar url={n.actor_avatar_url} name={n.actor_username} size={40} />
              </Link>
              <div className="min-w-0 flex-1 text-sm">
                <div>
                  <Link to="/u/$username" params={{ username: n.actor_username }} className="font-semibold text-foreground hover:underline">@{n.actor_username}</Link>
                  <span className="mx-1 inline-flex align-middle"><BadgeList badges={toBadges(n.actor_id, n.actor_badge, n.actor_role)} size={14} /></span>
                  {(n.type === "message" || n.type === "group_add") && n.conversation_id ? (
                    <Link to="/messages/$id" params={{ id: n.conversation_id }} className="text-muted-foreground hover:underline">{textFor(n)}</Link>
                  ) : n.post_id && ["like", "comment", "reply", "comment_like", "share", "mention"].includes(n.type) ? (
                    <Link to="/post/$id" params={{ id: n.post_id }} className="text-muted-foreground hover:underline">{textFor(n)}</Link>
                  ) : (
                    <span className="text-muted-foreground">{textFor(n)}</span>
                  )}
                  <span className="ml-2 text-[11px] text-muted-foreground">{timeAgo(n.created_at)}</span>
                </div>
                {n.type === "follow_request" && (
                  n.follow_status === "pending" ? (
                    <div className="mt-2 flex gap-2">
                      <button disabled={respond.isPending} onClick={() => respond.mutate({ actorId: n.actor_id, accept: true })} className="brand-gradient rounded-full px-4 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-60">Accepter</button>
                      <button disabled={respond.isPending} onClick={() => respond.mutate({ actorId: n.actor_id, accept: false })} className="rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary disabled:opacity-60">Refuser</button>
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">{n.follow_status === "accepted" ? "Demande acceptée" : "Demande traitée"}</p>
                  )
                )}
              </div>
              <button aria-label="Supprimer cette notification" disabled={removeOne.isPending} onClick={() => removeOne.mutate(n.id)} className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-destructive disabled:opacity-50">
                <X className="h-4 w-4" />
              </button>
            </div>
          ),
        )}
      </main>
      <BottomNav />
    </div>
  );
}
