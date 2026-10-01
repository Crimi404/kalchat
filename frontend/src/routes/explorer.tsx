import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { getToken } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { BadgeList } from "@/components/KalBadge";
import { useAuth } from "@/lib/auth";
import { fetchFeed, searchUsers } from "@/lib/social";

export const Route = createFileRoute("/explorer")({
  beforeLoad: () => {
    if (!getToken()) throw redirect({ to: "/auth" });
  },
  head: () => ({
    meta: [
      { title: "Explorer — Kalchat" },
      { name: "description", content: "Trouve des membres et découvre les dernières photos de la communauté Kalchat." },
      { property: "og:title", content: "Explorer — Kalchat" },
      { property: "og:description", content: "Trouve des membres et découvre les dernières photos de la communauté Kalchat." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ExplorerPage,
});

function ExplorerPage() {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const term = q.trim().replace(/[%,()]/g, "");

  const people = useQuery({
    queryKey: ["search", term],
    enabled: term.length >= 2,
    queryFn: () => searchUsers(term),
  });
  const feed = useQuery({ queryKey: ["feed", user?.id], queryFn: () => fetchFeed() });
  const photos = (feed.data ?? []).filter((p) => p.image_url && p.media_type !== "video");

  return (
    <div className="app-shell">
      <TopBar title="Explorer" subtitle="Découvre la communauté" />
      <main className="pb-28">
        <div className="px-4 py-3">
          <div className="flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-4 py-2.5">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un membre..." className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
          </div>
        </div>
        {term.length >= 2 ? (
          <section className="px-4">
            {people.data?.length ? people.data.map((u) => (
              <Link key={u.id} to="/u/$username" params={{ username: u.username }} className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-secondary/60">
                {u.avatar_url ? <img src={u.avatar_url} alt={u.display_name} className="h-10 w-10 rounded-full object-cover" /> : <span className="brand-gradient flex h-10 w-10 items-center justify-center rounded-full font-bold text-primary-foreground">{u.display_name[0]?.toUpperCase()}</span>}
                <div>
                  <p className="flex items-center gap-1 text-sm font-semibold text-foreground">{u.display_name}<BadgeList badges={u.badges} size={14} /></p>
                  <p className="text-xs text-muted-foreground">@{u.username}</p>
                </div>
              </Link>
            )) : !people.isLoading && <p className="py-8 text-center text-sm text-muted-foreground">Aucun membre trouvé.</p>}
          </section>
        ) : (
          <section className="px-4 py-3">
            <h2 className="mb-3 text-sm font-bold text-foreground">Dernières photos</h2>
            {photos.length ? (
              <div className="grid grid-cols-2 gap-2">
                {photos.map((p) => (
                  <Link key={p.id} to="/u/$username" params={{ username: p.author?.username ?? "" }} className="relative overflow-hidden rounded-xl">
                    <img src={p.image_url!} alt={p.author?.display_name ?? ""} loading="lazy" className="aspect-square w-full object-cover" />
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/90 to-transparent p-2 text-[11px] font-semibold text-foreground">{p.author?.display_name}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">Pas encore de photos partagées.</p>
            )}
          </section>
        )}
      </main>
      <BottomNav />
    </div>
  );
}
