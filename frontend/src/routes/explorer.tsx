import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { getToken } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Hash, Loader2, Search } from "lucide-react";
import { useState } from "react";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { BadgeList } from "@/components/KalBadge";
import { PostCard } from "@/components/PostCard";
import { useAuth } from "@/lib/auth";
import { fetchFeed, fetchHashtagPosts, fetchTrendingHashtags, searchUsers } from "@/lib/social";

export const Route = createFileRoute("/explorer")({
  validateSearch: (search: Record<string, unknown>): { tag?: string } => ({
    tag: typeof search.tag === "string" && search.tag.trim() ? search.tag.trim().replace(/^#/, "").toLowerCase() : undefined,
  }),
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

function HashtagResults({ tag }: { tag: string }) {
  const navigate = useNavigate();
  const posts = useQuery({ queryKey: ["hashtag", tag], queryFn: () => fetchHashtagPosts(tag) });
  return (
    <section>
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button aria-label="Retour" onClick={() => void navigate({ to: "/explorer", search: {} })} className="rounded-full p-2 hover:bg-secondary">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h2 className="text-base font-bold text-foreground">#{tag}</h2>
          {posts.data && <p className="text-xs text-muted-foreground">{posts.data.length} publication{posts.data.length > 1 ? "s" : ""}</p>}
        </div>
      </div>
      {posts.isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : posts.data?.length ? (
        posts.data.map((p) => <PostCard key={p.id} post={p} />)
      ) : (
        <p className="py-12 text-center text-sm text-muted-foreground">Aucune publication avec #{tag} pour l'instant.</p>
      )}
    </section>
  );
}

function ExplorerPage() {
  const { user } = useAuth();
  const { tag } = Route.useSearch();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const term = q.trim().replace(/[%,()]/g, "");
  const hashtagTerm = q.trim().startsWith("#") ? q.trim().slice(1).replace(/[^\p{L}\p{N}_]/gu, "").toLowerCase() : "";
  const trending = useQuery({ queryKey: ["trendingTags"], queryFn: fetchTrendingHashtags, enabled: !tag });

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
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && hashtagTerm.length >= 2) void navigate({ to: "/explorer", search: { tag: hashtagTerm } });
              }}
              placeholder="Rechercher un membre ou un #hashtag..."
              className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
          </div>
        </div>
        {tag ? (
          <HashtagResults tag={tag} />
        ) : hashtagTerm.length >= 2 ? (
          <section className="px-4">
            <Link to="/explorer" search={{ tag: hashtagTerm }} className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-secondary/60">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-primary"><Hash className="h-5 w-5" /></span>
              <p className="text-sm font-semibold text-foreground">#{hashtagTerm}</p>
            </Link>
          </section>
        ) : term.length >= 2 ? (
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
          <>
          {!!trending.data?.length && (
            <section className="px-4 pt-1">
              <h2 className="mb-2 text-sm font-bold text-foreground">Tendances</h2>
              <div className="flex flex-wrap gap-2">
                {trending.data.map((t) => (
                  <Link key={t.tag} to="/explorer" search={{ tag: t.tag }} className="rounded-full border border-border bg-secondary/50 px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary">
                    #{t.tag} <span className="ml-1 font-normal text-muted-foreground">{t.count}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
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
          </>
        )}
      </main>
      <BottomNav />
    </div>
  );
}
