import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { ShieldAlert } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { api, toBadges } from "@/lib/api";
import { BadgeList } from "@/components/KalBadge";
import { useAuth } from "@/lib/auth";
import { timeAgo } from "@/lib/social";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — Kalchat" },
      { name: "description", content: "Tes notifications Kalchat : abonnés, likes, messages et avis de modération." },
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
  is_read: number | boolean;
  created_at: string;
  actor_id: string;
  actor_username: string;
  actor_badge: string | null;
  actor_role: string | null;
}

const TEXTS: Record<string, string> = {
  like: "a aimé ta publication",
  comment: "a commenté ta publication",
  share: "a repartagé ta publication",
  follow_request: "t'a envoyé une demande d'abonnement",
  follow_accept: "a accepté ta demande d'abonnement",
  message: "t'a envoyé un message",
};

function NotificationsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["notifications", user?.id],
    enabled: !!user,
    queryFn: () => api<RawNotif[]>("/notifications"),
  });

  useEffect(() => {
    if (!user || !q.data?.some((n) => !n.is_read)) return;
    void api("/notifications/read-all", { method: "POST" }).then(() => qc.invalidateQueries({ queryKey: ["notifUnread"] }));
  }, [q.data, user, qc]);

  return (
    <div className="app-shell">
      <TopBar title="Notifications" />
      <main className="pb-28">
        {q.data?.length === 0 && <p className="py-20 text-center text-sm text-muted-foreground">Aucune notification.</p>}
        {q.data?.map((n) =>
          n.type === "moderation" ? (
            <div key={n.id} className="m-3 rounded-2xl border border-destructive/50 bg-destructive/10 p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-destructive"><ShieldAlert className="h-4 w-4" /> Avertissement officiel de la modération</p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{n.body ?? ""}</p>
              <p className="mt-2 text-[11px] text-muted-foreground">Équipe Kalchat · {timeAgo(n.created_at)} · Message à sens unique, aucune réponse possible.</p>
            </div>
          ) : (
            <div key={n.id} className={`border-b border-border px-4 py-3 text-sm ${n.is_read ? "" : "bg-primary/5"}`}>
              <Link to="/u/$username" params={{ username: n.actor_username }} className="font-semibold text-foreground hover:underline">@{n.actor_username}</Link>
              <span className="mx-1 inline-flex align-middle"><BadgeList badges={toBadges(n.actor_id, n.actor_badge, n.actor_role)} size={14} /></span>
              {n.type === "message" && n.conversation_id ? (
                <Link to="/messages/$id" params={{ id: n.conversation_id }} className="text-muted-foreground hover:underline">{TEXTS[n.type]}</Link>
              ) : n.type === "follow_request" ? (
                <Link to="/messages" className="text-muted-foreground hover:underline">{TEXTS[n.type]}</Link>
              ) : (
                <span className="text-muted-foreground">{TEXTS[n.type] ?? ""}</span>
              )}
              <span className="ml-2 text-[11px] text-muted-foreground">{timeAgo(n.created_at)}</span>
            </div>
          ),
        )}
      </main>
      <BottomNav />
    </div>
  );
}
